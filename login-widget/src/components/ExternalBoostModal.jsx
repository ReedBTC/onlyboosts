/**
 * ExternalBoostModal — boost another podcast's episode (Podcasting 2.0 V4V).
 *
 * DELIBERATELY SEPARATE from EpisodeBoostModal / MultiLegBoostForm (the LB
 * boost path, untouched). This runs the external orchestrator (lib/
 * externalBoost.js): pays the episode's value-block recipients via LNURL
 * (lnaddress) and keysend (node), publishes NO kind 30078, and — only when the
 * booster is signed in and PRESSES SHARE ON THE DONE SCREEN — posts a kind-1
 * note tagged to the external show's guid + Boost Me Bitch URL. Nothing here
 * touches LB stats/bots.
 *
 * ⚠️ The share is a post-settlement verb, not a pre-flight checkbox, and the
 * note reports SETTLED sats rather than typed ones. See `handleShare`.
 *
 * Progress UI is self-contained (not the LB BoostProgressView) so the external
 * leg shape / skipped legs / keysend-uncertain retry rules stay independent.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { lockBodyScroll, unlockBodyScroll } from '../lib/scrollLock.js'
import { useModalTransition } from '../lib/useModalTransition.js'
import { isSafeUrl } from '../lib/utils.js'
import * as wallet from '../lib/wallet.js'
import { payExternalBoost, STATUS } from '../lib/externalBoost.js'
import { buildExternalNoteTemplate, MAX_MESSAGE_CHARS } from '../lib/externalBoostagram.js'
import { signKindOneShareWithUser, publishSignedKindOne, confirmInvoiceSettled, fetchLnurlMeta } from '../lib/boostagram.js'
import { setBoostModalProgressVisible } from '../lib/boostModalSignal.js'
import { fireConfetti } from '../lib/confetti.js'
import ConfirmLeaveOverlay from './ConfirmLeaveOverlay.jsx'

const MIN_SATS = 21
const MAX_SATS = 5_000_000
const WORKING = STATUS.PAYING
// How long an unconfirmed leg keeps being checked after the run ends, and how
// long a donor-pressed re-check runs for. Both are wall-clock budgets rather
// than attempt counts: what matters is how long Lightning is given to settle,
// not how many times we asked.
const WATCH_MS = 90_000
const RECHECK_MS = 30_000

function fmtSats(n) { return Number(n || 0).toLocaleString() }

/**
 * ⚠️ TWO DIFFERENT AFFORDANCES, AND THE SPLIT BETWEEN THEM IS THE DOUBLE-PAY
 * GUARD. They used to be one "Retry" button and that is what paid a recipient
 * twice on 2026-08-19.
 *
 * A FAILED leg is one we know did not pay: it fell over before an invoice was
 * ever handed to the wallet, or the wallet cleanly declined it. Re-paying is
 * safe, because nothing is in flight.
 *
 * An UNCERTAIN leg is one an invoice WAS handed over for and no settlement has
 * been observed. Nothing can prove that leg unpaid — LUD-21 has no negative
 * signal, see confirmInvoiceSettled — so **it is never re-paid from this UI**.
 * The only offer is to look again, which is free and cannot go wrong. If it
 * truly did not land, the donor boosts again from the top, which is one
 * deliberate act rather than a button that quietly risks their money.
 */
function canRepayLeg(recipient, leg) {
  return leg?.status === STATUS.FAILED
}

/** An unconfirmed leg can be re-checked only when there is something to check
 *  against: LUD-21 needs the invoice's own verify URL, which keysend has none
 *  of and some lnaddress providers don't return. */
function canCheckLeg(recipient, leg) {
  return leg?.status === STATUS.UNCERTAIN &&
    recipient?.type === 'lnaddress' && !!leg?.verifyUrl && !!leg?.paymentHash
}

// One per-recipient row in the progress list.
function LegRow({ recipient, leg, onRepay, onCheck, checking, locked }) {
  const status = leg?.status || STATUS.PENDING
  const sats = leg?.sats
  const repayable = !!onRepay && canRepayLeg(recipient, leg)
  const checkable = !!onCheck && canCheckLeg(recipient, leg)
  const showError = (status === STATUS.FAILED || status === STATUS.UNCERTAIN) && !!leg?.error
  const spinner = (
    <svg className="animate-spin w-3.5 h-3.5 text-orange-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
  let icon = <span className="inline-block w-3.5 h-3.5 rounded-full border border-neutral-600" aria-hidden="true" />
  if (status === STATUS.PAID) icon = <span className="text-green-400" aria-hidden="true">✓</span>
  else if (status === STATUS.FAILED) icon = <span className="text-red-400" aria-hidden="true">✕</span>
  else if (status === STATUS.UNCERTAIN) icon = checking ? spinner : <span className="text-amber-400" aria-hidden="true">!</span>
  else if (status === WORKING) icon = spinner

  // One button slot. `locked` keeps it on screen but inert once the note has
  // been published, because a leg that changed afterwards could not be
  // reflected in an event that cannot be edited.
  let action = null
  if (checking) {
    action = <span className="shrink-0 text-[11px] px-2 py-0.5 text-amber-400/80">Checking…</span>
  } else if (repayable || checkable) {
    action = (
      <button onClick={locked ? undefined : (repayable ? onRepay : onCheck)} disabled={locked}
        title={locked ? 'Your note is already published, so a change here couldn’t be reflected in it.' : undefined}
        className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-neutral-700 text-neutral-300 hover:border-orange-500 hover:text-orange-300 disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-300 disabled:cursor-not-allowed transition-colors">
        {repayable ? 'Retry' : 'Check again'}
      </button>
    )
  }

  return (
    <li className="py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-4 flex justify-center shrink-0">{icon}</span>
        <span className="flex-1 min-w-0 truncate text-neutral-300">{recipient?.name || recipient?.address || 'Recipient'}</span>
        {sats != null && <span className="shrink-0 tabular-nums text-neutral-500">{fmtSats(sats)} sats</span>}
        {action}
      </div>
      {/* The wallet's own reason, shown rather than hidden: it is the only
          account of why a leg didn't land, and on a leg with no button
          it is the entire response the row has to give. */}
      {showError && (
        <p className={`mt-1 ml-6 text-[11px] leading-snug ${status === STATUS.UNCERTAIN ? 'text-amber-400/90' : 'text-red-400/90'}`}>
          {leg.error}
        </p>
      )}
    </li>
  )
}

export default function ExternalBoostModal({ user, onClose, onRequestSignIn, episode, recipientsBundle }) {
  const { visible, requestClose } = useModalTransition(onClose)
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const donorNpub = user?.npub || ''
  const signedIn = !!donorNpub
  const profile = user?.profile

  const recipients = recipientsBundle?.recipients || []
  const totalWeight = recipientsBundle?.totalWeight || 0
  const hasValue = recipients.length > 0 && totalWeight > 0

  const [amount, setAmount] = useState('1000')
  const [message, setMessage] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  // ⚠️ A SIGNED-OUT BOOST IS ANONYMOUS, and this is what the wire sees.
  // Since Phase 1 a wallet can be connected with no Nostr identity, so
  // `anonymous` is no longer the only way the sender fields end up empty.
  // Reading the toggle alone would be right today by accident — there is
  // no profile to read — and wrong the moment a typed name lands (the
  // note picker, Phase 2). Deriving it once here keeps the three wire
  // sites saying the same thing.
  const boostAnonymously = anonymous || !signedIn
  const [error, setError] = useState('')

  // Sharing is a VERB pressed after settlement, not a checkbox ticked before
  // it. Two reasons, and the first is the one that made this a bug:
  //
  //   - The note has to report what actually settled, and that is not known
  //     until every leg has run AND the donor has finished retrying the ones
  //     that didn't. A note published the instant the first pass ends can
  //     never reflect a successful retry, and an event cannot be edited.
  //   - The signer prompt then arrives at a moment the donor asked for it,
  //     rather than unannounced after a payment they thought was the end of
  //     the interaction.
  //
  // ⚠️ AN ANONYMOUS BOOST GETS NO SHARE CONTROL AT ALL, not a disabled one.
  // Signing the note with the donor's own npub would undo the anonymity they
  // chose one field up. The OnlyBoosts-signs-it path is what serves that case
  // and it does not exist yet (boost-login.md, Phase 3); when it lands it
  // belongs here as a second choice on this same control, NOT as a
  // resurrected pre-flight checkbox.
  //
  // A signed-out booster is inside `boostAnonymously` for the same reason
  // and by a different route: there is no npub to sign with at all. That
  // is the case the OnlyBoosts-signs-it path exists to serve, and it is
  // why Phase 1 shipping before Phase 2 leaves a real gap — a wallet-only
  // boost pays the show and puts nothing in this index.
  const canShareToFeed = !boostAnonymously
  const [shareState, setShareState] = useState('idle')   // 'idle' | 'signing' | 'shared' | 'error'
  const [shareError, setShareError] = useState('')

  const [phase, setPhase] = useState('form')       // 'form' | 'sending' | 'done'
  const [legs, setLegs] = useState([])             // per-recipient live state (aligned to recipients)
  const [confirmLeave, setConfirmLeave] = useState(false)

  useEffect(() => { lockBodyScroll(); return () => unlockBodyScroll() }, [])

  // Resolve every lnaddress recipient's LNURL endpoint in parallel as soon as
  // the modal mounts, so the orchestrator can skip its own resolve step at pay
  // time. Two round trips per leg used to happen while the booster watched a
  // spinner; this moves them to the seconds spent typing an amount. Same
  // arrangement EpisodeBoostModal has had — the external path was the one that
  // never got it.
  //
  // Only lnaddress legs: a node recipient's `address` is a node pubkey, and a
  // keysend has no LNURL step to prefetch. A failed fetch is stored as null
  // rather than omitted, which is the same instruction to the orchestrator
  // either way (fetch it live) and keeps the two cases from looking different.
  const [lnurlCache, setLnurlCache] = useState({})
  useEffect(() => {
    if (recipients.length === 0) return
    let cancelled = false
    const next = {}
    Promise.all(recipients.map(async (r) => {
      if (r?.type !== 'lnaddress' || !r.address) return
      try { next[r.address] = await fetchLnurlMeta(r.address) }
      catch { next[r.address] = null }
    })).then(() => { if (!cancelled) setLnurlCache(next) })
    return () => { cancelled = true }
    // The bundle's own array, not the `|| []` fallback above — that allocates a
    // fresh array on every render and would re-run this effect each time.
  }, [recipientsBundle?.recipients])

  const progressActive = phase === 'sending'
  useEffect(() => {
    setBoostModalProgressVisible(phase !== 'form')
    return () => setBoostModalProgressVisible(false)
  }, [phase])

  const [walletStatus, setWalletStatus] = useState(() => wallet.getStatus())
  useEffect(() => wallet.onChange(setWalletStatus), [])

  const guardedClose = () => {
    if (progressActive) setConfirmLeave(true)
    else requestClose()
  }

  const updateLeg = useCallback((index, patch) => {
    if (cancelledRef.current) return
    setLegs((prev) => { const next = prev.slice(); next[index] = { ...next[index], ...patch }; return next })
  }, [])

  // The live tally, recomputed every render off leg state, which is what makes
  // a successful Retry count toward the note. Declared here rather than beside
  // the render so `handleShare` and the summary line read the same numbers;
  // two derivations of "how much actually landed" is how the reported figure
  // drifts from the published one.
  //
  // SKIPPED legs are excluded from the denominator: those were allocated zero
  // sats by the split and never attempted, so counting them as unpaid would
  // report a shortfall that never happened.
  const visibleLegs = phase !== 'form'
    ? recipients.map((r, i) => ({ r, leg: legs[i] })).filter(({ leg }) => leg && leg.status !== STATUS.SKIPPED)
    : []
  const paidCount = legs.filter((l) => l?.status === STATUS.PAID).length
  const activeCount = visibleLegs.length
  const paidSats = legs.reduce((a, l) => a + (l?.status === STATUS.PAID ? (l.sats || 0) : 0), 0)

  /**
   * ⚠️ THE OTHER HALF OF THE DOUBLE-PAY FIX. A leg can settle after the 4.5
   * seconds the payment path is willing to wait inline, and the donor is left
   * looking at a screen that has to say something in the meantime. Rather than
   * guess, keep asking: every unconfirmed lnaddress leg is polled to a
   * 90-second budget and flips itself to Paid if it lands late. Most of these
   * resolve with no decision from the donor at all, which is the point — the
   * bug was a screen that asked them to decide on bad information.
   *
   * Keyed on `phase` only. Depending on `legs` would restart the watcher on
   * every poll result it wrote, so the targets are read through a ref at the
   * moment the run finishes.
   */
  const legsRef = useRef(legs)
  legsRef.current = legs
  const [checking, setChecking] = useState({})
  const stillChecking = Object.values(checking).some(Boolean)

  /**
   * ⚠️ ONE CELEBRATION PER BOOST, LATCHED. It used to fire the moment the first
   * pass returned and again after every retry that landed, so a boost with a
   * failed leg could burst two or three times for one payment.
   *
   * Keyed on `paidCount` rather than on the pass finishing, so a leg the
   * background watcher resolves late still earns the burst if nothing had
   * landed yet — and the ref means it cannot earn a second one.
   */
  const celebratedRef = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || paidCount === 0 || celebratedRef.current) return
    celebratedRef.current = true
    fireConfetti()
  }, [phase, paidCount])

  useEffect(() => {
    if (phase !== 'done') return
    const targets = recipients
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => canCheckLeg(r, legsRef.current[i]))
    if (targets.length === 0) return
    const ctrl = new AbortController()
    setChecking(Object.fromEntries(targets.map(({ i }) => [i, true])))
    for (const { i } of targets) {
      const leg = legsRef.current[i]
      confirmInvoiceSettled(leg.verifyUrl, leg.paymentHash, {
        attempts: 0, deadlineMs: WATCH_MS, intervalMs: 3000, signal: ctrl.signal,
      }).then((res) => {
        if (ctrl.signal.aborted || cancelledRef.current) return
        if (res === 'settled') updateLeg(i, { status: STATUS.PAID, error: null })
        else updateLeg(i, { error: 'Still unconfirmed. Check your wallet before sending anything — this may already have gone through.' })
        setChecking((prev) => ({ ...prev, [i]: false }))
      }).catch(() => {
        if (ctrl.signal.aborted || cancelledRef.current) return
        setChecking((prev) => ({ ...prev, [i]: false }))
      })
    }
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /**
   * Publish the donor's kind-1 share note, on their press, from their npub.
   *
   * ⚠️ THE FIGURES COME FROM LIVE LEG STATE, NOT FROM THE FORM. `paidSats` and
   * the leg counts are recomputed on every render, so pressing this after a
   * successful Retry reports the retried leg. This is the whole reason the
   * control moved out of the form: the old pre-flight checkbox fired the note
   * with the typed amount the instant the first pass ended, which overstated
   * every partial and could never see a retry.
   *
   * Failure is reported here rather than swallowed to the console. The donor
   * asked for this explicitly, so a silent no-op would leave them believing
   * they had shared. The sats are already gone either way, which is why a
   * failure offers a retry instead of unwinding anything.
   */
  async function handleShare() {
    if (!canShareToFeed || shareState === 'signing' || shareState === 'shared') return
    if (paidSats <= 0) return
    setShareState('signing')
    setShareError('')
    try {
      const template = buildExternalNoteTemplate({
        paidSats,
        legsPaid: paidCount,
        legsTotal: activeCount,
        message: message.trim(),
        showTitle: episode?.showTitle,
        episodeTitle: episode?.episodeTitle,
        podcastGuid: episode?.podcastGuid,
        itemGuid: episode?.itemGuid,
        bmbUrl: episode?.bmbUrl,
      })
      const signed = await signKindOneShareWithUser(template)
      await publishSignedKindOne(signed)
      if (cancelledRef.current) return
      setShareState('shared')
    } catch (e) {
      console.warn('[lb] external boost share note failed', e?.message || e)
      if (cancelledRef.current) return
      setShareError(e?.message || 'Couldn\u2019t post the note. Your boost still went through.')
      setShareState('error')
    }
  }

  async function handleBoost() {
    setError('')
    const sats = parseInt(amount, 10)
    if (!Number.isFinite(sats) || sats < MIN_SATS) { setError(`Minimum boost is ${MIN_SATS} sats.`); return }
    if (sats > MAX_SATS) { setError(`Max ${MAX_SATS.toLocaleString()} sats per boost.`); return }
    if (!wallet.isReady()) { setError('Connect a Lightning wallet from your account menu first.'); return }

    // Seed one pending row per recipient so the list renders immediately.
    setLegs(recipients.map(() => ({ status: STATUS.PENDING })))
    setPhase('sending')

    let result
    try {
      result = await payExternalBoost({
        recipients,
        totalWeight,
        totalSats: sats,
        message: message.trim(),
        senderName: boostAnonymously ? '' : (profile?.displayName || profile?.name || ''),
        senderPubkey: boostAnonymously ? '' : (user?.pubkey || ''),
        meta: {
          showTitle: episode?.showTitle,
          episodeTitle: episode?.episodeTitle,
          podcastGuid: episode?.podcastGuid,
          itemGuid: episode?.itemGuid,
          url: episode?.bmbUrl,
        },
        lnurlCache,
        onLeg: (i, legState) => updateLeg(i, legState),
      })
    } catch (e) {
      setError(e?.message || 'Boost failed to start')
      setPhase('form')
      return
    }
    if (cancelledRef.current) return
    setPhase('done')
  }

  /**
   * Re-pay a leg. ⚠️ FAILED ONLY — see canRepayLeg. There is deliberately no
   * branch here for an unconfirmed leg: the version of this function that had
   * one decided it was "safe to re-pay" off a LUD-21 `settled: false`, which
   * is not a statement that the payment failed, and a recipient was paid
   * twice as a result.
   */
  async function handleRepay(index) {
    const recipient = recipients[index]
    const leg = legs[index]
    if (!recipient || !leg) return
    if (!canRepayLeg(recipient, leg)) return
    if (shareState === 'shared') return
    if (!wallet.isReady()) { updateLeg(index, { status: STATUS.FAILED, error: 'Wallet not connected' }); return }
    updateLeg(index, { status: STATUS.PAYING, error: null })
    try {
      const res = await payExternalBoost({
        recipients: [recipient],
        totalWeight: recipient.splitWeight || 1,
        totalSats: leg.sats || 0,
        message: message.trim(),
        senderName: boostAnonymously ? '' : (profile?.displayName || profile?.name || ''),
        senderPubkey: boostAnonymously ? '' : (user?.pubkey || ''),
        meta: {
          showTitle: episode?.showTitle, episodeTitle: episode?.episodeTitle,
          podcastGuid: episode?.podcastGuid, itemGuid: episode?.itemGuid, url: episode?.bmbUrl,
        },
        // A leg that failed at the LNURL step has a null cache entry, so a
        // retry re-fetches it live; one that failed at the payment reuses the
        // metadata it already had. Both are what the retry wants.
        lnurlCache,
        onLeg: (_i, ls) => updateLeg(index, { ...ls, sats: leg.sats }),
      })
    } catch (e) {
      // ⚠️ Never downgrade a leg that already reported in. payExternalBoost
      // throws only on its own pre-flight validation, so today this cannot
      // clobber anything — but `onLeg` writes leg state on the way through, and
      // turning an UNCERTAIN leg into a FAILED one hands it back a re-pay
      // button it must not have.
      const cur = legsRef.current[index]?.status
      if (cur === STATUS.PAID || cur === STATUS.UNCERTAIN) return
      updateLeg(index, { status: STATUS.FAILED, error: e?.message || 'Retry failed' })
    }
  }

  /** Look at an unconfirmed leg again. Pays nothing and can never pay anything;
   *  it re-polls the ORIGINAL invoice's verify URL, so the worst outcome is
   *  learning nothing new. */
  async function handleCheck(index) {
    const recipient = recipients[index]
    const leg = legs[index]
    if (!canCheckLeg(recipient, leg)) return
    if (shareState === 'shared' || checking[index]) return
    setChecking((prev) => ({ ...prev, [index]: true }))
    try {
      const res = await confirmInvoiceSettled(leg.verifyUrl, leg.paymentHash, {
        attempts: 0, deadlineMs: RECHECK_MS, intervalMs: 3000,
      })
      if (cancelledRef.current) return
      if (res === 'settled') updateLeg(index, { status: STATUS.PAID, error: null })
      else updateLeg(index, { error: 'Still unconfirmed. Check your wallet before sending anything — this may already have gone through.' })
    } finally {
      if (!cancelledRef.current) setChecking((prev) => ({ ...prev, [index]: false }))
    }
  }

  const headerTitle = '⚡ Boost episode'
  const allPaid = phase === 'done' && activeCount > 0 && paidCount === activeCount

  // ⚠️ THE SUMMARY MUST NOT TELL THE DONOR TO RE-SEND A LEG WE CANNOT PROVE
  // UNPAID. It used to say "Retry any that didn't", which on an unconfirmed
  // leg was advice to pay twice. So the three states are named separately: a
  // leg still being checked is not a shortfall yet, a re-payable leg is one
  // the wallet declined, and an unconfirmed one points at the wallet.
  const repayableCount = visibleLegs.filter(({ r, leg }) => canRepayLeg(r, leg)).length
  const unconfirmedCount = visibleLegs.filter(({ leg }) => leg?.status === STATUS.UNCERTAIN).length
  let tail
  if (stillChecking) tail = 'Still checking the rest — don’t re-send them.'
  else if (repayableCount > 0) tail = 'Retry any that were declined.'
  else if (unconfirmedCount > 0) tail = 'The rest are unconfirmed — check your wallet rather than re-sending.'
  else tail = 'Check your wallet for the rest.'
  const summaryLine = paidCount > 0
    ? `${paidCount} of ${activeCount} legs sent. ${tail}`
    : `Nothing confirmed yet. ${tail}`

  return (
    <>
      <div className={`fixed inset-0 bg-black/70 z-[70] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-3 sm:p-4 overflow-hidden" role="dialog" aria-label={headerTitle}>
        <div className={`relative bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col shadow-[0_25px_60px_-12px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.04)] transition-[opacity,transform] duration-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-800 shrink-0">
            <h2 className="text-sm font-semibold text-neutral-200">{headerTitle}</h2>
            <button onClick={guardedClose} className="text-neutral-500 hover:text-neutral-300 transition-colors text-lg leading-none" aria-label="Close">✕</button>
          </div>

          <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
            {episode?.showTitle && (
              <div className="text-xs text-neutral-400 leading-snug">
                <span className="font-semibold text-neutral-300">{episode.showTitle}</span>
                {episode?.episodeTitle && <span className="block italic mt-0.5">"{episode.episodeTitle}"</span>}
              </div>
            )}

            {!hasValue && (
              <div className="space-y-3 text-center py-2">
                <p className="text-sm text-neutral-400">This episode doesn't have a Podcasting 2.0 value block, so there's no split to boost to.</p>
                <button onClick={requestClose} className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-sm text-neutral-200 transition-colors">Close</button>
              </div>
            )}

            {hasValue && phase === 'form' && (
              <>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Amount (sats)</label>
                  <input type="number" min={MIN_SATS} max={MAX_SATS} value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
                    placeholder={`${MIN_SATS} minimum`} />
                  <p className="mt-1 text-[10px] text-neutral-600">Splits across {recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'} per the show's value block.</p>
                </div>

                {/* ⚠️ NO IDENTITY TOGGLE WHEN THERE IS NO IDENTITY. Both of
                    its buttons would send the same empty sender fields, so
                    the control could only lie about having an effect. What
                    replaces it says what will happen and offers the one
                    thing that would change it. */}
                {!signedIn && (
                  <div className="rounded-md border border-neutral-800 bg-neutral-800/40 px-3 py-2.5 space-y-1.5">
                    <p className="text-xs text-neutral-300 leading-snug">
                      Boosting anonymously. The show sees your message and your
                      sats, not your name.
                    </p>
                    {onRequestSignIn && (
                      <button
                        type="button"
                        onClick={onRequestSignIn}
                        className="text-[11px] font-medium text-orange-400 hover:text-orange-300 transition-colors"
                      >
                        Sign in with Nostr to boost as yourself
                      </button>
                    )}
                  </div>
                )}

                {signedIn && (
                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Boost as</label>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => setAnonymous(false)} aria-pressed={!anonymous}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-3 px-3 rounded-md border transition-colors ${!anonymous ? 'bg-orange-500/15 border-orange-500 text-orange-200 font-semibold' : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'}`}>
                      {profile?.image && isSafeUrl(profile.image) && <img src={profile.image} alt="" className="w-4 h-4 rounded-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />}
                      <span className="truncate max-w-[140px]">{profile?.displayName || profile?.name || 'Your npub'}</span>
                    </button>
                    <button onClick={() => setAnonymous(true)} aria-pressed={anonymous}
                      className={`flex-1 py-3 px-3 rounded-md border transition-colors ${anonymous ? 'bg-orange-500/15 border-orange-500 text-orange-200 font-semibold' : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'}`}>Anon</button>
                  </div>
                </div>
                )}

                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Message (optional)</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_CHARS))} rows={3} maxLength={MAX_MESSAGE_CHARS}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 resize-none leading-relaxed"
                    placeholder="Say something to the show (rides along with the boost)" />
                  <p className="mt-1 text-[10px] text-neutral-600 text-right">{message.length}/{MAX_MESSAGE_CHARS}</p>
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <button onClick={handleBoost}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 rounded bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd"/></svg>
                  Boost episode
                </button>
              </>
            )}

            {hasValue && phase !== 'form' && (
              <div className="flex flex-col gap-3 min-h-[280px]">
                {phase === 'sending' && (
                  <p className="text-sm font-semibold text-orange-300">Sending your boost — keep this window open</p>
                )}
                {allPaid && <p className="text-base font-semibold text-green-400">⚡ Boost delivered!</p>}
                {phase === 'done' && !allPaid && (
                  <p className="text-sm font-semibold text-amber-400">
                    {summaryLine}
                  </p>
                )}
                <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-neutral-800">
                  {visibleLegs.map(({ r, leg }) => {
                    const realIndex = recipients.indexOf(r)
                    return <LegRow key={`${r.address}-${realIndex}`} recipient={r} leg={leg}
                      onRepay={phase === 'done' ? () => handleRepay(realIndex) : null}
                      onCheck={phase === 'done' ? () => handleCheck(realIndex) : null}
                      checking={!!checking[realIndex]}
                      locked={shareState === 'shared'} />
                  })}
                </ul>
                {/* The share control. Withheld until something actually paid,
                    because a note about a boost that didn't land is worse than
                    no note. Withheld entirely on an anonymous boost — see the
                    canShareToFeed note above. */}
                {/* ⚠️ NOT OFFERED WHILE A LEG IS STILL BEING CHECKED. The
                    note is a final statement about the boost, and a leg that
                    settles thirty seconds from now would make it wrong with no
                    way to correct it. */}
                {phase === 'done' && canShareToFeed && stillChecking && (
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    Checking {Object.values(checking).filter(Boolean).length === 1 ? 'one payment' : 'some payments'} before you share — the note should report what actually landed.
                  </p>
                )}
                {phase === 'done' && canShareToFeed && paidSats > 0 && !stillChecking && (
                  <div className="rounded-md border border-neutral-800 bg-neutral-800/40 p-3 space-y-2">
                    {shareState === 'shared' ? (
                      <p className="text-xs text-green-400 leading-snug">
                        ✓ Posted to your feed{paidCount < activeCount ? ` — ${fmtSats(paidSats)} sats, ${paidCount} of ${activeCount} splits` : ''}.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-neutral-300 leading-snug">
                          Share this boost on Nostr?
                          <span className="block text-[10px] text-neutral-500 mt-1">
                            Posts a kind-1 note from your npub, tagged to this episode.
                            OnlyBoosts counts boosts it can find on Nostr, so this is what
                            puts yours in the feeds and the totals.
                          </span>
                        </p>
                        {/* Naming the figure the note will carry, before it is
                            signed. On a partial the number is not the one the
                            donor typed, and finding that out by reading their
                            own published note is the wrong order. */}
                        <p className="text-[10px] text-neutral-500 leading-snug">
                          The note will say <span className="tabular-nums text-neutral-400">{fmtSats(paidSats)} sats</span>
                          {paidCount < activeCount && <> and <span className="text-neutral-400">{paidCount} of {activeCount} splits paid</span></>}.
                        </p>
                        {shareState === 'error' && shareError && (
                          <p className="text-[11px] text-red-400/90 leading-snug">{shareError}</p>
                        )}
                        <button onClick={handleShare} disabled={shareState === 'signing'}
                          className="w-full py-2 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-700 disabled:text-neutral-400 text-xs font-medium text-white transition-colors">
                          {shareState === 'signing' ? 'Approve in your signer…' : shareState === 'error' ? 'Try posting again' : 'Share to Nostr'}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {phase === 'done' && (
                  <button onClick={requestClose} className="mt-1 w-full py-2.5 rounded bg-neutral-700 hover:bg-neutral-600 text-sm text-neutral-200 transition-colors">Done</button>
                )}
              </div>
            )}
          </div>

          {confirmLeave && progressActive && (
            <ConfirmLeaveOverlay paid={paidCount} total={activeCount || recipients.length} onStay={() => setConfirmLeave(false)} onLeave={requestClose} />
          )}
        </div>
      </div>
    </>
  )
}

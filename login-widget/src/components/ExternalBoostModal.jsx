/**
 * ExternalBoostModal — boost another podcast's episode (Podcasting 2.0 V4V).
 *
 * DELIBERATELY SEPARATE from EpisodeBoostModal / MultiLegBoostForm (the LB
 * boost path, untouched). This runs the external orchestrator (lib/
 * externalBoost.js): pays the episode's value-block recipients via LNURL
 * (lnaddress) and keysend (node), publishes NO kind 30078, and posts a kind-1
 * note tagged to the external show's guid + episode URL. Nothing here touches
 * LB stats/bots.
 *
 * ⚠️ WHAT IS DECLARED IN THE FORM AND WHAT WAITS FOR SETTLEMENT ARE DIFFERENT
 * THINGS, and the distinction is the whole design of this file. The INTENT —
 * whether a note is posted at all, and whose identity signs it — is declared
 * in the form, because it is a choice about the donor rather than about the
 * outcome, and asking for it on the done screen charges the friction to the
 * newcomer this flow exists for. The FIGURES are recomputed at the moment of
 * publishing, because a note reports what settled and no earlier moment knows
 * that (see `handleShare` and D14 in boost-login.md).
 *
 * ⚠️ ANONYMOUS AND PRIVATE ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS, and
 * conflating them is what this file used to do. **Anonymous** is about WHOSE
 * name is on the boost: not your Nostr account, and optionally a name you type
 * instead. **Private** is about whether a note exists at all. So an anonymous
 * boost is still published, by OnlyBoosts, with no npub attached — which is the
 * whole point, because it means an anonymous booster still counts in the feeds
 * and the totals.
 *
 * The outcomes, all falling out of two controls:
 *
 *   as yourself, note on    the donor's own npub signs it, on their press
 *   anon + name, note on    OnlyBoosts signs it, the name is a line of prose
 *   anon, no name, note on  OnlyBoosts signs it with no name at all
 *   note off                nothing is published from any key
 *
 * Signed out there is no "as yourself", so the first row simply does not
 * arise; everything else is identical.
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
import { buildExternalNoteTemplate, sanitizeSenderName, MAX_MESSAGE_CHARS, MAX_SENDER_NAME_CHARS } from '../lib/externalBoostagram.js'
import { signKindOneShareWithUser, publishSignedKindOne, confirmInvoiceSettled, fetchLnurlMeta } from '../lib/boostagram.js'
import { signKindOneWithSite } from '../lib/siteSign.js'
import { setBoostModalProgressVisible } from '../lib/boostModalSignal.js'
import { fireConfetti } from '../lib/confetti.js'
import ConfirmLeaveOverlay from './ConfirmLeaveOverlay.jsx'

const MIN_SATS = 21
// ⚠️ `SITE_SIGN_MAX_SATS` IS THE SAME NUMBER AND IS MEANT TO BE. The signing
// oracle refuses an `amount` above its own cap, and the two were 5M and 100k
// until 2026-08-21, so a large signed-out or Anon boost paid fine and then
// could not be posted. Keeping them equal is what makes the advisory lines
// below dead code in practice; they are kept because the two constants live in
// files that cannot import each other, so nothing enforces the equality.
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
 * ⚠️ WAITING IS NOT THE SAME EVENT AS GIVING UP, AND THE OLD SCREEN SAID BOTH
 * AT ONCE. An unconfirmed leg arrived carrying "Don't re-send; it may already
 * be on its way" the instant the pay run ended, on a screen headed "Still
 * checking the rest — don't re-send them", in warning amber, and then held
 * that for up to ninety seconds without changing. Every word of it was true.
 * It still read as a fault, and it read as a *stuck* fault, because a screen
 * that cannot be hurried and never changes is indistinguishable from one that
 * has stopped working. Observed on a real boost, 2026-08-19: a leg to a slow
 * provider settled after about a minute, and the wait was the only part of the
 * boost that felt broken.
 *
 * So the two are separated. While the background watcher is running the donor
 * has NO decision to make — there is no Retry on an unconfirmed leg by design
 * — so the screen only reports that it is still working, and does it in copy
 * that CHANGES, which is the part that proves it is alive. The warning belongs
 * at the end of the watch, where a decision finally arrives, and that is where
 * it still is (see the give-up text the watcher writes).
 *
 * The stages escalate in patience, never in alarm. The one thing they must
 * keep carrying is that the sats may already be moving, since the double-pay
 * risk here is not a button — it is a donor who closes this modal and boosts
 * the episode again.
 */
/**
 * ⚠️ THE LONGEST WAIT IS BEFORE THE WATCHER EVER STARTS, and CHECK_STAGES did
 * not cover it. Measured on a real boost, 2026-08-19, four legs through one
 * WebLN extension:
 *
 *   greyturkey26@primal.net   invoice 1.9s   pay  2.3s
 *   chadf@getalby.com         invoice 0.6s   pay 45.5s   → uncertain, settled later
 *   reed@getalby.com          invoice 0.8s   pay  0.4s
 *
 * So the donor sat in front of a spinner and one unchanging line for
 * three-quarters of a minute, and the escalating copy only began once the run
 * ended. **The hang is inside the wallet's own `sendPayment`** — same
 * extension, same session, two sibling legs answering in seconds — so nothing
 * here can hurry it, shorten it, or see progress inside it. What it can do is
 * say how long it has been going, which is the whole of CHECK_STAGES' argument
 * arriving one state earlier.
 *
 * ⚠️ The first stage is deliberately SILENT. A normal leg pays in one to four
 * seconds, and a reassurance that flashes up and vanishes is noise that makes
 * a fast boost look eventful. The line appears only once the wait is long
 * enough to be worth explaining.
 *
 * The ceiling these run under is the wallet adapter's, not this file's: 90s for
 * WebLN, ~60s for NWC's SDK. **Do not shorten either to make this tidier** —
 * the leg above took 45.5 seconds and then paid, and a tighter bound would have
 * turned a successful payment into an UNCERTAIN one.
 */
const PAY_STAGES = [
  { at: 0, text: null },
  { at: 12, text: (name) => `Still waiting on your wallet for ${name}. That happens when a route is slow.` },
  { at: 30, text: (name) => `Still trying to reach ${name}. Nothing has failed; some destinations take longer than others.` },
  { at: 60, text: (name) => `Still going. If ${name} doesn\u2019t answer shortly we\u2019ll move on and tell you exactly where it stands.` },
]
function payStageText(seconds, name) {
  let fn = null
  for (const stage of PAY_STAGES) {
    if (seconds >= stage.at) fn = stage.text
  }
  return typeof fn === 'function' ? fn(name || 'this recipient') : null
}

const CHECK_STAGES = [
  { at: 0,  text: 'Waiting for their wallet to confirm this one.' },
  { at: 15, text: 'Still waiting. Some wallets take a minute to confirm, and nothing has failed.' },
  { at: 35, text: 'Still working on it. Hang tight — the sats may already be on their way.' },
  { at: 60, text: 'Still going. We\u2019ll stop checking shortly and tell you exactly where it stands.' },
]
function checkStageText(seconds) {
  let text = CHECK_STAGES[0].text
  for (const stage of CHECK_STAGES) {
    if (seconds >= stage.at) text = stage.text
  }
  return text
}

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
  // ⚠️ Suppressed while the watcher runs. The row's own message is the
  // give-up message, and showing it mid-watch is the confusion described on
  // CHECK_STAGES. The spinner and the label carry the row; the one escalating
  // line under the list carries the explanation, once, however many legs are
  // in flight.
  const showError = !checking && (status === STATUS.FAILED || status === STATUS.UNCERTAIN) && !!leg?.error
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
    // Orange, not amber: this is the working tone the sending phase uses, not
    // the warning tone a shortfall uses.
    action = <span className="shrink-0 text-[11px] px-2 py-0.5 text-orange-300/90">Checking…</span>
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

export default function ExternalBoostModal({ user, onClose, onRequestSignIn, onRequestWallet, episode, recipientsBundle }) {
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
  // The signed-out identity route: a name, or nothing. Held raw so the field
  // behaves like a field; every read of it goes through `typedName`.
  const [nameInput, setNameInput] = useState('')
  // The note control, unchecked by default. ⚠️ IT SUPPRESSES THE NOTE AND
  // NOTHING ELSE — see D12. `anonymous` is about the BOOSTAGRAM, which is what
  // the show's own app receives, and this is about NOSTR. A donor may
  // reasonably want the show to know who boosted while wanting nothing
  // published, and folding the two together leaves no way to say that. The
  // cost accepted is that the word "privately" does not cover the wire, which
  // is why the label carries its own scope rather than reading "Boost
  // privately" alone.
  const [noNote, setNoNote] = useState(false)
  const [error, setError] = useState('')

  const typedName = sanitizeSenderName(nameInput)

  /**
   * ⚠️ THE ONE QUESTION EVERYTHING ELSE HANGS OFF: is this boost going out
   * under the donor's Nostr account, or not?
   *
   * Signed out it never is, because there is no account. Signed in it is
   * unless they pressed Anon. Everything below reads this rather than testing
   * `signedIn` and `anonymous` separately, because the two cases where it is
   * false behave identically and had drifted apart once already.
   */
  const usingProfile = signedIn && !anonymous

  /**
   * ⚠️ ONE DERIVATION OF "ANONYMOUS", AND IT IS THE BOOSTAGRAM'S ANSWER ONLY.
   *
   * This flag governs the wire and nothing else: `sender_name` and `sender_id`
   * in the TLV record, on the first pass and on a retry. It must not grow a
   * second meaning. Whether a note is published and who signs it is
   * `noteRoute` below, a separate derivation standing beside this one — Boost
   * Me Bitch shipped that promise broken twice by letting one expression carry
   * both, each time because one surface learned a rule another didn't (read
   * the header of its `use-share-picker.ts`).
   *
   * ⚠️ ANONYMOUS DOES NOT MEAN UNPUBLISHED. Pressing Anon detaches the Nostr
   * account from the boost; OnlyBoosts still posts the note, so the boost
   * still counts. What suppresses the note is the private checkbox, and only
   * that. The two used to be folded together here and it made Anon quietly
   * cost a booster their place in the index.
   *
   * Off the profile, the typed name decides it, and a name is not merely
   * cosmetic: it is `sender_name`, which is what the podcaster's Helipad reads
   * (boost-login.md, Phase 10).
   */
  const boostAnonymously = usingProfile ? false : !typedName
  const wireSenderName = boostAnonymously
    ? ''
    : (usingProfile ? (profile?.displayName || profile?.name || '') : typedName)
  // ⚠️ NEVER A PUBKEY WITHOUT THE PROFILE BEHIND IT. `sender_id` is what
  // recipient aggregators resolve to an avatar and a name, so carrying it on an
  // Anon boost would undo the anonymity in the one place the donor cannot see.
  // That is the exact leak BMB shipped twice.
  const wireSenderPubkey = usingProfile ? (user?.pubkey || '') : ''

  /**
   * ⚠️ WHO SIGNS THE NOTE, AND WHETHER THERE IS ONE. Three values, and every
   * surface below reads this rather than re-deriving it:
   *
   *   'donor'  the donor's own npub signs it, on their press
   *   'bot'    OnlyBoosts signs it through /api/sign-boost, published per D14
   *   'none'   nothing is published, from any key
   *
   * ⚠️ THE INTENT IS DECLARED IN THE FORM; THE FIGURES ARE NOT. That is the
   * correction to the rule this file used to state as "the share is a verb, not
   * a checkbox", and the reasoning under that rule is untouched: a note reports
   * what SETTLED, which is unknown until every leg has run and the donor has
   * finished retrying, and an event cannot be edited. So the numbers are still
   * recomputed at the moment of publishing (`handleShare`). What moved into the
   * form is the *choice*, because it is a choice about the donor rather than
   * about the outcome. Asking a newcomer to press a second button after the
   * payment charges the friction to precisely the visitor this flow exists for.
   *
   * ⚠️ ANON ROUTES TO THE BOT, IT DOES NOT SUPPRESS. Reed's call, 2026-08-21,
   * correcting the shape this shipped with hours earlier. Signing with the
   * donor's own npub would undo the anonymity they chose one field up — that
   * part was always right — but the conclusion drawn from it was that no note
   * should exist, which quietly cost an anonymous booster their place in the
   * index. Anonymity is about attribution; the bot route is what serves it.
   * **`'none'` is reachable only through the checkbox.**
   *
   * Nothing is ever in 'none' by accident, which matters most for a signed-out
   * booster: with no key to sign with, the bot route is the only thing standing
   * between a wallet-only boost and this index holding no record of it at all.
   */
  const noteRoute = noNote ? 'none' : (usingProfile ? 'donor' : 'bot')
  const canShareToFeed = noteRoute === 'donor'
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

  // The leg the wallet is currently working on, and how long it has been at
  // it. Legs are paid sequentially (see D9 in boost-login.md), so there is at
  // most one, and its own `startedAt` is the clock — the ticker above only
  // forces the re-render that re-reads it.
  const payingIndex = legs.findIndex((l) => l?.status === WORKING)
  const payingLeg = payingIndex >= 0 ? legs[payingIndex] : null
  const payingName = payingIndex >= 0
    ? (recipients[payingIndex]?.name || recipients[payingIndex]?.address || '')
    : ''
  const paySeconds = payingLeg?.startedAt
    ? Math.floor(((payTick || Date.now()) - payingLeg.startedAt) / 1000)
    : 0
  const payNote = phase === 'sending' ? payStageText(paySeconds, payingName) : null

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

  // Re-render once a second while a payment is outstanding, so the pay-stage
  // copy can be computed from the leg's own `startedAt` rather than from a
  // second clock that would have to be kept in step with it.
  const [payTick, setPayTick] = useState(0)
  useEffect(() => {
    if (phase !== 'sending') return
    const id = setInterval(() => setPayTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Seconds since the current watch began, which is the only input the stage
  // copy needs. Keyed on `stillChecking` rather than on the checking map, so a
  // second leg finishing does not restart the clock on the one still running.
  const [checkSeconds, setCheckSeconds] = useState(0)
  useEffect(() => {
    if (!stillChecking) { setCheckSeconds(0); return }
    const startedAt = Date.now()
    setCheckSeconds(0)
    const id = setInterval(() => {
      setCheckSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [stillChecking])

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
   * Publish the kind-1 boost note, by whichever route the form declared.
   *
   * ⚠️ THE FIGURES COME FROM LIVE LEG STATE, NOT FROM THE FORM, and that has
   * not changed. `paidSats` and the leg counts are recomputed on every render,
   * so publishing after a successful Retry reports the retried leg. The bug
   * this closed is worth restating because Phase 2 moved a *different* control
   * into the form: the old pre-flight checkbox fired the note with the TYPED
   * amount the instant the first pass ended, which overstated every partial and
   * could never see a retry. What the form declares now is the intent; the
   * numbers are still read here, at the moment of publishing.
   *
   * Failure is reported rather than swallowed to the console. On the donor
   * route they asked for this explicitly, so a silent no-op would leave them
   * believing they had shared; on the bot route the publish was automatic, so
   * silence would leave them believing it worked. ⚠️ EITHER WAY THE SATS ARE
   * ALREADY GONE, which is why a failure offers another attempt at the NOTE
   * and never anything that resembles unwinding a payment.
   */
  async function handleShare() {
    if (noteRoute === 'none' || shareState === 'signing' || shareState === 'shared') return
    if (paidSats <= 0) return
    setShareState('signing')
    setShareError('')
    try {
      const template = buildExternalNoteTemplate({
        paidSats,
        legsPaid: paidCount,
        legsTotal: activeCount,
        message: message.trim(),
        // ⚠️ BOT ROUTE ONLY, and it is a line of prose rather than any kind of
        // claim (D15). A donor-signed note is already from the donor, so a
        // "From" line on it would be the author naming themselves in the third
        // person; and nothing anywhere may turn this string into a `p` tag or
        // an author field, because nothing can verify that the person named
        // authorised a note signed by a key they do not hold.
        senderName: noteRoute === 'bot' ? typedName : '',
        showTitle: episode?.showTitle,
        episodeTitle: episode?.episodeTitle,
        podcastGuid: episode?.podcastGuid,
        itemGuid: episode?.itemGuid,
        bmbUrl: episode?.bmbUrl,
      })
      // The only difference between the two routes is where the signature
      // comes from. Both produce a signed event and both publish it from the
      // browser through the same relay set, so a bot-signed boost reaches the
      // same audience a donor-signed one does.
      const signed = noteRoute === 'bot'
        ? await signKindOneWithSite(template)
        : await signKindOneShareWithUser(template)
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

  /**
   * ⚠️ A BOT-SIGNED NOTE PUBLISHES ITSELF ON A CLEAN BOOST (D14), and this is
   * the one place the two routes are deliberately asymmetric.
   *
   * The press exists on the donor-signed path because a signer prompt has to be
   * ASKED for: an approval dialog arriving unannounced after a payment the
   * donor thought was the end of the interaction is worse than a button. There
   * is no prompt on the bot path, so the press there buys nothing and costs the
   * newcomer this feature exists for one more thing to understand.
   *
   * ⚠️ IT FIRES ONLY WHERE THE PRESS COULD NOT HAVE CHANGED THE ANSWER: every
   * active leg PAID and nothing still being checked. A shortfall or an
   * UNCERTAIN leg is exactly the state in which the donor may still retry and
   * change what the note should say, so those get the button. That is the same
   * "reports what settled" rule with the press removed from the case where it
   * was ceremony, not a decision.
   *
   * `autoSharedRef` is what stops a late-settling leg from firing a second
   * publish. `shareState` latches at 'shared' as well, so one boost publishes
   * at most one note either way.
   */
  const autoSharedRef = useRef(false)
  useEffect(() => {
    if (phase !== 'done' || noteRoute !== 'bot') return
    if (autoSharedRef.current || shareState !== 'idle') return
    if (stillChecking || paidSats <= 0) return
    if (activeCount === 0 || paidCount !== activeCount) return
    autoSharedRef.current = true
    handleShare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, noteRoute, stillChecking, paidCount, activeCount, paidSats, shareState])

  /**
   * ⚠️ THE WALLET GATE LIVES HERE NOW, NOT IN FRONT OF THE MODAL (D13). It ran
   * inside `openExternalBoost` until Phase 2, so a visitor who pressed Boost
   * was asked to paste an NWC connection string before seeing what they were
   * boosting or what it would cost. Compose first, pay second.
   *
   * ⚠️ THE RESUME IS THE EFFECT BELOW, NOT A CALLBACK AND NOT A pendingAction.
   * `WalletConnectModal` opens OVER this one (z-[78/79] against z-[70/71]), so
   * this modal stays mounted with its state intact and there is nothing to
   * save or restore; re-entering `openExternalBoost` to resume would mount a
   * second modal over the first. What resumes the boost is this component's
   * own `wallet.onChange` subscription seeing a wallet arrive.
   */
  const payStartedRef = useRef(false)
  const [awaitingWallet, setAwaitingWallet] = useState(false)

  async function handleBoost() {
    setError('')
    const sats = parseInt(amount, 10)
    if (!Number.isFinite(sats) || sats < MIN_SATS) { setError(`Minimum boost is ${MIN_SATS} sats.`); return }
    if (sats > MAX_SATS) { setError(`Max ${MAX_SATS.toLocaleString()} sats per boost.`); return }

    if (!wallet.isReady()) {
      // Fire and forget. It either unlocks a remembered wallet (in which case
      // the effect below picks the boost straight back up), opens the connect
      // modal, or reports a stalled extension in a toast. Its promise is
      // deliberately not the resume signal: a second path into `startPay`
      // would be a second way to pay twice.
      setAwaitingWallet(true)
      try { await onRequestWallet?.() } catch {}
      return
    }
    startPay(sats)
  }

  async function startPay(sats) {
    if (payStartedRef.current) return
    payStartedRef.current = true
    setAwaitingWallet(false)

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
        senderName: wireSenderName,
        senderPubkey: wireSenderPubkey,
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
      payStartedRef.current = false
      return
    }
    if (cancelledRef.current) return
    setPhase('done')
  }

  // The resume. Keyed on the wallet actually being connected rather than on
  // whatever `onRequestWallet` reported, so a connection made in the modal, an
  // at-rest unlock and a wallet connected in another tab all land the same way.
  useEffect(() => {
    if (!awaitingWallet || !walletStatus.connected) return
    if (phase !== 'form' || payStartedRef.current) return
    const sats = parseInt(amount, 10)
    if (!Number.isFinite(sats) || sats < MIN_SATS || sats > MAX_SATS) { setAwaitingWallet(false); return }
    startPay(sats)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingWallet, walletStatus.connected, phase])

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
        senderName: wireSenderName,
        senderPubkey: wireSenderPubkey,
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
  // ⚠️ Calm while the watcher runs. This line is the loudest thing on the
  // screen, and a leg that is merely slow is not a shortfall yet. See
  // CHECK_STAGES.
  const checkingCount = Object.values(checking).filter(Boolean).length
  if (stillChecking) tail = checkingCount === 1 ? 'Still confirming the last one.' : 'Still confirming the rest.'
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

                {/* ⚠️ THE NAME FIELD BELONGS TO "NOT UNDER A NOSTR ACCOUNT",
                    NOT TO "SIGNED OUT". A signed-in donor who presses Anon is
                    in exactly the same position as a signed-out one: their
                    account is detached from the boost, and a typed name is the
                    only attribution left. Rendering it only when signed out
                    would have made Anon mean "no name, ever", which is a
                    narrower thing than the button says.

                    ⚠️ AND IT IS EXCLUSIVE WITH THE PROFILE, which is why it is
                    absent rather than disabled while the profile is in use: a
                    typed name beside a signed-in identity would be a second
                    identity claim on one note.

                    Vocabulary is deliberate. "Your name" and "Log in", never
                    anything about keys — this may be someone's first contact
                    with Nostr and they need not know that is what it is. */}
                {!usingProfile && (
                  <div>
                    <label htmlFor="ob-boost-from" className="block text-xs text-neutral-400 mb-1.5">Your name (optional)</label>
                    <input
                      id="ob-boost-from"
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value.slice(0, MAX_SENDER_NAME_CHARS))}
                      maxLength={MAX_SENDER_NAME_CHARS}
                      autoComplete="off"
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30"
                      placeholder="Who should the show thank?" />
                    <p className="mt-1 text-[10px] text-neutral-600 leading-snug">
                      {typedName
                        ? 'The show sees this name alongside your sats, and OnlyBoosts posts the boost under its own account so it counts in the feeds.'
                        : 'Leave it blank and no name goes anywhere. OnlyBoosts still posts the boost under its own account, so it counts in the feeds either way.'}
                      {signedIn && ' Your account is not attached to this one.'}
                    </p>
                    {!signedIn && onRequestSignIn && (
                      <button
                        type="button"
                        onClick={onRequestSignIn}
                        className="mt-2 text-[11px] font-medium text-orange-400 hover:text-orange-300 transition-colors"
                      >
                        Or log in with Nostr and boost as yourself
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs text-neutral-400 mb-1.5">Message (optional)</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_CHARS))} rows={3} maxLength={MAX_MESSAGE_CHARS}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 resize-none leading-relaxed"
                    placeholder="Say something to the show (rides along with the boost)" />
                  <p className="mt-1 text-[10px] text-neutral-600 text-right">{message.length}/{MAX_MESSAGE_CHARS}</p>
                </div>

                {/* ⚠️ THE LABEL CARRIES ITS OWN SCOPE, and a bare "Boost
                    privately" is not allowed to replace it (D12). This
                    suppresses the NOTE. The sats and the message still cross
                    Lightning to the show's own app, which is the half the word
                    "privately" does not cover, so the parenthesis is the whole
                    point of the string rather than decoration on it.

                    ⚠️ IT IS NEVER IMPLIED BY ANON. Anonymous is about whose
                    name is on the boost; private is about whether a note
                    exists. This is the only control that reaches 'none', which
                    is what lets an anonymous booster still count. */}
                <label className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${noNote ? 'border-neutral-700 bg-neutral-800/60' : 'border-neutral-800 bg-neutral-800/40 hover:border-neutral-700'}`}>
                  <input
                    type="checkbox"
                    checked={noNote}
                    onChange={(e) => setNoNote(e.target.checked)}
                    className="mt-0.5 w-3.5 h-3.5 shrink-0 accent-orange-500" />
                  <span className="min-w-0">
                    <span className="block text-xs text-neutral-300 leading-snug">Boost privately (no Nostr note)</span>
                    <span className="block text-[10px] text-neutral-500 leading-snug mt-0.5">
                      {noNote
                        ? 'Your sats and message still reach the show. Nothing is posted to Nostr from any account, so this boost stays out of the OnlyBoosts feeds and totals.'
                        : noteRoute === 'bot'
                          ? 'OnlyBoosts counts boosts it can find on Nostr, so a note is what puts yours in the feeds and the totals. Tick this to keep it off Nostr entirely.'
                          : 'You choose whether to post it once the sats have landed, so the note reports what actually went through. Tick this to keep it off Nostr entirely.'}
                    </span>
                  </span>
                </label>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <button onClick={handleBoost}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 rounded bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd"/></svg>
                  Boost episode
                </button>
                {/* Said before the press rather than only after it, because
                    the wallet gate now sits behind this button: a reader who
                    has none should know one more step is coming rather than
                    meeting a second modal unannounced. The awaiting line
                    stays until the wallet lands, and pressing Boost again
                    re-opens the connect modal, so a dismissed one is never a
                    dead end. */}
                {!walletStatus.connected && (
                  <p className="text-[10px] text-neutral-500 leading-snug text-center">
                    {awaitingWallet
                      ? 'Waiting for a wallet. Connect one and this boost sends itself.'
                      : 'No wallet connected yet. We\u2019ll ask for one when you press Boost.'}
                  </p>
                )}
              </>
            )}

            {hasValue && phase !== 'form' && (
              <div className="flex flex-col gap-3 min-h-[280px]">
                {phase === 'sending' && (
                  <p className="text-sm font-semibold text-orange-300">Sending your boost — keep this window open</p>
                )}
                {/* Silent on a normal leg; see PAY_STAGES. It sits under the
                    headline rather than on the row, because the row already
                    carries the spinner that says WHICH leg, and one moving
                    line beats the same sentence repeated per row. */}
                {payNote && (
                  <p className="text-[11px] text-neutral-400 leading-snug">{payNote}</p>
                )}
                {allPaid && <p className="text-base font-semibold text-green-400">⚡ Boost delivered!</p>}
                {phase === 'done' && !allPaid && (
                  <p className={`text-sm font-semibold ${stillChecking ? 'text-orange-300' : 'text-amber-400'}`}>
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
                {/* The one line that changes. Rendered for every donor, not
                    only one who can share: an anonymous booster is watching
                    the same spinner and is owed the same account of it. */}
                {phase === 'done' && stillChecking && (
                  <p className="text-[11px] text-neutral-400 leading-snug">
                    {checkStageText(checkSeconds)}
                    {noteRoute !== 'none' && ' The Nostr note waits for this, so it reports what actually landed.'}
                  </p>
                )}
                {phase === 'done' && noteRoute !== 'none' && paidSats > 0 && !stillChecking && (
                  <div className="rounded-md border border-neutral-800 bg-neutral-800/40 p-3 space-y-2">
                    {shareState === 'shared' ? (
                      <p className="text-xs text-green-400 leading-snug">
                        {noteRoute === 'bot'
                          ? `\u2713 Posted to Nostr by OnlyBoosts${paidCount < activeCount ? ` (${fmtSats(paidSats)} sats, ${paidCount} of ${activeCount} splits)` : ''}.`
                          : `\u2713 Posted to your feed${paidCount < activeCount ? ` (${fmtSats(paidSats)} sats, ${paidCount} of ${activeCount} splits)` : ''}.`}
                        {noteRoute === 'bot' && (
                          <span className="block text-[10px] text-neutral-500 mt-1">
                            Your boost is in the OnlyBoosts feeds and totals.
                            {signedIn
                              ? ' It went out under the OnlyBoosts account, so your own account is not on it.'
                              : ' It went out under the OnlyBoosts account, since this browser has none of its own.'}
                          </span>
                        )}
                      </p>
                    ) : shareState === 'signing' && noteRoute === 'bot' ? (
                      /* The auto-publish window (D14). Named rather than left
                         silent: this is the one moment the screen is doing
                         something the donor did not press. */
                      <p className="text-xs text-neutral-300 leading-snug">Posting your boost to Nostr…</p>
                    ) : (
                      <>
                        <p className="text-xs text-neutral-300 leading-snug">
                          {noteRoute === 'bot' ? 'Post this boost to Nostr?' : 'Share this boost on Nostr?'}
                          <span className="block text-[10px] text-neutral-500 mt-1">
                            {noteRoute === 'bot'
                              ? `OnlyBoosts counts boosts it can find on Nostr, so this is what puts yours in the feeds and the totals. It posts under the OnlyBoosts account${signedIn ? ', not yours' : ''}.`
                              : 'Posts a kind-1 note from your npub, tagged to this episode. OnlyBoosts counts boosts it can find on Nostr, so this is what puts yours in the feeds and the totals.'}
                          </span>
                        </p>
                        {/* ⚠️ WHY THE BOT ROUTE IS ASKING AT ALL. It publishes
                            itself on a clean boost, so reaching this branch
                            means a leg fell short or went unconfirmed — which
                            is exactly the state in which a retry would change
                            what the note should say. Saying so is what makes
                            the button read as a decision rather than a step
                            that appears at random. */}
                        {noteRoute === 'bot' && shareState !== 'error' && (
                          <p className="text-[10px] text-amber-400/90 leading-snug">
                            Waiting on you because not every split landed. Retry what you can first;
                            the note reports whatever has settled when you press.
                          </p>
                        )}
                        {/* Naming the figure the note will carry, before it is
                            signed. On a partial the number is not the one the
                            donor typed, and finding that out by reading their
                            own published note is the wrong order. */}
                        <p className="text-[10px] text-neutral-500 leading-snug">
                          The note will say <span className="tabular-nums text-neutral-400">{fmtSats(paidSats)} sats</span>
                          {paidCount < activeCount && <> and <span className="text-neutral-400">{paidCount} of {activeCount} splits paid</span></>}
                          {noteRoute === 'bot' && typedName && <>, from <span className="text-neutral-400">{typedName}</span></>}.
                        </p>
                        {/* ⚠️ A FAILED SIGN IS NOT A FAILED BOOST, and the copy
                            has to say so or a donor reads it as their sats
                            being lost. The sats are gone either way, which is
                            why the offer is another attempt at the note rather
                            than anything that looks like unwinding a payment. */}
                        {shareState === 'error' && shareError && (
                          <p className="text-[11px] text-red-400/90 leading-snug">{shareError}</p>
                        )}
                        <button onClick={handleShare} disabled={shareState === 'signing'}
                          className="w-full py-2 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-700 disabled:text-neutral-400 text-xs font-medium text-white transition-colors">
                          {shareState === 'signing'
                            ? (noteRoute === 'bot' ? 'Posting\u2026' : 'Approve in your signer\u2026')
                            : shareState === 'error' ? 'Try posting again'
                            : noteRoute === 'bot' ? 'Post to Nostr' : 'Share to Nostr'}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {/* ⚠️ SILENCE IS WHAT A FAILURE LOOKS LIKE, so the suppressed
                    case says out loud that nothing was posted and that it was
                    the donor's own choice. Without it the screen a private
                    boost ends on is identical to the screen a broken one would
                    end on. */}
                {phase === 'done' && noteRoute === 'none' && paidSats > 0 && !stillChecking && (
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    Nothing was posted to Nostr, as you asked. Your sats and your message reached
                    the show, and this boost stays out of the OnlyBoosts feeds and totals.
                  </p>
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

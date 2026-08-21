/**
 * BoostModal — site-wide "Boost OnlyBoosts" tip form.
 *
 * Thin wrapper around <MultiLegBoostForm>: just owns the modal chrome
 * (backdrop, transitions, scroll lock, header + close X) and supplies
 * the show-level inputs:
 *   - hardcoded splitsBundle (a single 100% leg to the site's own
 *     lightning address, baked into the bundle so the nav boost button
 *     has no network dependency at click time)
 *   - episodeMeta with `kind: 'show'` so the in-flight dropdown reads
 *     "Show" and the bot can distinguish show-level boosts from
 *     episode boosts via empty episode/title/guid tags
 *   - sat presets (100/420/3333/21000)
 *   - "Boost OnlyBoosts" button label
 *
 * applyRecipientOverrides runs at module init for symmetry with the
 * episode flow. The override map is empty on OnlyBoosts (see
 * recipientOverrides.js for why), so this is currently a pass-through.
 */

import { useEffect, useState } from 'react'
import { lockBodyScroll, unlockBodyScroll } from '../lib/scrollLock.js'
import { useModalTransition } from '../lib/useModalTransition.js'
import { applyRecipientOverrides } from '../lib/recipientOverrides.js'
import { RECIPIENT_LUD16 } from '../lib/boostagram.js'
import MultiLegBoostForm from './MultiLegBoostForm.jsx'
import ConfirmLeaveOverlay from './ConfirmLeaveOverlay.jsx'

// Where the nav's "Boost" button sends sats — a tip to OnlyBoosts itself,
// not to any podcast. One leg at 100%; the address is sourced from
// boostagram.js so there is a single place to change where the money goes.
//
// LB's version split this three ways between the two hosts and the show
// wallet (reed / revhodl / aquafox30). That was replaced, not reweighted,
// on fork — those are real people's addresses and none of them are the
// recipient here. The multi-leg machinery is retained because the *podcast*
// boost path genuinely fans out across a show's value block.
const _SHOW_RECIPIENTS = applyRecipientOverrides([
  { name: 'OnlyBoosts', address: RECIPIENT_LUD16, splitWeight: 100, type: 'lnaddress' },
])
const SHOW_SPLITS = {
  recipients: _SHOW_RECIPIENTS,
  totalWeight: _SHOW_RECIPIENTS.reduce((acc, r) => acc + (r.splitWeight || 0), 0),
  source: 'show',
}

// `kind: 'show'` is read by the IdentityDropdown to render "Show"
// instead of falling through to the "Episode" defensive default. The
// other episode fields stay empty — payAllLegs's tag builder writes
// them through as empty strings, which is exactly the show-level
// signal the bot needs (paired with the "OnlyBoostsSite" LNURL
// comment from formatEpisodeComment(null)).
const SHOW_EPISODE_META = { number: null, title: '', guid: '', kind: 'show' }
const SHOW_PRESETS = [100, 420, 3333, 21000]
const SHOW_SHARE_TAGLINE = 'Posts a kind 1 note to your followers — your message + a link back here.'

export default function BoostModal({ user, onClose, prefillMessage = '', onSettled }) {
  const { visible, requestClose } = useModalTransition(onClose)

  // Close guard: while legs are in flight, intercept the ✕ with a
  // confirm step instead of closing outright. boostState is reported up
  // from the form; null once the boost settles.
  const [boostState, setBoostState] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  useEffect(() => {
    if (!boostState?.active) setConfirmLeave(false)
  }, [boostState])
  const guardedClose = () => {
    if (boostState?.active) setConfirmLeave(true)
    else requestClose()
  }

  useEffect(() => {
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [])

  return (
    <>
      <div
        className={`fixed inset-0 bg-[var(--scrim,rgba(11,58,82,0.55))] z-[70] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
      />

      <div
        className="fixed inset-0 z-[71] flex items-center justify-center p-3 sm:p-4 overflow-hidden"
        role="dialog"
        aria-label="Donate to OnlyBoosts"
      >
        <div className={`relative bg-[var(--modal-bg,#f4fafd)] border border-[var(--modal-line,#b9d4e6)] rounded-lg w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col shadow-[0_24px_60px_-12px_rgba(11,58,82,0.28),0_0_0_1px_rgba(11,58,82,0.06)] transition-[opacity,transform] duration-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[var(--modal-line,#b9d4e6)] shrink-0">
            <h2 className="text-base font-semibold text-[var(--ink,#0f2733)] font-[family-name:var(--font-display,'Playfair_Display',Georgia,serif)]">⚡ Donate to OnlyBoosts</h2>
            <button
              onClick={guardedClose}
              className="text-[var(--muted,#5a7488)] hover:text-[var(--ink,#0f2733)] transition-colors text-lg leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="px-4 sm:px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
            <MultiLegBoostForm
              user={user}
              splitsBundle={SHOW_SPLITS}
              episodeMeta={SHOW_EPISODE_META}
              presets={SHOW_PRESETS}
              shareTagline={SHOW_SHARE_TAGLINE}
              buttonLabel="Donate to OnlyBoosts"
              messagePlaceholder="Leave a note for OnlyBoosts"
              defaultMessage={prefillMessage}
              onCancelled={requestClose}
              onBoostState={setBoostState}
              onSettled={onSettled}
            />
          </div>

          {confirmLeave && boostState?.active && (
            <ConfirmLeaveOverlay
              paid={boostState.paid}
              total={boostState.total}
              onStay={() => setConfirmLeave(false)}
              onLeave={requestClose}
            />
          )}
        </div>
      </div>
    </>
  )
}

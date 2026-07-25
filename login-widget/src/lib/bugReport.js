/**
 * Bug-report publisher (ported from ReedBTC/mynostr).
 *
 * Credit: the whole pipeline (frontend modal → dedicated tag-gated relay
 * → polling watcher → GitHub issues, no backend service) is inspired by
 * Plebeian Market's bug-report widget. https://plebeian.market — thanks
 * to that team for the pattern.
 *
 * OnlyBoosts' bug-report channel rides the same dedicated relay mynostr and
 * LB use (`wss://relay.mynostr.app`), which only accepts events tagged with
 * the literal `["t", "onlyboosts-alpha"]` (enforced by the relay's
 * strfry write-policy plugin). Reports are kind 1 notes signed by the
 * user's logged-in key, published *only* to that one relay — never to
 * outbox, never to the pool. Isolation is the whole point: bug reports
 * don't pollute the user's feed and don't land on third-party indexers.
 *
 * Anti-pattern reminders (don't break these):
 *   - DO NOT publish() through the pool. Use the explicit relay set.
 *   - DO NOT add the bug relay to the user's read pool — reports leak.
 *   - DO NOT change the `t` tag without coordinating the relay's
 *     write-policy plugin (it requires the literal string) AND the
 *     bug-watcher filter.
 */
import { NDKEvent, NDKRelaySet, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { getNDK, signWithTimeout } from './ndk.js'
import { withTimeout } from './utils.js'

export const BUG_RELAY = 'wss://relay.mynostr.app'
export const BUG_TAG   = 'onlyboosts-alpha'

const PUBLISH_TIMEOUT_MS = 10_000

/**
 * Sign + publish a bug report. The modal passes the full text (it already
 * injected browser/page context, and any optional contact npub, into the
 * body for the user to review).
 *
 * Signs with the logged-in user's key when available (so the watcher
 * attributes the issue to their real npub); otherwise signs with a
 * single-use throwaway key so a logged-OUT user can still report — the
 * relay gates on the tag, not the signer. Throws on signer failure, relay
 * reject, or 10s timeout — the modal surfaces the message inline.
 */
export async function publishBugReport(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Bug report is empty.')
  }
  const ndk = getNDK()

  const ev = new NDKEvent(ndk)
  ev.kind    = 1
  ev.content = content
  ev.tags    = [['t', BUG_TAG], ['client', 'onlyboosts']]

  if (ndk?.signer) {
    await signWithTimeout(ev)
  } else {
    // Anonymous report — a fresh throwaway key, never persisted.
    await ev.sign(NDKPrivateKeySigner.generate())
  }

  const relaySet = NDKRelaySet.fromRelayUrls([BUG_RELAY], ndk, false)
  const publishedTo = await withTimeout(
    ev.publish(relaySet),
    PUBLISH_TIMEOUT_MS,
    'Bug-report relay didn\'t respond. Try again in a moment.',
  )

  // An empty accept-set covers several failure modes (rate-limited, wrong
  // tag, transient connect failure, malformed reject); NDK doesn't surface
  // the per-relay OK reason, so keep the message neutral.
  if (!publishedTo || publishedTo.size === 0) {
    throw new Error('Relay didn\'t accept the report. Try again in a moment, or check your network.')
  }
  return { id: ev.id }
}

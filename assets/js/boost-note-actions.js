/* Attach the Nostr reaction bar and the ⋮ menu to server-rendered boost notes.
 *
 * This is the rendering rule from CLAUDE.md at its most literal. A boost note is
 * a FACT — who sent it, how much, to what, and what they said — so
 * functions/_shared/detail-page.js renders it complete, at the edge, on
 * /show/<guid>, /episode/<guid> and /booster/<npub>. Reply, like, repost and zap
 * are VERBS: they need the reader's signer, so they cannot exist until
 * JavaScript runs. This module is the seam between the two.
 *
 * The result is one boost note across the whole site. The homepage Boosts feed
 * builds the same .note-card in the browser because it has no server render to
 * enhance; these three pages ship it finished and this adds the same bar to it.
 * Both go through boost-actions.js#buildActionBar, so there is one reply
 * composer, one like, one repost and one zap modal rather than two of each.
 *
 * ⚠️ buildActionBar DOES TWO THINGS. It RETURNS the action bar, and it APPENDS
 * the ⋮ menu into `cardEl.querySelector('.note-author')` itself. So the card's
 * author row has to exist and carry that class before this runs, which is why
 * the server emits it rather than something page-specific.
 *
 * ⚠️ A NEW MODULE, not a ninth export from detail-page.js. All three pages
 * import that file, assets ship max-age=14400 on their own clocks, and an
 * unresolved named import is a link-time error that takes a page's whole
 * JavaScript down rather than costing one feature. A URL with no cached old
 * version can only resolve or 404. Same shape as feed-note.js, show-desc.js and
 * booster-link.js; see the ob-v53 note in CLAUDE.md.
 *
 * It is LAZY IN TWO WAYS, because boost-actions.js pulls nostr-tools and the
 * login widget behind it and that is the heaviest thing any of these pages
 * would load. Nothing is imported until a boost note is close to the viewport,
 * and a reader who never scrolls to #boosts pays none of it. The notes are
 * readable and complete throughout.
 */
import { ensureLoginWidget } from '/assets/js/widget-loader.js?v=ob-v59'

/* The projection buildActionBar needs.
 *
 * ⚠️ NOT A VERIFIED EVENT, and it must never be passed anywhere that assumes
 * one. The reply / repost / like / zap paths need only the id and the pubkey;
 * `content` is here because the reply composer quotes it. This is the same
 * projection both feed renderers build, and the same caveat applies — see the
 * "Snapshot → card" note in CLAUDE.md.
 *
 * The message is read back out of `.note-body` rather than carried in a data
 * attribute: it is already in the DOM, and duplicating a 420-character string
 * onto every one of up to 500 cards is pure page weight. textContent, so the
 * mention chips and links inside it come back as the text they render.
 */
function projectEvent(card) {
  const id = card.dataset.eventId
  const pubkey = card.dataset.pubkey
  if (!id || !pubkey) return null
  return {
    id,
    pubkey,
    kind: 1,
    content: card.querySelector('.note-body')?.textContent || '',
    created_at: Number(card.dataset.ts) || 0,
    tags: [],
  }
}

/* Run `fn` when any of `els` comes near the viewport, once.
 *
 * The #boosts section is at the foot of all three pages, under the stats, the
 * rollups and the community wall, so most readers never reach it — and the
 * import behind this is the page's most expensive. 600px of margin means it is
 * normally in flight before the first card is on screen, and a deep link to
 * #boosts lands inside the margin and fires immediately.
 */
function whenApproached(els, fn) {
  if (typeof IntersectionObserver !== 'function') { fn(); return }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io.disconnect()
    fn()
  }, { rootMargin: '600px 0px' })
  for (const el of els) io.observe(el)
}

/**
 * Wire every server-rendered boost note on the page.
 *
 * Safe to call on a page with none — it returns immediately, which is why all
 * three page modules can call it unconditionally.
 */
export function initBoostNoteActions() {
  const cards = Array.from(document.querySelectorAll('[data-boost-note]'))
  if (!cards.length) return

  whenApproached(cards, async () => {
    let actions
    try {
      actions = await import('/assets/js/boost-actions.js?v=ob-v59')
      // The signer. Without it the bar still renders and each button reports
      // that it needs a sign-in, which is the same behaviour the feeds have.
      await ensureLoginWidget()
      actions.configureBoostActions({})
    } catch (err) {
      // The notes are complete without this. A failed import must cost the
      // reactions and nothing else, so there is no placeholder and no error
      // state — the page is exactly the page it was.
      console.warn('[boost-notes] actions unavailable', err)
      return
    }

    for (const card of cards) {
      const ev = projectEvent(card)
      if (!ev) continue
      try {
        // Appends the ⋮ into .note-author as a side effect; see the note above.
        card.appendChild(actions.buildActionBar(ev, card))
      } catch (err) {
        // One malformed row must not cost the other 499 their bars.
        console.warn('[boost-notes] action bar failed', err)
      }
    }
  })
}

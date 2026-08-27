// OnlyBoosts service worker
// - HTML: network-first (always try fresh, fall back to cache offline)
// - Boost snapshot (/api/community-boosts): stale-while-revalidate (returning
//   visitors see cached boosts instantly; the fresh snapshot loads in the
//   background for the next visit)
// - Widget bundles (/assets/widgets/*): stale-while-revalidate (serve
//   cached immediately, refresh in background, next page picks up new code)
// - Other same-origin static assets: stale-while-revalidate (serve cached
//   instantly, revalidate in background — deploys propagate within one
//   navigation without a VERSION bump, and a cached asset survives a
//   transient network blip instead of failing the whole resource load)
// - Cross-origin (fonts on first deploy, Nostr relays, third-party): pass through

// Fork note: the LB changelog that used to sit here (v13–lb-v43) was
// removed — it narrated merch, episode, and leaderboard work that no
// longer exists in this repo. The caching strategies it explained are
// unchanged and documented at the top of this file; the original
// rationale is still readable via `git show lb/main:sw.js`.

// ── OnlyBoosts ───────────────────────────────────────────────────────
// ob-v1: forked from localbitcoiners at lb-v43; version counter restarts.
// Cache keys are namespaced by VERSION, so the `ob-` prefix also guarantees
// no collision with an LB cache on a shared origin during local dev.
// ob-v2: site identity wired in (onlyboosts.social, npub, lightning address).
// login-widget.js and nostr-tools.js were both rebuilt, so bump to evict the
// stale stale-while-revalidate copies — a returning visitor holding the
// previous widget bundle would otherwise boost the old recipient.
// ob-v11: the Follows tabs are hidden while signed out. Required bump, not
// cosmetic: assets/js/sign-in-prompt.js was deleted, and a returning visitor
// holding the previous boosts-feed.js / feeds-podcasts.js would still carry a
// static import of it — a 404 on that import fails the whole module and the
// feed renders "couldn't load" instead of boosts.
// ob-v10: the Follows feeds now repaint on sign-in. The fix spans the widget
// bundle (which dispatches lb:session-change) and feeds.js/follow-set.js
// (which listen), so a returning visitor holding one half and not the other
// would still see the stale "Sign in to see this feed" for a navigation.
// ob-v9: nav rework — Donate button (login-widget.js rebuilt), Feeds /
// Community / More groups in Explore, and the coming-soon pages. The theme
// tokens and the widget bootstrap moved out of index.html into
// assets/css/theme.css and assets/js/nav-widget-boot.js; a returning visitor
// holding the precached index.html would otherwise render unstyled until
// those two new files fetched.
// ob-v8: feed order (Podcasts first), range-driven Podcasts titles, ranks
// restricted to Global, boost source line, subtitles removed.
// ob-v7: rank numbers on the ranked Podcasts sorts.
// ob-v6: Podcasts tabs restored to the episode-card feed (drawer, range
// filter, sort menu) on top of the new data, via ob-data.js#toEpisodeShape.
// podcasts-feed.js is gone; feeds-podcasts.js is back. Bump so a returning
// visitor doesn't hold a bundle pointing at the deleted module.
// ob-v5: new collector data feed. The site now reads /api/data/* (manifest,
// latest.json, month archives, per-show shards) instead of the single
// /api/community-boosts snapshot, which is gone along with feeds-podcasts.js.
// A returning visitor holding the old bundle would request an endpoint that
// no longer exists, so this bump is required, not cosmetic.
// ob-v4: all four feed loaders wired — boosts-feed.js and follow-set.js are
// new modules, feeds.js and feeds-podcasts.js changed. Bump so a returning
// visitor doesn't hold a stale feeds.js whose LOADERS map only had one entry.
// ob-v3: brand art + single-page rework. feeds.html and boosts.html were
// folded into index.html as four hash-routed tabs and deleted, so a
// returning visitor's precache still lists two URLs that now 404 — the bump
// is what drops them. Also picks up the new palette and the logo/favicon/
// banner PNGs.
// ob-v12: the two Follows tabs moved off the static shards onto the D1 query
// API (/api/v1/boosts/follows) via the new assets/js/ob-live.js. Required, not
// cosmetic: a returning visitor holding the previous boosts-feed.js /
// feeds-podcasts.js would keep downloading month archives to filter them
// client-side, and neither bundle imports the new module.
// ob-v13: nav and footer regrouped into Podcasts / Boosts columns, and
// /podcasts renamed to /shows. Required: a returning visitor's HTML cache
// holds pages whose links still point at /podcasts, which now costs a 301
// hop, and the runtime cache may hold the old page itself under a URL that
// no longer serves it. Also picks up page.css, where the about page's jump
// links became a numbered table of contents and the live stat strip came
// out entirely, and index.html's feed tabs, which now have hairline
// dividers between them.
// ob-v14: the boost-count pill came off the two Boosts panels. The markup
// and the code that filled it went together, so a returning visitor holding
// one half without the other would render an empty capsule.
// ob-v15: the Podcasts · Follows corpus is now one request instead of eight.
// assets/js/ob-live.js asks /api/v1/boosts/follows for the whole row budget
// at once, and the endpoint raises its own clamp to allow it. Required: the
// old module is what pins the request to 200 rows a page, so a returning
// visitor holding it keeps paying ~2s of serial round trips even though the
// deployed Function would answer in one.
// ob-v16: the four-tab ribbon became two dropdowns in a sticky feed bar, and
// the range/sort controls moved out of the panel heads into it. Required: the
// bar's markup lives in index.html while the controls that mount into it come
// from the new assets/js/feed-controls.js, so a returning visitor holding the
// old index.html would render a page whose feeds can't find their slot (and
// one holding the old feeds-podcasts.js would look for a panel head that is no
// longer there).
// ob-v17: the Shows feed is real. assets/js/shows-feed.js is a new module and
// feeds.js is what maps `shows` to it, so a returning visitor holding the old
// feeds.js would pick Shows from the menu and get a placeholder. Also carries
// the nav/footer change pointing Shows at /#shows instead of the /shows
// coming-soon page, which is cached HTML on every page of the site.
// ob-v18: the episode feed is called Episodes, not Podcasts — Shows made the
// old name ambiguous. Feed keys, panel ids and URL hashes went with it
// (#podcasts-* is aliased, not dropped). Required: the keys live in index.html's
// markup and in feeds.js's LOADERS, so a returning visitor holding one half
// without the other would find no panel for the feed it activates. Every page
// is also re-cached for the nav/footer's new hashes.
// ob-v19: the Explore menu and footer are regrouped into Feeds / Stats / More,
// and /stats is a new coming-soon page. Required: the nav and footer are baked
// into every page's HTML, so a returning visitor keeps the old grouping (with
// its Global/Follows entries and no Stats column) until the cache turns over.
// ob-v20: the about page's live stat strip is back (restored from 7f35bf4^).
// Required: the markup is in about.html and the .stat-* rules are in page.css,
// so a returning visitor holding one without the other gets either an unstyled
// row of numbers or nothing at all.
// ob-v21: every feed has a search box at the head of its panel. Not required
// for correctness — the slot is in index.html and the new
// assets/js/feed-search.js only fills a slot it finds, so either half alone
// degrades to the feed as it is today — but the feature is invisible until
// both land, and index.html is the cached half.
// ob-v23: the about page's publisher list drops Bowl After Bowl. Required
// because it is a factual correction about a named third party: HTML is served
// stale-while-revalidate, so without a bump a returning visitor reads the
// wrong list once more before the cache turns over.
// ob-v24: the about page's collector cadence was three times too slow (the
// incremental scan is every 5 minutes, not 15). Same reason as v23 — a stale
// page states a wrong figure to a returning visitor for one more navigation.
// ob-v27: the scope-qualifier pass. "Supporters" is gone from every visible
// string (it claimed an audience this data cannot see), the show page's wall is
// "Nostr Community", rollup cards label their figures "Nostr Stats:" and the
// episode drawer is "Nostr Interactions". Required on two counts, not
// cosmetic. The show page's own numbers are re-described, and it is the page
// podcasters share, so a stale copy misstates a third party's figures for one
// more navigation (same reason as v23). And the Episodes card moved its counts
// out of the drawer bar into the body: that markup comes from feeds-podcasts.js
// while the .pcast-nstats / .ob-stats-label rules are inline in index.html, so a
// returning visitor holding one half without the other renders the new line
// unstyled. Also carries the masthead subtitle, the FAQ rewrite and the
// manifest description.
// ob-v28: show pages speak the medium (a music feed says Album / Tracks /
// "Boost this Album" / MusicAlbum JSON-LD), boost messages on those pages
// render nostr: mentions as @Name chips, and the episode drawer label gained
// its colon. Required for the mentions: the markup comes from the Function
// while the .boost-msg a rules are new in show-page.css, so a returning visitor
// holding the old stylesheet renders the chips as unstyled body text.
// ob-v29: an identity the index doesn't have now falls back to Primal's cache
// instead of painting as `@npub1abc…`. New module assets/js/primal-profiles.js
// (extracted from boosts-thread.js, which now imports it), wired into the
// Boosts feed and the show pages; the Episodes feed already did this. Required:
// boosts-thread.js lost its own copy of the Primal client, so a returning
// visitor holding the precached old boosts-thread.js alongside a new
// boosts-feed.js would import a module the cache has never seen.
// ob-v31: the Shows and Albums search matches a show's author, so an artist or
// host finds their own work ("Theo Katzman" reached nothing before). Required,
// and for the sharpest reason in this list: shows-feed.js gains a STATIC import
// of getShowAuthors from ob-data.js. A returning visitor holding a new
// shows-feed.js against a cached old ob-data.js fails that import binding at
// link time, which kills the whole module — the Shows feed would render its
// placeholder and nothing else. The two files ship together or not at all.
// Also carries the show-page credit line ("Artist" on music, "By" on podcasts):
// the markup comes from the Function, which the SW never caches, but the
// .show-credit rules are new in show-page.css, which it does — so without the
// bump a returning visitor reads the credit as unstyled body text.
// ob-v32: show pages gained the "Other Shows/Albums This Community Boosts"
// drawer. The markup comes from the Function (never cached here), but its
// .cs-* rules are new in show-page.css and the sort wiring is new in
// show-page.js, both of which are — so a returning visitor would get an
// unstyled list that doesn't sort.
// ob-v33: that drawer lost its range control and gained a per-row boost button,
// and the Shows/Albums feed cards gained one too. Required, and for the same
// reason ob-v31 was: shows-feed.js gains STATIC imports of value-block.js,
// widget-loader.js, episode-link.js and copy-npub.js. A returning visitor
// holding a new shows-feed.js against a cache that has never seen one of those
// fails the import binding at link time and the whole Shows feed dies. Also
// carries the community wall's five-card podium (top 21 shown, not 24), whose
// grid rule is in show-page.css while the counts are in the Function.
// ob-v34: one circle boost button everywhere (Episodes, Songs, Shows, Albums
// and the /show community drawer), the episode cards' "↓ Download MP3" row
// removed, and show artwork gained a second-chance URL. Required on both
// counts: feeds-podcasts.js and shows-feed.js gain STATIC imports of two new
// modules (boost-button.js, cover-art.js) and ob-data.js gains one, so a
// returning visitor holding a new renderer against a cache that has never seen
// them fails the import binding and the feed dies. The .ob-boost-pill rules
// are new in theme.css, which every page loads, and the .pcast-btn block that
// index.html no longer needs came out of it.
// ob-v35: the boost button is a tight blue pill reading "Boost" rather than an
// icon-only circle, which was too small a target; .ob-boost-circle is renamed
// .ob-boost-pill in theme.css. Required for a second reason too: ob-v34 shipped
// a show-page.css whose .cs-rank / .cs-art / .cs-title / .cs-meta rules had been
// deleted by accident, so the community drawer rendered at the 17px body serif
// with unstyled art. A returning visitor holds that stylesheet until this bump.
// ob-v36: the Nostr Community wall is rebuilt on localbitcoiners' supporters.html
// pattern — bare centered avatars, no card chrome, no rank numerals — and its
// podium wraps to three across on a phone. Required: the .sup-rank markup came
// out of the Function while the whole .sup-* block was rewritten in
// show-page.css, so a returning visitor holding the old stylesheet against the
// new markup gets boxed cards with no numbers in them.
// ob-v37: FIX — ob-v36 shipped a show-page.css missing its Recent boosts and
// Episodes sections and the .show-more rule, deleted by the same over-broad
// slice that cost the .cs-* rules in ob-v34. Boost cards rendered as plain
// text and both drawers lost their box and their scroll. Restored verbatim.
// ob-v38: episode artwork in the /show episode drawer, and the stat tiles gain
// a "Nostr Boost Stats" heading in place of the caveat paragraph beneath them.
// Required: .ep-art and .show-stats-title are new in show-page.css while the
// markup comes from the Function, so a returning visitor on the old stylesheet
// gets full-bleed episode art and an unstyled heading. Also drops .ob-scopenote
// from theme.css, which every page loads and none now mount.
// ob-v39: the /show episode drawer gains a sort, its community sibling drops
// the count from its summary, and the hero repairs a dead artwork URL through
// /api/value's new `art` field. Required: show-page.js gains a static import of
// cover-art.js, so a returning visitor holding a new show-page.js against a
// cache without that module fails the import and loses every interactive part
// of the page — the sorts, copy-npub and the boost buttons together.
// ob-v40: the /show drawers get a real header band, a rotating chevron and a
// SHOW/HIDE hint so a collapsed one reads as openable, the sort row moves off
// the page background that made it look like a gap punched through the card,
// and a back link lands above the hero. Required on both halves: .drawer-hint
// and .show-back are new rules in show-page.css against markup the Function now
// emits, so a returning visitor on the old stylesheet gets an unstyled "Back"
// and an empty span in each summary; initBackLink is new in show-page.js.
// ob-v41: the /show community drawer's rows get the art2 fallback the hero has
// had since ob-v39 — its query selected `image` and not `artwork`, so Homegrown
// Hits rendered broken in every drawer that listed it. Required: the data-art2
// attribute is new markup from the Function and initCommunityArt is new in
// show-page.js, and a returning visitor holding the old module gets the
// attribute with nothing reading it.
// ob-v42: the /show episode drawer's control band gains a "See All Episodes"
// link out to the show on BMB, at the left end opposite the sort. Required: the
// band now ships visible rather than being revealed by JavaScript, and .cs-
// allitems and the band's wrap/gap rules are new in show-page.css — a returning
// visitor on the old stylesheet gets an unstyled link crowding the sort pill.
// ob-v43: the /show pages gain the two <podcast:podroll> sections — what this
// show recommends and who recommends it — as grids of square artwork tiles
// between the Nostr Community wall and Recent Boosts. Required on both halves:
// every .pr-* rule is new in show-page.css against markup the Function now
// emits, so a returning visitor on the old stylesheet gets a vertical stack of
// full-width artwork instead of a 5-up grid; initPodrollArt is new in
// show-page.js, and the "Show N more" toggle moved from a supporter-specific
// listener to one delegated handler scoped to the button's own section, so an
// old module against the new markup leaves both podroll toggles dead.
// ob-v44: the /show sections become shareable URLs — /show/<guid>#podroll and
// the five others. Required on both halves: .show-section gains a
// scroll-margin-top in show-page.css without which every anchor parks its
// heading behind the 64px sticky nav, and revealHashTarget in show-page.js is
// what opens the episode drawer when #episodes is the target, so a returning
// visitor holding the old module lands on a collapsed box. The reverse podroll
// section's id changed from #podrolled-by to #inverse-podroll in the same
// commit; it had shipped hours earlier and nothing was linking to it, and the
// six ids are frozen from here (see the note at the top of the Function).
// ob-v45: the /show address bar now tracks the section being scrolled through,
// so the six ids are discoverable by reading the page rather than only by being
// told them; and "Inverse Podroll" becomes "Reverse Podroll", id and heading
// together. Required on the HTML half above all: a cached show page still
// carries id="inverse-podroll", so a shared /show/<guid>#reverse-podroll link
// resolves to nothing at all on it — and the HASH_ALIASES repair in show-page.js
// runs the other way, old id to new, which is the direction that keeps links
// already sent working. initHashSpy is new in the same module and needs nothing
// from the stylesheet.
// ob-v46: /episode/<item-guid> landing pages. Required, not cosmetic: the
// episode-card CSS that lived in index.html's inline <style> moved out to
// assets/css/feed-cards.css so the new pages could link it, and a returning
// visitor holding the PRECACHED index.html would render every feed card
// unstyled until that new file fetched. Same shape as the ob-v9 bump, which
// moved the theme tokens out of the same block. The episode TITLE on the
// Episodes and Songs cards also stops pointing at Boost Me Bitch and starts
// pointing at /episode/<item-guid>, which rides the same bump — as does the ⋮
// menus' scrollIntoView on open, which feeds-podcasts.js does for both surfaces.
// ob-v47: the chapters and show-notes drawers under the player on
// /episode/<item-guid>, inside a player card that now encloses the artwork, the
// title, the actions and both drawers; and the community-episodes section
// becomes the same .ep-drawer its show-page counterpart is. Required on both
// halves of that page's own pair, which are stale-while-revalidate in a
// VERSION-keyed cache: a returning visitor holding the old episode-page.css gets
// an unstyled card and drawers bleeding past their edges, and one holding the
// old episode-page.js calls /api/chapters, which no longer exists — that
// endpoint became /api/episode-meta when it grew the untruncated show notes, so
// the stale module leaves both the chapters drawer hidden and the notes cut at
// 100 words. Both correct themselves on the second navigation, which is the case
// this bump exists for.
// ob-v48: every episode link on the site now resolves to /episode/<item-guid> —
// the Episodes and Songs cards' artwork, title and "See all boosts", the Shows
// and Albums cards' episode drawer rows, the Boosts cards' episode title, and
// the URL written into a published boost note.
// Required, and the note path is why: episode-link.js is a cached module, so a
// returning visitor holding the old copy would keep PUBLISHING boostmebitch.com
// links into events that cannot be recalled. The two show-level links on
// /show/<guid> ("See All Episodes", the podroll tiles) are server-rendered and
// deliberately unchanged.
// ob-v49: the Episodes and Songs feeds rank server-side through
// /api/v1/episodes instead of rolling up latest.json + 3 months in the browser.
// Required rather than cosmetic: a returning visitor holding the old
// feeds-podcasts.js keeps ranking over a three-month window, which is the bug
// this replaces — it painted 84 of 601 songs and put the true #7 episode at
// #128. ob-data.js and ob-live.js carry the adapter and the reader it needs, so
// all three have to turn over together.
// ob-v50: feed search on Episodes and Songs queries /api/v1/episodes?q= instead
// of indexing the pages it has loaded. Required rather than cosmetic: a
// returning visitor holding the old feed-search.js + feeds-podcasts.js keeps a
// typeahead that can only find what they have already scrolled past, which is
// the half of the v49 ranking move that was missing — a show at #300 was
// unfindable until "load more" had been pressed nine times. ob-live.js carries
// the reader, and index.html the one rule the loading line needs, so all four
// turn over together.
// ob-v51: Shows and Albums rank and page through /api/v1/podcasts instead of
// downloading podcasts/index.json whole (~440KB of every show, to paint thirty
// cards) and GROUPing month archives by show in the browser. Required rather
// than cosmetic: a returning visitor holding the old shows-feed.js keeps a
// windowed ranking computed over whichever shards its archive walk happened to
// pull. ob-live.js carries the reader, so both turn over together.
// ob-v52: the Boosts feeds' Global scope pages /api/v1/boosts by cursor instead
// of opening on latest.json and walking month archives. Required rather than
// cosmetic: the shard lags its own edge by the collector's publish interval, so
// a returning visitor holding the old boosts-feed.js keeps a feed that is
// missing the newest boosts it exists to show. With this, no client module
// fetches a static shard at all.
// ob-v53: a 1Y range on the four ranked feeds, and a line above each of their
// search boxes naming the corpus the ranking was computed over. Required rather
// than cosmetic on both halves. A returning visitor holding the old
// feed-controls.js sees no 1Y button at all, since the range table is a cached
// module rather than markup; and index.html carries both the note slot the
// renderers fill and the one rule that styles it, so a stale copy of it would
// leave a fresh feeds-podcasts.js writing into an element that isn't there.
// index.html, feed-controls.js, feeds-podcasts.js, shows-feed.js, boosts-feed.js
// and feed-cards.css turn over together.
// Carries one repair with it: /episode/<guid>'s community-episodes section had
// been calling feeds-podcasts.js#sortItems / #filterItems, which that module
// stopped exporting in ob-v49 when its ranking moved into /api/v1/episodes. The
// section painted its heading, drawer and controls over an empty list. The two
// now live in episode-page.js, where the corpus is bounded and ranking it in
// memory is correct; a returning visitor holding the old module keeps the empty
// section until this bump reaches them.
// ob-v54: the hotfix for what ob-v53 broke, and the rule that stops it
// recurring. v53 added mountFeedNote / resetFeedNote / WALKED_RANGE_OPTIONS to
// feed-controls.js and imported them from all three feed renderers. Assets ship
// max-age=14400, so the browser holds each module URL for up to four hours ON
// ITS OWN CLOCK: a reader with a stale feed-controls.js and a fresh renderer got
// "does not provide an export named 'mountFeedNote'", and an unresolved named
// import is a LINK-TIME error, so the renderer never ran and all eight feeds
// failed at once. A VERSION bump cannot close that window — the service worker's
// cache is only consulted for clients it already controls, and the HTTP cache
// underneath is per-URL regardless.
// The note helpers moved to assets/js/feed-note.js, a new URL that has no cached
// old version anywhere and so can only resolve or 404; WALKED_RANGES is derived
// in boosts-feed.js from the RANGE_OPTIONS that module already exported, which
// degrades to "no 1Y button" against an older copy instead of throwing. All 12
// old/new combinations of the three renderers against both feed-controls
// versions were checked to resolve.
// ob-v55: the show's own description on /show/<guid>, above the stat tiles,
// fetched live from Podcast Index at render time rather than stored. Required
// on the stylesheet half: every .show-desc rule is new in show-page.css against
// markup the Function now emits unconditionally, so a returning visitor holding
// the old copy would get the description at body size, unclamped and with no
// "More" — readable, but the whole hero pushed down the page.
// The JavaScript half is safe either way by construction. show-page.js gains a
// static import of assets/js/show-desc.js, which is a NEW URL with no cached old
// version, so it can only resolve or 404; and a stale show-page.js simply never
// imports it, which costs the clamp and nothing else, since the description
// renders expanded and this collapses it rather than the other way round.
// ob-v56: the NIP-46 transport set drops two dead relays and the
// nostrconnect:// URI names the permissions it wants. Both live inside the
// rebuilt assets/widgets/login-widget.js, and the bump is what a returning
// visitor needs to get it on the first navigation rather than the second —
// the point of the fix is a signer login that stops waiting on a relay whose
// TCP connect never completes, and a visitor holding the old bundle keeps
// waiting. No other asset changed, and nothing outside the bundle reads
// either value, so this bump is required only for the widget's sake.
// ob-v57: /booster/<npub>, the third detail page. Almost all of it is NEW URLs —
// the Function, booster-page.js, booster-page.css — which a returning visitor
// cannot hold a stale copy of, so they need no bump at all. Exactly one SHARED
// asset changed: primal-profiles.js gained `about`, `website` and `banner` on
// the object parseProfileEvent returns, which is what fills the new page's bio
// and lightning-address chip for a booster the collector has no kind-0 for.
// A field is safe where a named export is not, so a stale copy degrades to
// `undefined` and simply backfills nothing rather than failing to link — this
// bump is what makes that header complete on the FIRST navigation instead of up
// to four hours later. Nothing else on the site reads those three fields.
// ob-v58: every booster's display name and avatar now links to
// /booster/<npub>, across the Episodes/Songs drawer rows, the Boosts cards, the
// Nostr Community wall and the boost lists on both detail pages.
//
// REQUIRED, and the CSS half is why. The renderers now emit <a> where they
// emitted <button> and <span>, and the rules that keep those anchors looking
// like the controls they replaced live in feed-cards.css, boosts-thread.css and
// show-page.css. A returning visitor holding fresh JavaScript against any stale
// one of those three gets underlined, link-blue names through the feeds — the
// same shape as the ob-v47 pairing, where a page's two halves have to turn over
// together.
//
// The JavaScript half degrades gracefully on its own: booster-link.js is a NEW
// module, so a browser can only resolve or 404 it, and a stale feed renderer
// simply keeps copying npubs on click. It is the stylesheets that cannot lag.
// ob-v59: boost notes get the full Nostr treatment on /show, /episode and
// /booster — the same .note-card the homepage Boosts feed paints, with the same
// reply/repost/like/zap bar and ⋮ menu. First change built under the rendering
// rule now recorded in CLAUDE.md: the note is a FACT and is server-rendered
// complete, the reactions are VERBS and attach afterwards.
//
// REQUIRED, and the stylesheet is why. `.ob-boost-*` moved OUT of index.html's
// inline <style> into boosts-thread.css so all four surfaces can share one
// definition — the same extraction feed-cards.css made for /episode. A returning
// visitor holding the precached index.html against a fresh boosts-thread.css, or
// the reverse, paints the Boosts feed's meta row unstyled. Same shape as the
// ob-v9 and ob-v55 bumps, which both moved rules out of that same block.
// ob-v60: reposts carry the note they repost. handleRepost only embedded the
// original when `ev.sig` was present, and no surface on this site has it — every
// card builds a projection off a D1 row or a JSON feed, because the signed event
// is not stored anywhere we read. So every repost ever published from here had
// empty content AND an empty relay hint, which is valid NIP-18 and still did not
// render: 98% of boost notes live on relay.fountain.fm only, so a bare kind-6
// asks the reader's client to fetch something it cannot reach. It fetches the
// original through NDK now and embeds it. Required: boost-actions.js is a cached
// module and a returning visitor holding the old copy keeps publishing reposts
// that render as empty cards — and a published event cannot be recalled.
// ob-v61: the episode card became one definition, rendered at the edge and in
// the browser (assets/js/episode-card.js), and the homepage's opening feed is
// server-rendered into index.html by functions/index.js. REQUIRED on both
// counts. The card's drawer is a <details> now rather than a button and a hidden
// div, and feed-cards.css carries the rules that style a <summary> — a returning
// visitor holding the old stylesheet against the new markup gets a disclosure
// triangle beside the caret and no rotation. And `/` is a Pages Function
// response rather than a static file, so the precached copy of it is a document
// that no longer exists; it is dropped from PRECACHE_URLS below for that reason.
// ob-v73: /api/v1/*, /api/value and /api/episode-meta leave the static-asset
// catch-all. Every one of them fell through to staleWhileRevalidate(STATIC_CACHE),
// which answers with the CACHED copy whenever one exists, so a returning visitor
// was served the boost list from their previous visit and the fresh response
// only landed for the next load: a boost live in D1 took two reloads to appear.
// The Follows feeds never showed it because they POST, which this handler
// ignores. Those endpoints are network-first now, with the cached copy as an
// offline fallback only; /api/value is never cached at all, since a stale value
// block is the one answer here that would move sats to a split the show no
// longer publishes. /api/lnurl joined it in ob-v91 for a sharper version of the
// same reason: it returns bolt11 invoices, and a cached invoice is one the
// donor may already have paid. /api/data/ keeps stale-while-revalidate: it is a 5-minute
// snapshot where instant paint is the right trade. REQUIRED: the bump renames
// STATIC_CACHE, which is what drops the poisoned API entries a returning
// visitor already holds; without it the fix reaches nobody currently affected.
// ob-v74: the homepage's boost drawers fill on open (episode-card-actions.js#fillLazyDrawer) instead of shipping every note.
// ob-v75: /show and /episode carry a rank row above the stat tiles — the
// subject's all-time global rank by boosts, sats and boosters, from
// functions/_shared/feed-rank.js.
// ob-v76: the rank row folded into the stat tiles as each tile's third line
// (.show-stat-rank in show-page.css); the tiles' flex order changed with it.
// ob-v77: the rank is a STANDARD COMPETITION rank now (ties share the better
// place, golf's T marks one) with no denominator, and a shared caption under
// the tiles names the feed. .show-stats-cap is new in show-page.css.
// ob-v78: the FEEDS rank the same way, so a card's numeral agrees with the page
// it links to. assets/js/rank.js is a new two-sided module and four renderers
// import it; REQUIRED, since a returning visitor holding the previous
// feeds-podcasts.js or episode-section.js has no such module to resolve and an
// unresolved import is a link-time error that blanks the whole feed.
// ob-v79: the stat tile's rank becomes a tinted band across the tile's foot
// rather than a third line, which was inheriting Playfair and brand blue from
// `.show-stat dd`'s font shorthand and reading as bolted on. CSS only.
// ob-v80: and the band becomes a CORNER CHIP, half the height. The renderer
// emits .show-stat--ranked to reserve its line, so this one is not CSS-only —
// a returning visitor holding the old CSS with the new markup gets a chip with
// no room, which is why the bump matters.
// ob-v81: the chip's rule was losing the cascade to `.show-stat dd` (0,1,1 vs
// 0,1,0), so it rendered at 1.5rem Playfair in brand blue — the figure's own
// type — inside a pill sized for 0.63rem. Selector is now compound. CSS only.
// ob-v82: the feed cards carry the tie marker too, as golf's bare `T4` beside
// the card rather than the tile chip's `T#4`. rank.js gained rankLabel() and
// competitionRanks() now reports `tied`, so every renderer that imports it
// changed together — required, since a returning visitor holding one half gets
// a card numbered by a function whose shape moved.
// ob-v90: the same reassurance one state earlier. A leg measured 45.5s inside
// the wallet's own sendPayment, which is before the watcher ever starts, so the
// paying phase gained its own stage ladder off the leg's `startedAt`.
// ob-v89: waiting on a slow leg is presented as work in progress rather than
// as a warning, with copy that changes so the screen cannot read as hung. The
// warning moved to the end of the watch, where the donor first has a decision.
// ob-v88: the Nostr login is no longer a gate on the wallet. A visitor with
// no identity can connect a wallet and boost with it; the connection is
// session-only because the at-rest scheme encrypts the NWC URI to the user's
// own signer. The widget bundle changed, so a returning visitor needs the new
// URL.
// ob-v114: the show card is two-sided. assets/js/show-card.js emits it as an
// HTML string and assets/js/show-card-actions.js attaches its verbs, so the
// same definition can render at the edge and in the browser — which is what
// lets the homepage open on Shows without going back to painting a shell.
// shows-feed.js is now the feed around that card rather than the card itself.
// REQUIRED: shows-feed.js gains static imports of two modules that have never
// existed, so a returning visitor holding the old copy against a fresh graph is
// the ob-v53 link-time failure exactly.
// ob-v115: the what-dropdown became three tabs — Podcasts, Music, Members —
// on Local Bitcoiners' feeds.html pattern, with the sub-feed on a row under
// them. index.html's markup and inline CSS changed; no module did. Bumped so
// the build is identifiable from sw.js, which is how a deploy gets verified
// here, and because /index.html is precached under the versioned cache name.
// ob-v116: the sub-feeds are blocks aligned under the tab they belong to, and
// the sticky chrome is one ground again. The sub-row carried `--tint`, which
// put the feed's own wash between two bands of `--cream` and made the header
// read as four alternating stripes. index.html only.
// ob-v117: the Boosts feed's search asks the index instead of the rows in
// memory. New endpoint /api/v1/members, two readers in ob-live.js, and
// boosts-feed.js fetches a picked member's own boosts rather than filtering
// what is loaded. REQUIRED: ob-live.js gains exports boosts-feed.js imports
// statically, which is the ob-v53 link-time failure exactly.
// ob-v118: the seam between the tabs and the sub-feeds runs all the way
// across, including under the selected tab, where the two share a fill and had
// merged into one slab. `--accent-d` inside the accent column so it reads as a
// fold; the sub-blocks touch each other and the tab above, like the tabs do.
// ob-v119: the homepage track is 60rem, the width /show, /episode and
// /booster already use. It was 720px, so the column changed width the moment a
// reader clicked through to a detail page. index.html only.
// ob-v120: /api/v1/members/hours — the 40 HPW boards, this week and the best
// weeks ever recorded. Backend only; nothing renders it yet.
// ob-v121: the 40 HPW boards render on the Members tab. New module
// assets/js/members-board.js, lazily imported by feeds.js when either boosts
// feed activates. index.html gains the block and its styles.
// ob-v122: the 40 HPW boards actually render. They were hooked to
// lb:feed-activate only, which the cold load does not go through, so the
// section was an empty gap on every reload and every shared link. The copy
// spans the track now instead of taking a prose measure.
// ob-v123: the member wall lands on the Members tab, and it is the SAME wall
// /show and /episode render — renderSupporters and its CSS both moved into
// two-sided files rather than being copied. /api/v1/members with no q is the
// top-members listing. REQUIRED: three page modules now import initShowMore
// through a module that did not exist, which is the ob-v53 link-time failure.
// ob-v124: #40HPW gains its challenge subtitle and a Rules dialog, replacing
// two paragraphs that said the same thing twice; the boards read hpw; and the
// member wall ranks three ways — sats, boosts, shows.
// ob-v125: publisher keys are out of the member LISTING and still in the
// SEARCH. chadf_boostbot topped both the boosts and shows orderings on other
// people's listening. PUBLISHERS moved to _common.js so one list serves the
// wall and the 40 HPW boards.
// ob-v126: the four publisher keys get a Boost Bots section of their own, so
// the exclusion above is shown rather than merely applied, and the Members
// intro's (i) links out to /about#membership. about.html gains both anchors.
// ob-v127: the member lookup leaves the Boosts panel, leads the tab, and
// NAVIGATES to /booster/<npub> instead of filtering the feed; the member wall
// gains the feeds' own range and sort controls rather than a shape of its own.
// ob-v128: the feed bar is MOVED into the Members tab, under the three sections
// above the boost list, and moved back on every other tab. index.html only.
// ob-v129: all four Members sections take the detail pages' shell and lid, and
// an empty range keeps its controls instead of replacing them with a dead end.
// ob-v130: the Boosts lid rejoins its own feed as one two-element shell, and
// the note feed gains 1Y — not a new query, but the treatment All already had.
// ob-v131: the members feed is addressed as #members (#boosts-global and
// #boosts-follows are ALIASES now and must stay so — they were the shipped
// hashes until this version), and the all-time board is High Scores.
// ob-v132: /booster's stat tiles carry rank chips, over the member wall's own
// population, and the episodes tile comes off because nothing ranks by it.
// ob-v136: the phone's tab chips read the accent's new fourth step. White on
// --bg-accent was 2.50:1 and the same colour as ink on cream was 2.29:1, so the
// Members chip was illegible either way and Shows was marginal; every -dd is
// >= 6:1 now. Also: the #40HPW board titles are centred, and the Boost Bots
// section is "Shoutout to the Boost Bots".
// ob-v135: #40HPW weeks reset at midnight US Pacific instead of 00:00 UTC.
// Monday 00:00 UTC is Sunday evening across the Americas; Pacific is the last
// US zone into Monday. The Rules dialog and the This Week sub-line say so.
// ob-v134: the LB strip finishes. feeds.js loses the whole Events path
// (50.4KB → 12.4KB), boosts-thread.js loses the megathread fetch (29.6KB →
// 18.4KB), calendar-events.js and supporter-set.js are deleted, and the widget
// bundle drops 22 dead source files (1,051KB → 929KB). /boosters is deleted
// too. REQUIRED: calendar-events.js leaves PRECACHE_URLS, so a returning
// visitor holding the old list would keep trying to precache a 404.
// ob-v133: PHASE D — the front door opens on Shows / All / Most boosters.
// functions/index.js server-renders show cards into <!--OB:SSR-SHOWS-->
// inside the Shows panel and shows-feed.js adopts them; the Episodes panel
// ships its placeholder again, one feed being rendered at the edge and it
// being the one on screen.
// ob-v139: the #40HPW row's episode figure says what it counts. It is episodes
// that CONTRIBUTED HOURS, not episodes boosted, and the two differ whenever a
// boosted episode has no duration — 2.2% of the index but 8.5% of recent
// boosts, since This Week is made of episodes that aired days ago. No query
// change; the board was already correct.
// ob-v138: boost note cards name the app that published them ("100⚡ via
// Fountain"), from the collector's client_id rather than the raw NIP-89 tag —
// so the Boosts feed's own "via" line, which needed a tag 1.3% of boosts carry,
// is replaced by a chip in the meta row that 99.8% of them get. And the NIP-47
// clean-failure codes move into the shared classifier, which closes the same
// gap on the live zap path: a FAILURE_REASON_NO_ROUTE was reading as UNCERTAIN
// and withholding the manual-invoice fallback. REQUIRED: boost-list.js gains an
// import, and the three page queries now select client_id.
// ob-v137: the episode number is dropped from every surface that rendered it
// (the /show drawer rows, the boost rows' episode chip, the /episode hero
// line); the two community rollups split on medium, so a podcast page says
// "Other Shows" and an album page "Other Albums"; the Episodes/Songs boost
// drawer is titled "Nostr Boosts" rather than "Nostr Interactions"; and the
// masthead moves to a transparent banner. REQUIRED: the drawer label and the
// card are one two-sided module, so a browser holding the old episode-card.js
// against a freshly-rendered page would paint two different labels in one list.
const VERSION = 'ob-v146';
const STATIC_CACHE = `${VERSION}-static`;
const HTML_CACHE = `${VERSION}-html`;
const WIDGET_CACHE = `${VERSION}-widgets`;
const SNAPSHOT_CACHE = `${VERSION}-snapshot`;
const API_CACHE = `${VERSION}-api`;

// What we precache on SW install. Widget bundle deliberately excluded —
// it's only needed when a user clicks Boost, not on every visit. Lazy
// loading the bundle on first interaction keeps cold-load lighter.
//
// The boost-feed snapshot (/api/community-boosts) is excluded too: it's
// large and refreshes hourly, so stale-while-revalidate handles it
// better than precaching a copy that's stale by first paint.
// ⚠️ `/` IS NOT PRECACHED ANY MORE, and `/index.html` is what replaced it.
// Since ob-v61 the homepage is a Pages Function that injects thirty rendered
// episode cards into the static file, so `/` is ~1.1MB of markup — precaching it
// would spend that on every service-worker install, for a document the runtime
// HTML cache picks up from the navigation the reader has just made anyway
// (see the isHTMLRequest branch below, which caches every successful one).
//
// `/index.html` stays, at 54KB: it is the OFFLINE FALLBACK the fetch handler
// reaches for when a navigation fails with nothing cached for that URL, and it
// is the un-injected shell, which hydrates its own feed exactly as it did before
// this. That is the right thing to have offline.
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.webmanifest',
  '/assets/onlyboosts_favicon.png',
  '/assets/onlyboosts_pfp.png',
  // The masthead's banner. The TRANSPARENT one, which is the copy the page
  // actually renders; the opaque `onlyboosts_banner.png` beside it is the
  // og:image fallback, fetched by preview crawlers and never by a browser, so
  // precaching it spent 93KB on every install for nothing.
  '/assets/onlyboosts_banner_clear.png',
  '/assets/avatar-fallback.svg',
  '/assets/css/theme.css?v=ob-v146',
  '/assets/css/page.css?v=ob-v146',
  '/assets/css/nav.css?v=ob-v146',
  '/assets/css/footer.css?v=ob-v146',
  '/assets/css/boosts-thread.css?v=ob-v146',
  '/assets/css/boost-actions.css?v=ob-v146',
  // The episode card and its drawer. Precached alongside the others because the
  // homepage's feeds are painted in it and it used to be inline in index.html,
  // which IS precached — leaving it out would trade an inline block for a
  // network round trip on the one page this list exists to make fast.
  '/assets/css/feed-cards.css?v=ob-v146',
  '/assets/js/boosts-thread.js?v=ob-v146',
  // A static import of boosts-thread.js, so precaching that without this one
  // leaves a returning visitor fetching half the graph from the network.
  '/assets/js/primal-profiles.js?v=ob-v146',
  '/assets/js/boost-actions.js?v=ob-v146',
  '/assets/js/nav.js?v=ob-v146',
  '/assets/js/nav-widget-boot.js?v=ob-v146',
  '/assets/js/widget-loader.js?v=ob-v146',
  '/assets/js/sw-register.js?v=ob-v146',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Best-effort precache: don't fail install if one asset is missing
      Promise.all(
        // { cache: 'reload' } forces each precache fetch past the browser
        // HTTP cache, so a VERSION bump re-pulls genuinely fresh assets
        // (e.g. images replaced under the same filename) instead of
        // re-caching a stale copy the browser already had.
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isHTMLRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

function isWidgetRequest(url) {
  return url.pathname.startsWith('/assets/widgets/');
}

function isSnapshotRequest(url) {
  return url.pathname.startsWith('/api/data/');
}

// Everything under /api/ that is not the static snapshot proxy: the D1 query
// API (/api/v1/*), the value-block resolver (/api/value) and the Podcast Index
// metadata lookup (/api/episode-meta). These are live answers, not assets, and
// must never be served stale while the network is up.
function isLiveAPIRequest(url) {
  return url.pathname.startsWith('/api/') && !isSnapshotRequest(url);
}

// ⚠️ THE TWO MONEY ENDPOINTS GET NO CACHE IN EITHER DIRECTION: network or
// nothing. Both would otherwise land in isLiveAPIRequest's network-first
// bucket, which keeps a copy to serve when the network is down, and for these
// two an offline answer is worse than no answer.
//
// /api/value resolves value blocks, and a stale one pays a split the show no
// longer publishes.
//
// /api/lnurl hands back a BOLT11 INVOICE, which is single-use and expires. A
// cached one offered again is an invoice the donor may already have paid or
// that is long dead — the same double-pay shape Phase 0 spent a week closing,
// arriving through the cache instead of through a button. Its metadata mode
// would be harmless to cache, but one path serves both and the invoice is the
// one that matters.
function isUncacheableMoneyRequest(url) {
  return url.pathname === '/api/value'
    || url.pathname.startsWith('/api/value/')
    || url.pathname === '/api/lnurl'
    // ⚠️ A CACHED DESCRIPTOR IS ANOTHER BOOST'S METADATA. `/api/boostbox`
    // answers with a URL that a podcaster's Helipad will fetch to learn what
    // this payment was for, so serving a previous response would attach the
    // wrong message, amount and episode to this leg — the same class of harm as
    // a cached bolt11, arriving at the recipient's end rather than the donor's.
    || url.pathname === '/api/boostbox'
    // ⚠️ A CACHED KEYSEND DOCUMENT ADDRESSES THE PAYMENT ITSELF. `/api/keysend`
    // answers with the node pubkey an upgraded lnaddress leg is paid to, and
    // the custom record that routes it to that account on a shared node. A
    // stale copy therefore sends the sats to the wrong destination outright —
    // the most direct harm of anything in this list, and the same class as
    // `/api/value` paying a split the show no longer publishes.
    || url.pathname === '/api/keysend';
}

// Stale-while-revalidate helper: serve cached immediately if present,
// fetch fresh in the background, update cache for next visit. Falls
// back to network-only when no cached copy exists yet.
//
// The background fetch uses { cache: 'no-cache' } so it always REVALIDATES
// with the server (conditional request → 304 or fresh) instead of being
// satisfied by the browser's HTTP cache. Cloudflare Pages serves assets with
// `max-age=14400` (4h), so a plain fetch could re-populate the SW cache with a
// copy up to 4h stale — which made deploys look "stuck" for frequent reloaders
// even after a VERSION bump. Revalidating kills that window; the cached copy is
// still returned instantly, so first paint isn't slowed.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkP = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  return cached || networkP;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHTMLRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache real successful same-origin responses. Without
          // this guard, a 5xx page or Cloudflare challenge HTML would
          // get cached and served as the offline fallback for that
          // URL until the next successful fetch — returning visitors
          // could land on a stuck error page. Mirrors the guard the
          // static-asset branch already has below.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(HTML_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  if (isLiveAPIRequest(url)) {
    if (isUncacheableMoneyRequest(url)) return; // network only, never cached
    // Network-first: the response is the live state of the index, so a cached
    // copy is only ever the offline fallback. Cached in its own bucket so an
    // API answer can never be confused with a static asset.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  if (isSnapshotRequest(url)) {
    // Boosts show up instantly on repeat visits from the cached snapshot;
    // the fresh one updates the cache in background. The Pages Function
    // already caches upstream for 5 min, so freshness is bounded.
    event.respondWith(staleWhileRevalidate(request, SNAPSHOT_CACHE));
    return;
  }

  if (isWidgetRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, WIDGET_CACHE));
    return;
  }

  // Other same-origin static assets (CSS, JS, images): serve the
  // cached copy instantly and revalidate in the background. A cached
  // asset stays usable through a transient network failure, and a deploy
  // is picked up on the next navigation without needing a VERSION bump.
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

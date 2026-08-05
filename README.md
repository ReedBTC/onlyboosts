# OnlyBoosts

A Nostr client for podcast boosts.

Podcasting 2.0 apps let listeners send sats to a show mid-episode, usually
with a message attached; a *boostagram*. A handful of those apps also publish
the boost to Nostr as a kind-1 note. OnlyBoosts collects those notes from
across the whole network and serves them as feeds you can rank, search, reply
to and boost back from.

Live at [onlyboosts.social](https://onlyboosts.social).

## The Feeds

Five feeds on the homepage, picked by two dropdowns on two axes: what you are
looking at, and whose boosts it is built from.

| Feed | Card | Scopes |
|---|---|---|
| **Episodes** | one episode, ranked by the boosts it received | Global · Follows |
| **Shows** | one show, the same boosts rolled up a level | Global |
| **Songs** | Episodes, narrowed to music feeds; a card is a track | Global · Follows |
| **Albums** | Shows, narrowed to music feeds | Global |
| **Boosts** | one kind-1 boost note, newest first | Global · Follows |

Songs and Albums are not separate renderers. `<podcast:medium>` splits the
corpus, and each pair differs only by a copy table; music goes to Songs and
Albums, everything else to Episodes and Shows.

Global ranks over every boost in the index. Follows ranks over boosts from the
accounts in your kind-3 contact list, which requires a signed-in npub.

Every feed carries a 1W/1M/1Y/All range and a sort menu, and a typeahead that
searches the whole index rather than the pages already loaded. Beyond the
feeds there is a page per show (`/show/<podcast-guid>`) and a page per episode
(`/episode/<item-guid>`), both edge-rendered and both readable with
JavaScript off.

## How It Works

Unlike a general-purpose Nostr client, OnlyBoosts does not fan out to relays
on page load. A collector does the network-wide scan on a timer, classifies
which kind-1 notes are genuinely podcast boosts, enriches them from the
Podcast Index, and writes the result to two places: a set of static JSON
exports, and a Cloudflare D1 database the site queries through
`/api/v1/*`. Ranking, paging, search and the medium split all happen in that
query layer, so the browser is sent answers rather than a corpus to aggregate.

A boost qualifies when it carries a NIP-73 `podcast:item:guid:<guid>` tag
*and* real payment signal: a `boostagram`/`value4value` topic tag, a positive
`amount` tag, or a quote-reference to a kind-9735 zap receipt the amount can
be read off. That last rule is what catches Fountain-style narrative notes
that wrap a real receipt but carry no `amount` of their own.

Roughly 22,500 boosts across 1,282 shows and 6,860 episodes at the time of
writing, reaching back to October 2024, which is as far as relay retention
allowed the initial backfill to go.

Reading is anonymous. Signing in (NIP-07 extension, NIP-46 bunker, or a local
key) adds the follows-scoped feeds, replies, reactions, and boosting via NWC
or WebLN. A boost pays the value block the show published in its own RSS
feed; no leg of it is ever rewritten.

**What is indexed is a sample, not a census.** The majority of Podcasting 2.0
boosting is sent by keysend and never touches Nostr, so absence from this
index indicates nothing about a show. [/about](https://onlyboosts.social/about)
states that in full, and it is the factual source of record for what the data
does and does not cover.

## Stack

- Vanilla HTML + ES modules, no build step for the site
- Cloudflare Pages + Pages Functions + D1
- `login-widget/` — a Vite + React bundle providing login, wallet, and boost
  modals, compiled to `assets/widgets/login-widget.js`
- `bots/global-boost-scan/` — the Python collector; `DATA-API.md` there is the
  schema contract for both the static exports and the D1 projection
- `bots/bug-watcher/` — a Node poller that turns bug-report notes into GitHub
  issues

## Development

```sh
# Build the login/boost widget (only needed after changing login-widget/src)
cd login-widget && npm install && npm run build && cd ..

# Serve the site with /api/* Functions resolving
npx wrangler pages dev .
```

`/api/value` and `/api/episode-meta` need `PODCAST_INDEX_KEY` and
`PODCAST_INDEX_SECRET` in a gitignored `.dev.vars`; without them they return a
clean 503 and no boost button can resolve a show's splits.

Shared nav and footer are generated. Edit `partials/nav.html` or
`partials/footer.html`, then:

```sh
node scripts/sync-partials.js
```

`CLAUDE.md` carries the design decisions behind the feeds, the medium split,
the money paths and the data layer, and is worth reading before changing any
of them.

## Credits

Forked from [localbitcoiners](https://github.com/ReedBTC/localbitcoiners),
which is where the boost renderer, login widget, and collector pipeline come
from. The bug-report architecture (relay → poller → GitHub issues) is
inspired by [Plebeian Market](https://plebeian.market)'s tooling. Boost and
wallet patterns also draw on
[boostmebitch](https://github.com/ChadFarrow/boostmebitch).

## License

MIT — see [LICENSE](LICENSE).

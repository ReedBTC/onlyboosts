# OnlyBoosts

A Nostr client for podcast boosts.

Podcasting 2.0 apps let listeners send sats to a show mid-episode, usually
with a message attached — a *boostagram*. Many of those apps also publish the
boost to Nostr as a kind-1 note. OnlyBoosts collects those notes from across
the whole network and shows them as a feed you can read, reply to, and boost
back from.

Four feeds:

| Feed | What's in it |
|---|---|
| **Global Boosts** | Every podcast boost found on Nostr, newest first |
| **Follows Boosts** | The same wall, narrowed to npubs you follow |
| **Global Podcasts** | Shows and episodes ranked by boosts received |
| **Follows Podcasts** | What the people you follow are listening to |

## How it works

Unlike a general-purpose Nostr client, OnlyBoosts doesn't fan out to relays
on page load. A collector bot does the expensive network-wide scan on a
timer, classifies which kind-1 notes are genuinely podcast boosts, enriches
them from the Podcast Index, and writes a JSON snapshot to a VPS. The site
reads that one cached file through a Cloudflare Pages Function.

A boost qualifies when it carries a NIP-73 `podcast:item:guid:<guid>` tag
*and* real payment signal — a `boostagram`/`value4value` topic tag, a
positive `amount` tag, or a quote-reference to a kind-9735 zap receipt the
amount can be read off. That last rule is what catches Fountain-style
narrative notes that wrap a real receipt but carry no `amount` of their own.

Reading is anonymous. Signing in (NIP-07 extension, NIP-46 bunker, or a
local key) adds the follows-scoped feeds, replies, reactions, and boosting
via NWC or WebLN.

## Stack

- Vanilla HTML + ES modules, no build step for the site
- Cloudflare Pages + Pages Functions
- `login-widget/` — a Vite + React bundle providing login, wallet, and boost
  modals, compiled to `assets/widgets/login-widget.js`
- `bots/` — Python collectors and a Node bug-report watcher

## Development

```sh
# Build the login/boost widget (only needed after changing login-widget/src)
cd login-widget && npm install && npm run build && cd ..

# Serve the site with /api/* Functions resolving
npx wrangler pages dev .
```

Shared nav and footer are generated. Edit `partials/nav.html` or
`partials/footer.html`, then:

```sh
node scripts/sync-partials.js
```

## Status

Early scaffold. The site is a single page with the four feeds routed and
laid out, plus the kind-1 renderer and the login/boost/wallet stack. Only
the Podcasts · Global feed reads real data so far; the other three show
placeholders, and the network-wide collector isn't built. See `CLAUDE.md`
for the current build list.

## Credits

Forked from [localbitcoiners](https://github.com/ReedBTC/localbitcoiners),
which is where the boost renderer, login widget, and collector pipeline come
from. The bug-report architecture (relay → poller → GitHub issues) is
inspired by [Plebeian Market](https://plebeian.market)'s tooling. Boost and
wallet patterns also draw on
[boostmebitch](https://github.com/ChadFarrow/boostmebitch).

## License

MIT — see [LICENSE](LICENSE).

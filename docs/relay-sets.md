# Relay Sets

**Moved verbatim out of `CLAUDE.md` on 2026-09-09**, when that file passed its
size budget — the same treatment the seven `docs/` files got on 2026-08-29 and
`docs/tests.md` and `docs/show-artwork.md` got the same day. Nothing was
rewritten on the way across, so `git log -S <symbol> -- CLAUDE.md` still finds
any paragraph that used to live there.

**What stayed in `CLAUDE.md` is the rule and the four findings that outlive the
numbers.** The measurement tables, the per-set inventory and the whole
`NC_RELAYS` section are here, because they are evidence rather than
instructions — and because the instruction attached to them is to
**re-measure before changing a set**, not to trust the numbers forever.

## The Rule, And The Measurement Behind It

**A relay list is defined by the kind it carries and the audience it reaches, not
by which relays are popular.** Every set in this repo was re-derived from that
rule on 2026-08-12, measured against the 61 distinct boosters behind the 100 most
recent boosts. **Re-measure before changing one**; the numbers below are the
whole argument, and reputation is a bad proxy for them.

**⚠️ Reading and publishing are different jobs and take different sets.** A read
set answers "who HAS this event", which is measurable, and a useless member costs
latency on every query. A publish set answers "who will SEE this event", which
cannot be measured from outside, and an extra member costs one socket on an
infrequent action while omitting one costs reach nobody can observe. **So the
read sets are cut to what the measurement supports and the publish sets are
deliberately generous, and a low score is not an argument against a publish
target.** One list doing both jobs is the smell that produced the split.

| Relay | kind 0 | kind 10002 | kind 3 | kind 1 |
|---|---|---|---|---|
| `relay.fountain.fm` | 0% | 0% | 4% | **98%** |
| `nos.lol` | 78% | **59%** | **75%** | 44% |
| `relay.ditto.pub` | **80%** | 42% | 67% | 32% |
| `relay.mostr.pub` | 47% | 36% | 47% | 44% |
| `relay.wavlake.com` | 37% | 37% | 24% | 14% |
| `purplepag.es` | 32% | 37% | 50% | 0% |
| `relay.primal.net` | 6% | 4% | 18% | 29% |
| `relay.nostr.band` | 0% | 0% | 0% | 0% |

| Set | File | Kinds |
|---|---|---|
| `STATIC_RELAYS` | `assets/js/boosts-thread.js` | read 1 threads + 3 follows |
| `FALLBACK_RELAYS` | `login-widget/src/lib/ndk.js` | **read** 0, 10002 |
| `OUTBOX_RELAYS` | `login-widget/src/lib/ndk.js` | read 10002 only |
| `PUBLISH_RELAYS` | `login-widget/src/lib/ndk.js` | **publish** 1 share notes |
| `BOOSTAGRAM_RELAYS` | `login-widget/src/lib/boostagram.js` | publish 30078 |
| `NC_RELAYS` | `login-widget/src/components/LoginScreen.jsx` | 24133 bunker transport |
| `BUG_RELAY` | `login-widget/src/lib/bugReport.js` | 1, tag-gated, isolated |
| `BOOTSTRAP_RELAYS` | `bots/shared/nostr_utils.py` | 0, 3, 10002 |
| `NOSTR_RELAYS` | `bots/shared/nostr_utils.py` | publish 1 |
| `CORE_` / `PROFILE_` / `RECEIPT_RELAYS` | `bots/global-boost-scan/relays.py` | 1 / 0+10002 / 9735 |
| NIP-05 hints | `.well-known/nostr.json` | mirrors `FALLBACK_RELAYS` |

Findings that outlive the numbers:

- **⚠️ `relay.damus.io` is gone and must not come back.** It answers a WebSocket
  connect with **HTTP 503**. It was first in every browser-side list.
- **⚠️ `relay.getalby.com` is NWC transport, not a relay.** Both it and `/v1`
  answer *every* REQ with `blocked: Request rejected`, so a note published there
  can never be read. NWC is unaffected either way: the wallet's relay comes from
  the connection string.
- **A relay has to accept the kind.** `purplepag.es` stores only 0/3/10002 and
  was in `BOOSTAGRAM_RELAYS`, where a kind-30078 publish could never be stored;
  `relay.fountain.fm` refuses 30078 with `kinds not supported`.
- **Aggregators are not automatically worth a slot.** `purplepag.es` scored
  respectably alone and added **zero** marginal coverage once ditto and nos.lol
  were present. Same for `relay.primal.net`, which was in five sets. That is the
  *relay*; `cache1.primal.net` behind `primal-profiles.js` is a different service.
- **⚠️ BUT THAT ZERO IS ABOUT A POPULATION, NOT ABOUT THE RELAY, AND THE TAIL
  DISAGREES.** *Re-measured 2026-09-11* against the 99 boosters who had no
  profile row at all — the residual left over after every pass, mostly the
  2024-era audience the deepscan recovered. The standing four reached 5 of them.
  `relay.fountain.fm` reached 16 (**+15** marginal) and `purplepag.es` 16
  (**+13**, overlapping 11); every other relay tried — primal, damus,
  nostr.band, snort, nostr.mom, chadf, noderunners, nostr21, lexingtonbitcoin,
  mynostr — added **zero**. 22 reachable in total, 17 of which parse to
  something storable, 77 with no kind-0 on any of 15 relays tested. So the
  whole-corpus floor is **2.6%** of boosters with no kind-0 anywhere, tighter
  than the 11% the 61-booster sample gave.

  The two were **not** added to `PROFILE_RELAYS`. The 17 were recovered by a
  one-off pass instead, because the set is queried serially at up to 30s per
  relay per batch on a 120s tick and this is a one-time tail, not a standing
  gap. Fountain is the odder miss of the two: it is already in `CORE_RELAYS`
  and `RECEIPT_RELAYS`, so it is dialled every tick and had simply never been
  asked for a kind-0 — it scores 0% on the table above because that measurement
  used recent boosters, whose profiles live elsewhere.
- **⚠️ NDK dials relays this repo never names.** It builds a second, outbox pool
  from its own `DEFAULT_OUTBOX_RELAYS` (`purplepag.es`, `nos.lol`) unless
  `outboxRelayUrls` is passed. `ndk.js` now passes the option explicitly.
- **⚠️ Publishing to Primal's RELAY is not how Primal users see a note.**
  Measured on a real boost note: absent from `relay.primal.net`, which held **0**
  of that author's kind-1s, and simultaneously **present in `cache1.primal.net`**,
  which is what the Primal client reads. `relay.primal.net` is in
  `PUBLISH_RELAYS` on the read/publish asymmetry above, not on evidence.
- **Fountain boosts are heavily `relay.fountain.fm`-only (~90%)**, which is why
  it is in `NOSTR_RELAYS` despite not being general-purpose. Don't prune it.

**⚠️ `publishRelaySet()` in `ndk.js` unions `PUBLISH_RELAYS` with NDK's pool, and
the union is load-bearing.** `ensureUserWriteRelays` seeds that pool with the
signed-in user's NIP-65 write relays, so a relay set built from `PUBLISH_RELAYS`
alone would replace the pool and silently stop publishing to the user's own
relays — the note still publishes, to the wrong audience, and no error is raised.

Floors worth knowing before chasing coverage: **11% of boosters have no kind 0 on
any relay tested, and 36% have no kind 10002.** No list closes that.

### `NC_RELAYS` Is a Third Job, and the Signer Pays for a Bad Member

**⚠️ The `nostrconnect://` relay list is OURS, not the user's signer's.** NIP-46
requires the signer to answer on the relays named in the URI, so the relays
configured in someone's Amber do not govern that handshake; they govern the
`bunker://` path, where the pasted string carries the signer's own list.

That makes this neither a read set nor a publish set. A member has to be
reachable **by both sides** and has to carry kind 24133, which is ephemeral, so
nothing is stored and a reply arriving while nobody is subscribed is gone for
good. Re-derived by publishing a throwaway 24133 to each relay and watching a
second socket for delivery:

| Relay | Publish | Relayed |
|---|---|---|
| `relay.primal.net` | `OK: true` | yes |
| `relay.ditto.pub` | `OK: true` | yes |
| `nos.lol` | `OK: true` | yes |
| `relay.mostr.pub` | `OK: true` | yes (tested spare, not shipped) |
| `relay.nsec.app` | HTTP 502, socket closes 1006 in ~540ms | — |
| `relay.nostr.band` | TCP connect never completes; ~10s, then 1006 | — |

- **⚠️ An OK is not proof of transport.** `relay.fountain.fm` answers `OK: true`
  and then CLOSEs the subscription with `kinds not supported`. **Test the read
  side too.**
- **⚠️ A hang costs more than a refusal, and the SIGNER pays it.** A 502 is half
  a second; a connect that never completes costs the dialer's whole timeout, and
  the dialer is the signer app, off where this site cannot see or report it. That
  is what a login "taking forever and then working" looks like.

The URI also names `perms` (`get_public_key`, `sign_event`). Amber prompts once
per ungranted scope and the second prompt lands after the user has tabbed back to
the browser, which is where a connect appears to hang; naming both up front lets
one screen approve them.

Untested, and the one thing to confirm: **write policy.** Every relay above
reports open writes in NIP-11, but strfry usually leaves `restricted_writes`
unset, so a publish target is unproven until an event actually lands.


# Bug-relay watcher (onlyboosts)

Ported from `ReedBTC/mynostr`'s `scripts/bug-watcher`. Polls
`wss://relay.mynostr.app` every 10 minutes for kind-1 events tagged
`["t", "onlyboosts-alpha"]` and opens one GitHub issue per new
report in **`ReedBTC/onlyboosts`** (labels `bug` + `from-relay`).

> **Credit:** the architecture (in-app modal → dedicated tag-gated relay
> → poller → GitHub issues, no backend) is inspired by
> [Plebeian Market](https://plebeian.market)'s bug-report tooling.

## How it fits together

- **Website side** (already shipped): the "Report a bug" item in the
  More ▾ dropdown opens a modal that signs a kind-1 note tagged
  `['t','onlyboosts-alpha']` + `['client','onlyboosts']` and
  publishes it **only** to `wss://relay.mynostr.app`. See
  `login-widget/src/lib/bugReport.js`.
- **Relay** (PREREQUISITE): `relay.mynostr.app`'s strfry write-policy
  must whitelist the literal tag `onlyboosts-alpha` (Reed: this was
  the whitelist you set up — confirm it accepts that exact string).
- **This watcher** (server side): turns those relay events into issues.

## Config

All site-specific values are in the `CONFIG` object at the top of
`watcher.js`: `relay`, `tag` (`onlyboosts-alpha`), `repo`
(`ReedBTC/onlyboosts`), `labels`. Nothing else needs editing.

## Requirements

- `node` (any recent LTS) with **`nostr-tools`** resolvable from this
  folder (the only npm dep). e.g. `npm i nostr-tools` in the repo root,
  or point `NODE_PATH` at an existing install.
- The `gh` CLI authenticated with write access to `ReedBTC/onlyboosts`.

## Install (Ubuntu, user-mode systemd)

```bash
# Adjust the WorkingDirectory/ExecStart paths in the .service file first
# to wherever this repo lives on the server.
mkdir -p ~/.config/systemd/user
cp bots/bug-watcher/systemd/onlyboosts-bug-watcher.service ~/.config/systemd/user/
cp bots/bug-watcher/systemd/onlyboosts-bug-watcher.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now onlyboosts-bug-watcher.timer
loginctl enable-linger "$USER"   # keep the timer alive without a GUI session
```

## First run (seeding)

On the very first run `state/seen.json` doesn't exist: the watcher
fetches the last 30 days of tagged events, marks them all as
already-handled, and exits **without** creating issues — so existing
test reports don't backfill as fresh issues. `state/` is gitignored.

## Verify / manual one-shot

```bash
systemctl --user list-timers | grep onlyboosts
journalctl --user -u onlyboosts-bug-watcher -f
systemctl --user start onlyboosts-bug-watcher.service   # run now
```

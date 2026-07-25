#!/usr/bin/env node
/**
 * mynostr bug-relay watcher.
 *
 * Credit: the relay → poller → GitHub-issues architecture is inspired
 * by Plebeian Market's bug-report tooling. https://plebeian.market —
 * thanks to that team for the pattern.
 *
 * Polls a Nostr relay for kind 1 events tagged with a configured topic
 * tag, and creates one GitHub issue per new event via the `gh` CLI.
 * Designed to be invoked on a 10-minute systemd timer; first run seeds
 * the seen-ids store with everything that exists at install time so we
 * don't backfill historical test reports as fresh issues.
 *
 * Reusable for other sites: every site-specific value sits in CONFIG
 * below. To run this for a second site, copy this folder to its repo
 * and change `tag`, `repo`, and (if relevant) `relay`.
 *
 * State (seen-ids set, log) lives in ./state/, gitignored. Logs go to
 * stdout/stderr too so journalctl picks them up under the systemd unit.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { nip19 } from 'nostr-tools'

const CONFIG = {
  // Shared bug relay (same one mynostr and LB use); OnlyBoosts reports are
  // isolated by the `tag` below, which the relay's strfry write-policy must
  // whitelist — see README, this is a VPS-side change, not a code change.
  relay:  'wss://relay.mynostr.app',
  tag:    'onlyboosts-alpha',  // strict — events without this exact tag are ignored
  repo:   'ReedBTC/onlyboosts',
  // No in-app Known Issues viewer on OnlyBoosts (yet), so just label + route.
  labels: ['bug', 'from-relay'],
  // First run: pull events from this many days back to seed the
  // seen-ids set without creating issues. Tune up if you have older
  // test reports on the relay you want to mark as already-handled.
  seedLookbackDays: 30,
  // Steady-state: every run looks back this far. Generous so a
  // restart after a long outage still catches everything; the
  // seen-ids set dedupes anything we already issued.
  pollLookbackHours: 48,
  // WS request timeout. Generous because cold-start strfry connections
  // can take a beat.
  wsTimeoutMs: 20_000,
  // Title length cap — GitHub issue titles get unwieldy past ~80.
  titleMaxLen: 80,
}

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const STATE_DIR  = path.join(__dirname, 'state')
const SEEN_FILE  = path.join(STATE_DIR, 'seen.json')

// ─── State (seen ids) ─────────────────────────────────────────────────────────

function loadSeen() {
  try {
    const arr = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))
    return { firstRun: false, seen: new Set(arr) }
  } catch {
    return { firstRun: true, seen: new Set() }
  }
}

function saveSeen(seen) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  // Atomic write: stage to .tmp then rename. A crash mid-write would
  // otherwise leave a truncated seen.json — which loadSeen would treat
  // as "first run" on the next tick and silently re-seed, dropping any
  // pending events older than the steady-state lookback window.
  const tmp = SEEN_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify([...seen].sort(), null, 0))
  fs.renameSync(tmp, SEEN_FILE)
}

// ─── Relay query ──────────────────────────────────────────────────────────────

function fetchTaggedEvents({ since, limit = 500 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(CONFIG.relay)
    const events = []
    const subId = 'watcher-' + Math.random().toString(36).slice(2, 10)
    const timer = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error(`Relay didn't EOSE within ${CONFIG.wsTimeoutMs / 1000}s`))
    }, CONFIG.wsTimeoutMs)

    ws.addEventListener('open', () => {
      const filter = { kinds: [1], '#t': [CONFIG.tag], since, limit }
      ws.send(JSON.stringify(['REQ', subId, filter]))
    })

    ws.addEventListener('message', ev => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (!Array.isArray(msg) || msg[1] !== subId) return
      if (msg[0] === 'EVENT' && msg[2]) {
        events.push(msg[2])
      } else if (msg[0] === 'EOSE') {
        clearTimeout(timer)
        try { ws.send(JSON.stringify(['CLOSE', subId])) } catch {}
        ws.close()
        resolve(events)
      }
    })

    ws.addEventListener('error', err => {
      clearTimeout(timer)
      // WebSocket 'error' isn't an Error instance — it's a generic event
      // with no .message. Pull whatever we can find for debuggability.
      const detail =
        err?.message ||
        err?.error?.message ||
        err?.code ||
        err?.target?.url ||
        err?.type ||
        'unknown'
      reject(new Error(`WS error: ${detail}`))
    })
  })
}

// ─── Per-event safety: confirm the tag really is on the event ─────────────────
// Belt-and-braces. The relay enforces the tag via its write-policy plugin,
// AND our REQ filter pins '#t' to the tag — but if the relay ever loosened
// or someone misconfigures, we'd still skip mis-tagged events instead of
// filing them as bugs.

function eventHasOurTag(ev) {
  if (!Array.isArray(ev.tags)) return false
  return ev.tags.some(t =>
    Array.isArray(t) && t[0] === 't' && t[1] === CONFIG.tag,
  )
}

// ─── Issue body construction ──────────────────────────────────────────────────

function deriveTitle(content) {
  const lines = String(content || '').split('\n').map(l => l.trim())
  for (const line of lines) {
    if (!line) continue
    // Skip template headers ("What went wrong:", "What didn't work:",
    // localized variants like "Что пошло не так:") and bare numbered
    // step markers. Length cap is the load-bearing test — substantive
    // content lines are typically much longer than headers.
    if (line.endsWith(':') && line.length < 60) continue
    if (/^\d+\.\s*$/.test(line))                  continue
    if (/^---+$/.test(line))                       continue
    return line.length > CONFIG.titleMaxLen
      ? line.slice(0, CONFIG.titleMaxLen - 1) + '…'
      : line
  }
  return 'Bug report'
}

// Sanitize before posting to a public GitHub issue:
//   1. Redact obvious secret-shaped strings (nsec, GH tokens, slack,
//      AWS, OpenAI/Anthropic-style sk- keys). The relay event itself is
//      already public + immutable — this only protects the GH copy. We
//      still need users to NOT paste secrets in the first place; modal
//      hint covers that.
//   2. Defang @-mentions: convert `@github-handle` to `` `@handle` ``
//      (backtick-wrapped) so reports can't ping arbitrary GitHub users
//      via the issue body.
//   3. Convert `[image: url]` markers to a clickable markdown link
//      `[image](url)` — visible + clickable but NOT auto-rendered, so
//      a hostile reporter can't drop a tracking pixel that loads when
//      we view the issue.
const SECRET_PATTERNS = [
  // Nostr private key — bech32 alphabet is stricter, but we use the
  // loose [a-z0-9]+ so a typo'd / partly-mangled paste still gets fully
  // redacted instead of half-leaking the suffix.
  /nsec1[a-z0-9]{50,}/gi,
  /\bghp_[A-Za-z0-9]{20,}/g,           // GitHub personal access token
  /\bgho_[A-Za-z0-9]{20,}/g,           // GitHub OAuth
  /\bghu_[A-Za-z0-9]{20,}/g,           // GitHub user-to-server
  /\bghs_[A-Za-z0-9]{20,}/g,           // GitHub server
  /\bghr_[A-Za-z0-9]{20,}/g,           // GitHub refresh
  /\bsk-[A-Za-z0-9_-]{20,}/g,          // OpenAI / Anthropic / Stripe-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,  // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,             // AWS access key id
]

function sanitizeForGithub(text) {
  let s = String(text || '')
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[REDACTED]')
  // Defang GitHub handles. Word-boundary on the left avoids mangling
  // emails (`me@example.com`) and similar non-mention `@` uses.
  s = s.replace(
    /(^|[^A-Za-z0-9._-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)\b/g,
    (_m, prefix, name) => `${prefix}\`@${name}\``,
  )
  // Convert `[image: <url>]` to a clickable link, not an auto-rendered
  // image. Stops `[image: https://attacker.com/track.png]` from
  // triggering an outbound fetch when we view the issue.
  s = s.replace(/\[image:\s+(\S+?)\s*\]/g, (_m, url) => `[image](${url})`)
  return s
}

function bodyForIssue(ev) {
  const rendered = sanitizeForGithub(ev.content)

  const npub = (() => {
    try { return nip19.npubEncode(ev.pubkey) } catch { return ev.pubkey }
  })()
  const nevent = (() => {
    try {
      return nip19.neventEncode({
        id: ev.id,
        author: ev.pubkey,
        relays: [CONFIG.relay],
      })
    } catch { return ev.id }
  })()
  const submittedIso = new Date((ev.created_at || 0) * 1000).toISOString()

  return [
    rendered.trimEnd(),
    '',
    '---',
    `**Reporter:** \`nostr:${npub}\``,
    `**Event:** \`nostr:${nevent}\``,
    `**Submitted:** ${submittedIso}`,
    `**Relay:** ${CONFIG.relay}`,
  ].join('\n')
}

// ─── GitHub label bootstrap ───────────────────────────────────────────────────
// `bug` ships with every repo by default, but custom labels like
// `from-relay` don't exist until someone creates them. Ensure all
// configured labels exist in the target repo before we try to file
// issues — idempotent (gh exits non-zero with "already exists" when
// the label is already present, which we treat as success).

function ensureLabels() {
  for (const label of CONFIG.labels) {
    const res = spawnSync(
      'gh',
      ['label', 'create', label, '--repo', CONFIG.repo],
      { encoding: 'utf8' },
    )
    if (res.status === 0) {
      console.log(`[bug-watcher] Created label '${label}' in ${CONFIG.repo}.`)
      continue
    }
    const errLower = (res.stderr || '').toLowerCase()
    if (errLower.includes('already exists')) continue   // expected steady-state
    console.warn(`[bug-watcher] Couldn't create label '${label}': ${(res.stderr || res.stdout || '').trim()}`)
  }
}

// ─── GitHub issue creation ────────────────────────────────────────────────────

function createIssue(ev) {
  const title = deriveTitle(ev.content)
  const body  = bodyForIssue(ev)
  const args  = [
    'issue', 'create',
    '--repo',  CONFIG.repo,
    '--title', title,
    '--body',  body,
  ]
  for (const lab of CONFIG.labels) args.push('--label', lab)

  const res = spawnSync('gh', args, { encoding: 'utf8' })
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim() || `exit ${res.status}`
    throw new Error(`gh issue create failed: ${err}`)
  }
  // gh prints the new issue URL to stdout on success.
  return (res.stdout || '').trim()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { firstRun, seen } = loadSeen()
  const nowSec = Math.floor(Date.now() / 1000)

  if (firstRun) {
    console.log(`[bug-watcher] First run — seeding seen-ids set with last ${CONFIG.seedLookbackDays}d of events (no issues will be created).`)
    const since = nowSec - CONFIG.seedLookbackDays * 86400
    const events = await fetchTaggedEvents({ since })
    let added = 0
    for (const ev of events) {
      if (!ev?.id) continue
      if (!eventHasOurTag(ev)) continue
      seen.add(ev.id)
      added++
    }
    saveSeen(seen)
    console.log(`[bug-watcher] Seeded ${added} existing event${added === 1 ? '' : 's'}. Subsequent runs will create issues for new ones.`)
    return
  }

  // Make sure the labels we'll attach actually exist before any issue
  // creation. Cheap; runs once per tick. Steady-state is a no-op after
  // the first time (gh returns "already exists" which we ignore).
  ensureLabels()

  const since = nowSec - CONFIG.pollLookbackHours * 3600
  const events = await fetchTaggedEvents({ since })
  // Oldest-first: when a batch arrives we want the earliest report to
  // get the lower issue number, so the GitHub list reads chronologically
  // instead of newest-on-top of older-bug-just-filed.
  events.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))

  let created = 0
  let skipped = 0
  for (const ev of events) {
    if (!ev?.id) continue
    if (!eventHasOurTag(ev)) { skipped++; continue }   // strict tag check
    if (seen.has(ev.id))     { skipped++; continue }   // already filed

    try {
      const url = createIssue(ev)
      seen.add(ev.id)
      created++
      console.log(`[bug-watcher] Created issue for ${ev.id.slice(0, 12)}…  ${url}`)
      // Persist after each success so a crash mid-batch doesn't
      // re-file events we already issued.
      saveSeen(seen)
    } catch (e) {
      // Don't add to seen on failure — next run retries this event.
      console.error(`[bug-watcher] Failed for ${ev.id.slice(0, 12)}…: ${e.message}`)
    }
  }

  console.log(`[bug-watcher] Done. created=${created} skipped=${skipped} total-seen=${seen.size}`)
}

main().catch(e => {
  console.error(`[bug-watcher] Fatal: ${e.message}`)
  process.exit(1)
})

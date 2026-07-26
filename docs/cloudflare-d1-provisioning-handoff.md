# Walkthrough request: provision a Cloudflare D1 database for OnlyBoosts

*(Paste this to the web assistant. It's the guide for a person doing the clicks.)*

## Context for the assistant

I'm adding a fast query API to **OnlyBoosts** (onlyboosts.social), an existing
**git-connected Cloudflare Pages** site. A separate backend engineer (a coding
agent on my server) has already written and tested all the code. It just needs a
**Cloudflare D1 database** created and wired to the Pages project.

**Please walk me through the steps below one at a time, and check my work as we
go.** You can't run anything yourself — I'll do the clicks/edits and paste back
what I see.

**Important scope notes:**
- I use the Cloudflare **dashboard** from my laptop browser. Keep everything in
  the dashboard.
- My server is headless and my backend agent handles **all terminal, `wrangler`
  CLI, SQL, and data-loading steps** — so **do NOT walk me through any command
  line or SQL.** Your job is only the 3 dashboard tasks + 1 config-file edit below.
- **Never ask me to paste the API token into this chat.** I'll put it straight
  into a file.

---

## Task 1 — Create the D1 database
1. Cloudflare dashboard → left nav **Workers & Pages** → **D1 SQL Database** → **Create**.
2. Name it **exactly** `onlyboosts` (lowercase).
3. Open the new database and copy its **Database ID** (a long UUID). I'll need it later.

## Task 2 — Bind the database to the Pages project
1. Dashboard → **Workers & Pages** → open the **OnlyBoosts Pages project**.
2. **Settings** → **Bindings** (may be under "Functions") → **Add** → **D1 database**.
3. Variable name **must be exactly** `DB` (uppercase — not `db`, not `D1`).
   Database: `onlyboosts`. Save.
4. Add it for **Production** (and Preview if it asks).
5. **After adding the binding, redeploy**: Deployments → the latest deployment →
   **Retry deployment** (bindings only take effect on a *new* deployment).

## Task 3 — Create a scoped API token + find the Account ID
1. Dashboard → **My Profile** (top-right) → **API Tokens** → **Create Token** →
   **Create Custom Token**.
2. **Permissions:** **Account** → **D1** → **Edit**. (Account-scoped, *not* Zone.)
3. **Account Resources:** my account (or "All accounts").
4. Create it, then **copy the token now** — it's shown only once. Put it somewhere
   safe; **do not paste it in this chat.**
5. Also grab my **Account ID**: it's in the dashboard URL
   (`dash.cloudflare.com/<ACCOUNT_ID>/…`) or on the account overview page.

## Task 4 — Add 3 values to the server credentials file
The file is `~/.config/nostr-bots/credentials.env` (simple `KEY=value` lines).
I'll open it in a text editor and add these three lines (no quotes), pasting the
token directly into the file:
```
CF_ACCOUNT_ID=<Account ID from Task 3>
CF_D1_DATABASE_ID=<Database ID from Task 1>
CF_API_TOKEN=<token from Task 3>
```

---

## Done
When all four are complete, I'll tell my backend engineer. It will load the
database schema + initial data and verify the live API — **nothing else for you
to do.**

## Gotchas to help me avoid
- Can't find D1? It's under **Workers & Pages → D1 SQL Database**.
- The binding variable name is **case-sensitive**: it must be `DB`.
- If the API errors right after wiring, the binding didn't take — **redeploy** the
  Pages project (bindings apply only to new deployments).
- The token permission is **Account → D1 → Edit**. A Zone-scoped token won't work.
- The token is shown **once** — if I lose it, I just make a new one.

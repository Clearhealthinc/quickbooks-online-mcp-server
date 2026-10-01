# Clear Health fork

Fork of [intuit/quickbooks-online-mcp-server](https://github.com/intuit/quickbooks-online-mcp-server)
used to give Cyrus **read-only** access to our QuickBooks Online company (Linear CLE-2901).
What differs from upstream, and why:

| Change | Where | Why |
|---|---|---|
| Only `get`/`read`/`search` tools are registered (an allowlist; `get_invoice_pdf` also excluded) | `src/helpers/read-only.ts` | Intuit's OAuth scope is read+write, so the tool list is the only control. Our Intuit app questionnaire says the app only reads data |
| OAuth endpoints come from Intuit's discovery document | `src/helpers/intuit-discovery.ts` | Questionnaire: "uses the discovery document" |
| Every failed QuickBooks call is logged to stderr with its `intuit_tid`; tool errors carry it too | `src/helpers/intuit-tid.ts`, `format-error.ts` | Questionnaire: "captures intuit_tid" and "keeps error logs" |
| Our own production connect flow (HTTPS redirect, CSRF `state` check) instead of the OAuth Playground | `src/cli/connect.ts`, `src/helpers/connect-flow.ts` | Questionnaire: "does not rely on the OAuth Playground" |
| `explore` CLI: revenue accounts, products, P&L income by month, sales by product | `src/cli/explore.ts` | Find out how SaaS revenue is booked before wiring Cyrus |

The full list of questionnaire answers and what each commits us to is on CLE-2901.

## Connect the production company (one time, and again whenever it needs re-authorizing)

1. In the Intuit app, **Production → Redirect URIs**, add
   `https://humoristic-nonoptically-elia.ngrok-free.dev/callback` (Mike's free ngrok static domain).
2. Create `.env` in this folder (gitignored):
   ```
   QUICKBOOKS_CLIENT_ID=...
   QUICKBOOKS_CLIENT_SECRET=...
   QUICKBOOKS_ENVIRONMENT=production
   QUICKBOOKS_REDIRECT_URI=https://humoristic-nonoptically-elia.ngrok-free.dev/callback
   ```
   then `chmod 600 .env`.
3. `npm ci && npm run build`
4. Terminal 1: `ngrok http 8000 --url https://humoristic-nonoptically-elia.ngrok-free.dev`
5. Terminal 2: `npm run connect`. It prints a link that works for this run only (20 minutes).
6. Send the link to a **QuickBooks admin** of the company. They sign in and click **Connect**.
   `connect` writes `QUICKBOOKS_REFRESH_TOKEN` and `QUICKBOOKS_REALM_ID` into `.env` and exits.

## Explore

`npm run explore` (last 12 full months) or `npm run explore -- 2026-01-01 2026-09-30`.
It prints a summary and writes the raw reports to `capture-explore-<date>.json` (gitignored: it holds real figures).

## The refresh token has ONE holder

Intuit rotates the refresh token on use and invalidates the previous one. Whoever refreshes
last holds the only valid copy. While exploring, that's this folder's `.env`. When Cyrus takes over,
the token **moves** to Cyrus (Aptible config + S3), and this local copy must stop being used.
If either side ends up with a dead token, re-run **Connect** above.

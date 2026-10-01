#!/usr/bin/env node
/**
 * Clear Health fork: connect a PRODUCTION QuickBooks company.
 *
 *   npm run build && npm run connect
 *
 * 1. Start the tunnel in another terminal:  ngrok http 8000 --url <your ngrok domain>
 * 2. Run this. It prints a link; send it to a QuickBooks ADMIN of the company.
 * 3. They sign in and click Connect. The refresh token and realm id are written
 *    to the token store (.env, or QUICKBOOKS_TOKEN_STORE_PATH), mode 600.
 *
 * Reads QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT
 * and QUICKBOOKS_REDIRECT_URI (the tunnel URL + /callback, registered in the
 * Intuit app) from the same file. Logic lives in helpers/connect-flow.ts.
 */
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverEndpoints } from '../helpers/intuit-discovery.js';
import {
  buildAuthorizeUrl,
  CallbackError,
  exchangeCode,
  newState,
  parseCallback,
  validateRedirectUri,
  writeTokenStore,
} from '../helpers/connect-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.QUICKBOOKS_TOKEN_STORE_PATH?.trim() || path.join(__dirname, '..', '..', '.env');
const PORT = Number(process.env.QUICKBOOKS_CONNECT_PORT || 8000);
const TIMEOUT_MS = 20 * 60 * 1000;

dotenv.config({ path: STORE, override: true });

function page(title: string, body: string, ok: boolean): string {
  const color = ok ? '#2E7D32' : '#C62828';
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 16px"><h2 style="color:${color}">${title}</h2><p>${body}</p></body>`;
}

async function main() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  if (!clientId || !clientSecret) throw new Error(`QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET must be set in ${STORE}`);
  const redirectUri = validateRedirectUri(process.env.QUICKBOOKS_REDIRECT_URI, environment);
  const callbackPath = new URL(redirectUri).pathname;

  const endpoints = await discoverEndpoints(environment);
  const state = newState();
  const authorizeUrl = buildAuthorizeUrl(endpoints, clientId, redirectUri, state);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 20 minutes with no authorization. Run connect again for a fresh link.'));
    }, TIMEOUT_MS);

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== callbackPath) {
        res.writeHead(404).end();
        return;
      }
      try {
        const { code, realmId } = parseCallback(url.searchParams, state);
        const tokens = await exchangeCode(endpoints, clientId, clientSecret, code, redirectUri);
        writeTokenStore(STORE, { refreshToken: tokens.refreshToken, realmId });
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Connected to QuickBooks', 'Clear Health can now read this company\'s QuickBooks data (read-only). You can close this window.', true));
        const days = tokens.refreshTokenExpiresInSeconds ? Math.round(tokens.refreshTokenExpiresInSeconds / 86400) : '?';
        console.log(`\n✓ Connected. Realm ${realmId} saved to ${STORE} (refresh token valid ~${days} days, rotates on use).`);
        clearTimeout(timer);
        setTimeout(() => server.close(() => resolve()), 500);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Could not connect to QuickBooks', 'Please tell the person who sent you this link. Nothing was changed.', false));
        console.error(`\n✗ ${message}`);
        // A CSRF mismatch may be a stray or stale request; keep waiting for the real one.
        if (!(err instanceof CallbackError && err.kind === 'csrf')) {
          clearTimeout(timer);
          server.close();
          reject(err);
        }
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Listening on 127.0.0.1:${PORT}${callbackPath} (tunnel ${redirectUri} must point here)`);
      console.log(`Environment: ${environment}\n`);
      console.log('Send this link to a QuickBooks admin of the company (valid for this run only, 20 minutes):\n');
      console.log(authorizeUrl + '\n');
    });
    server.on('error', reject);
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

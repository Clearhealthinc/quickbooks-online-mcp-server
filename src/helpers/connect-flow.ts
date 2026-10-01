/**
 * Clear Health fork: the production OAuth authorization ("connect") flow.
 *
 * Upstream can only authorize a sandbox company (its callback server is on
 * localhost, which Intuit rejects for production apps), and production users
 * are pointed at the OAuth Playground. Our app questionnaire says we do NOT rely
 * on the Playground, so this is our own flow: a public HTTPS redirect URI
 * (a tunnel to a local port), endpoints from the discovery document, and a
 * per-run random `state` checked on the callback (CSRF).
 *
 * The CLI shell is src/cli/connect.ts; everything with logic lives here so it
 * can be unit tested.
 */
import crypto from 'crypto';
import fs from 'fs';
import type { IntuitEndpoints } from './intuit-discovery.js';

export const ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';

export function newState(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function buildAuthorizeUrl(endpoints: IntuitEndpoints, clientId: string, redirectUri: string, state: string): string {
  const url = new URL(endpoints.authorizeEndpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ACCOUNTING_SCOPE);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/** A production redirect URI must be HTTPS and must not be localhost. */
export function validateRedirectUri(redirectUri: string | undefined, environment: string): string {
  if (!redirectUri) throw new Error('QUICKBOOKS_REDIRECT_URI is not set');
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new Error(`QUICKBOOKS_REDIRECT_URI is not a valid URL: ${redirectUri}`);
  }
  if (environment === 'production') {
    if (url.protocol !== 'https:') throw new Error('A production QUICKBOOKS_REDIRECT_URI must be https://');
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
      throw new Error('Intuit rejects localhost redirect URIs for production apps; use the tunnel URL');
    }
  }
  return redirectUri;
}

export class CallbackError extends Error {
  constructor(message: string, readonly kind: 'csrf' | 'denied' | 'invalid') {
    super(message);
  }
}

/** Validate the query string Intuit redirects back with. */
export function parseCallback(search: URLSearchParams, expectedState: string): { code: string; realmId: string } {
  const state = search.get('state');
  if (!state || !timingSafeEqualStrings(state, expectedState)) {
    throw new CallbackError('The state parameter does not match this run (possible CSRF, or a link from an earlier run)', 'csrf');
  }
  const error = search.get('error');
  if (error) throw new CallbackError(`Authorization was not granted: ${error}`, 'denied');
  const code = search.get('code');
  const realmId = search.get('realmId');
  if (!code || !realmId) throw new CallbackError('The callback is missing code or realmId', 'invalid');
  return { code, realmId };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
}>;

export interface TokenSet {
  refreshToken: string;
  refreshTokenExpiresInSeconds?: number;
}

/** Exchange the authorization code for tokens at the discovered token endpoint. */
export async function exchangeCode(
  endpoints: IntuitEndpoints,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<TokenSet> {
  const res = await fetchImpl(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
  });
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'none';
    throw new Error(`Token exchange failed: HTTP ${res.status} (intuit_tid: ${tid})`);
  }
  const body = await res.json();
  if (typeof body?.refresh_token !== 'string' || !body.refresh_token) {
    throw new Error('Token exchange returned no refresh_token');
  }
  return { refreshToken: body.refresh_token, refreshTokenExpiresInSeconds: body.x_refresh_token_expires_in };
}

/**
 * Write the refresh token and realm id into the dotenv-format token store the
 * MCP server reads, keeping every other line, and make the file owner-only.
 */
export function writeTokenStore(storePath: string, values: { refreshToken: string; realmId: string }): void {
  const lines = fs.existsSync(storePath) ? fs.readFileSync(storePath, 'utf-8').split('\n') : [];
  const set = (name: string, value: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (i === -1) lines.push(`${name}=${value}`);
    else lines[i] = `${name}=${value}`;
  };
  set('QUICKBOOKS_REFRESH_TOKEN', values.refreshToken);
  set('QUICKBOOKS_REALM_ID', values.realmId);
  fs.writeFileSync(storePath, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(storePath, 0o600);
}

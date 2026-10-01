/**
 * Clear Health fork: OAuth endpoints come from Intuit's discovery document.
 *
 * Intuit asks apps to read the authorize/token/revoke endpoints from the
 * discovery document rather than hardcoding them (our app questionnaire says we
 * do). intuit-oauth ships hardcoded defaults; we fetch the document and hand the
 * result to OAuthClient.setAuthorizeURLs(), the library's own override hook.
 */

export const DISCOVERY_URLS: Record<'production' | 'sandbox', string> = {
  production: 'https://developer.api.intuit.com/.well-known/openid_configuration',
  sandbox: 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration',
};

export interface IntuitEndpoints {
  authorizeEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint: string;
  userInfoEndpoint: string;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

const cache = new Map<string, Promise<IntuitEndpoints>>();

export function discoveryUrlFor(environment: string): string {
  return environment === 'production' ? DISCOVERY_URLS.production : DISCOVERY_URLS.sandbox;
}

/**
 * Fetch (once per environment per process) the endpoints from the discovery
 * document. A failed fetch is not cached, so the next call retries it.
 */
export function discoverEndpoints(environment: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<IntuitEndpoints> {
  const url = discoveryUrlFor(environment);
  const cached = cache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Intuit discovery document ${url} returned HTTP ${res.status}`);
    const doc = await res.json();
    const endpoints: IntuitEndpoints = {
      authorizeEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      revokeEndpoint: doc.revocation_endpoint,
      userInfoEndpoint: doc.userinfo_endpoint,
    };
    for (const [key, value] of Object.entries(endpoints)) {
      if (typeof value !== 'string' || !value.startsWith('https://')) {
        throw new Error(`Intuit discovery document ${url} has no usable ${key}`);
      }
    }
    return endpoints;
  })();

  cache.set(url, pending);
  pending.catch(() => cache.delete(url));
  return pending;
}

/** Test hook. */
export function clearDiscoveryCache(): void {
  cache.clear();
}

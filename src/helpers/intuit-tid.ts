/**
 * Clear Health fork: capture Intuit's `intuit_tid` response header on failures.
 *
 * Intuit support identifies a request by its intuit_tid, and our app
 * questionnaire says we capture it and keep error logs. node-quickbooks makes
 * every API call through axios and does not expose response headers to its
 * callers, so we attach an interceptor to the SAME axios instance it requires
 * (resolved from node-quickbooks' own location, not ours) and log every failed
 * call with its intuit_tid to stderr. stderr is the log stream for a stdio MCP
 * server; on Cyrus it ends up in Papertrail.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface IntuitFailure {
  status?: number;
  method?: string;
  path?: string;
  intuitTid?: string;
  fault?: string;
}

/** Pull the intuit_tid out of an axios response's headers, whatever their shape. */
export function intuitTidFrom(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const h = headers as Record<string, unknown> & { get?: (name: string) => unknown };
  const value = typeof h.get === 'function' ? h.get('intuit_tid') : h['intuit_tid'];
  return typeof value === 'string' && value ? value : undefined;
}

/** The path of the URL only: realm ids and query strings stay out of the logs. */
function safePath(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).pathname.replace(/\/company\/\d+/, '/company/<realm>');
  } catch {
    return undefined;
  }
}

function faultSummary(body: unknown): string | undefined {
  const errors = (body as any)?.Fault?.Error;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors.map((e: any) => [e?.code, e?.Message].filter(Boolean).join(' ')).join('; ');
}

export function formatIntuitFailure(f: IntuitFailure): string {
  return `[qbo-api] request failed status=${f.status ?? 'n/a'} method=${f.method ?? '?'} path=${f.path ?? '?'} intuit_tid=${f.intuitTid ?? 'none'}${f.fault ? ` fault="${f.fault}"` : ''}`;
}

let installed = false;

export function installIntuitTidLogging(log: (line: string) => void = (line) => console.error(line)): void {
  if (installed) return;
  installed = true;
  const qboRequire = createRequire(require.resolve('node-quickbooks'));
  // axios' CommonJS export is the default instance itself.
  const instance = qboRequire('axios');
  instance.interceptors.response.use(
    (res: any) => {
      // QBO sometimes answers 200 with a Fault body.
      const fault = faultSummary(res?.data);
      if (fault) {
        log(formatIntuitFailure({ status: res.status, method: res.config?.method, path: safePath(res.config?.url), intuitTid: intuitTidFrom(res.headers), fault }));
      }
      return res;
    },
    (err: any) => {
      const res = err?.response;
      log(
        formatIntuitFailure({
          status: res?.status,
          method: err?.config?.method,
          path: safePath(err?.config?.url),
          intuitTid: intuitTidFrom(res?.headers),
          fault: faultSummary(res?.data) ?? err?.code,
        }),
      );
      return Promise.reject(err);
    },
  );
}

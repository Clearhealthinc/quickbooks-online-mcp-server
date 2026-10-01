import { intuitTidFrom } from './intuit-tid.js';

/**
 * Formats an error into a standardized error message
 * @param error Any error object to format
 * @returns A formatted error message as a string
 */
export function formatError(error: unknown): string {
  // Clear Health fork: carry Intuit's request id so a failure reported by the
  // agent can be traced with Intuit support.
  const tid = intuitTidFrom((error as any)?.response?.headers);
  const suffix = tid ? ` (intuit_tid: ${tid})` : '';
  if (error instanceof Error) {
    return `Error: ${error.message}${suffix}`;
  } else if (typeof error === 'string') {
    return `Error: ${error}`;
  } else {
    return `Unknown error: ${JSON.stringify(error)}`;
  }
}

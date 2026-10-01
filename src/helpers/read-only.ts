/**
 * Clear Health fork: this server is READ-ONLY, unconditionally.
 *
 * Intuit's only accounting OAuth scope (com.intuit.quickbooks.accounting) grants
 * read AND write, so the token cannot be limited to reads. Our Intuit app
 * questionnaire says the app only reads data, and the server is driven by an AI
 * agent, so the tool list is the only control. Upstream offers opt-in
 * QUICKBOOKS_DISABLE_* env vars; we do not rely on them, because an env var that
 * is missing or mistyped would silently re-enable writes.
 *
 * This is an ALLOWLIST: a tool is registered only if its name starts with a
 * read verb. A new upstream tool with an unforeseen verb (void_, send_, ...)
 * is therefore excluded by default, not included.
 */

const READ_PREFIXES = ['get_', 'get-', 'read_', 'read-', 'search_', 'search-'];

/**
 * Read-named tools that still have side effects, excluded by name.
 * get_invoice_pdf writes a PDF to the local filesystem; the agent never needs it.
 */
const DENIED_READ_TOOLS = new Set(['get_invoice_pdf']);

export function isAllowedReadOnlyTool(toolName: string): boolean {
  if (DENIED_READ_TOOLS.has(toolName)) return false;
  return READ_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

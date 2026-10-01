#!/usr/bin/env node
/**
 * Clear Health fork: the SaaS-only MCP server. This is the entry point Cyrus runs
 * (`node dist/saas-server.js`).
 *
 * It registers exactly ONE tool, get_saas_revenue, which can only return data
 * from the two SaaS income accounts (src/saas/saas-revenue.ts). None of the
 * general QuickBooks tools in src/index.ts are imported, so they cannot be
 * reached through this server. Logic lives in src/saas/ (covered by tests).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { installIntuitTidLogging } from './helpers/intuit-tid.js';
import { buildSaasServer } from './saas/build-server.js';

installIntuitTidLogging();
await buildSaasServer().connect(new StdioServerTransport());

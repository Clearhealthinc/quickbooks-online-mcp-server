import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RegisterTool } from '../helpers/register-tool.js';
import { GetSaasRevenueTool } from './saas-tool.js';

/** The SaaS-only server: exactly one tool. Nothing from src/index.ts is imported. */
export function buildSaasServer(): McpServer {
  const server = new McpServer({ name: 'Clear Health QuickBooks SaaS revenue', version: '1.0.0' }, { capabilities: { tools: {} } });
  RegisterTool(server, GetSaasRevenueTool);
  return server;
}

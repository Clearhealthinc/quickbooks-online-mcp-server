import { describe, it, expect, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAllowedReadOnlyTool } from "../../../src/helpers/read-only";
import { RegisterTool } from "../../../src/helpers/register-tool";
import { z } from "zod";

// Clear Health fork: the server must expose no tool that can change QuickBooks.

describe("isAllowedReadOnlyTool", () => {
  it.each(["get_profit_and_loss", "get-bill", "read_invoice", "search_accounts", "search-x"])("allows %s", (name) =>
    expect(isAllowedReadOnlyTool(name)).toBe(true));

  it.each(["create_invoice", "create-bill", "update_customer", "delete_payment", "void_invoice", "send_invoice", ""])(
    "refuses %s (allowlist: unknown verbs are refused, not allowed)",
    (name) => expect(isAllowedReadOnlyTool(name)).toBe(false));

  it("refuses get_invoice_pdf, which writes a file despite its read verb", () =>
    expect(isAllowedReadOnlyTool("get_invoice_pdf")).toBe(false));
});

describe("every tool the server ships", () => {
  // Names are read from source rather than by importing the 142 tool modules:
  // importing them would pull every handler into the coverage gate untested.
  const toolsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../src/tools");
  const names = fs
    .readdirSync(toolsDir)
    .filter((f) => f.endsWith(".tool.ts"))
    .map((f) => /^const toolName = "([^"]+)"/m.exec(fs.readFileSync(path.join(toolsDir, f), "utf-8"))?.[1]);

  it("finds a name in every tool file", () => {
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => !n)).toEqual([]);
  });

  it("registers only read tools, and still registers the reports Cyrus needs", () => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    for (const name of names) RegisterTool(server, { name: name!, description: "d", schema: z.object({}), handler: jest.fn() } as any);
    const registered = (server.tool as jest.Mock).mock.calls.map((c) => c[0] as string);

    expect(registered.length).toBeLessThan(names.length);
    expect(registered.filter((n) => /^(create|update|delete)[_-]/.test(n))).toEqual([]);
    expect(registered).not.toContain("get_invoice_pdf");
    for (const needed of ["get_profit_and_loss", "get_customer_sales", "search_accounts", "search_items", "search_invoices", "search_payments"]) {
      expect(registered).toContain(needed);
    }
  });
});

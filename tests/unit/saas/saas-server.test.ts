import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from "../../mocks/quickbooks.mock";

jest.unstable_mockModule("../../../src/clients/quickbooks-client", () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { buildSaasServer } = await import("../../../src/saas/build-server");
const { GetSaasRevenueTool } = await import("../../../src/saas/saas-tool");

describe("SaaS-only server", () => {
  it("registers exactly one tool: get_saas_revenue", () => {
    const spy = jest.spyOn(McpServer.prototype, "tool");
    buildSaasServer();
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["get_saas_revenue"]);
  });

  it("says in its description that nothing else can be read", () => {
    expect(GetSaasRevenueTool.description).toContain("ONLY the Monthly SaaS Fees and SaaS Implementation Fees accounts");
  });
});

describe("get_saas_revenue handler", () => {
  beforeEach(() => resetAllMocks());
  const handler = GetSaasRevenueTool.handler as unknown as (a: any) => Promise<any>;
  const ok = (data: unknown) => (...args: any[]) => args[args.length - 1](null, data);

  it("defaults the range and returns the SaaS JSON", async () => {
    (mockQuickBooksInstance as any).reportGeneralLedgerDetail = jest.fn(ok({}));
    const res = await handler({ params: {} });
    const body = JSON.parse(res.content[0].text);
    expect(body.totals.total).toBe(0);
    const opts = ((mockQuickBooksInstance as any).reportGeneralLedgerDetail.mock.calls[0] as any[])[0];
    expect(opts.account).toBe("84,85");
    expect(opts.end_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("passes explicit dates and reports errors as tool errors", async () => {
    (mockQuickBooksInstance as any).reportGeneralLedgerDetail = jest.fn(ok({}));
    await handler({ params: { start_date: "2026-01-01", end_date: "2026-01-31" } });
    expect(((mockQuickBooksInstance as any).reportGeneralLedgerDetail.mock.calls[0] as any[])[0].start_date).toBe("2026-01-01");
    const bad = await handler({ params: { start_date: "nope" } });
    expect(bad).toEqual({ content: [{ type: "text", text: expect.stringContaining("YYYY-MM-DD") }], isError: true });
  });
});

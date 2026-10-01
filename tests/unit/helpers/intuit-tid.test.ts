import { describe, it, expect, jest } from "@jest/globals";
import { createRequire } from "module";
import { formatIntuitFailure, installIntuitTidLogging, intuitTidFrom } from "../../../src/helpers/intuit-tid";
import { formatError } from "../../../src/helpers/format-error";

const require = createRequire(import.meta.url);

describe("intuitTidFrom", () => {
  it("reads plain-object and AxiosHeaders-style headers", () => {
    expect(intuitTidFrom({ intuit_tid: "1-abc" })).toBe("1-abc");
    expect(intuitTidFrom({ get: (n: string) => (n === "intuit_tid" ? "1-def" : null) })).toBe("1-def");
  });
  it("returns undefined when absent or malformed", () => {
    expect(intuitTidFrom(undefined)).toBeUndefined();
    expect(intuitTidFrom("x")).toBeUndefined();
    expect(intuitTidFrom({ intuit_tid: "" })).toBeUndefined();
    expect(intuitTidFrom({ intuit_tid: 5 })).toBeUndefined();
  });
});

describe("formatIntuitFailure", () => {
  it("prints every field, and placeholders for missing ones", () => {
    expect(formatIntuitFailure({ status: 400, method: "get", path: "/v3/company/<realm>/query", intuitTid: "1-a", fault: "4000 bad" }))
      .toBe('[qbo-api] request failed status=400 method=get path=/v3/company/<realm>/query intuit_tid=1-a fault="4000 bad"');
    expect(formatIntuitFailure({})).toBe("[qbo-api] request failed status=n/a method=? path=? intuit_tid=none");
  });
});

describe("formatError carries intuit_tid", () => {
  it("appends it for an axios-style error", () => {
    const err = Object.assign(new Error("Request failed with status code 400"), { response: { headers: { intuit_tid: "1-xyz" } } });
    expect(formatError(err)).toBe("Error: Request failed with status code 400 (intuit_tid: 1-xyz)");
  });
  it("is unchanged without one", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
    expect(formatError("boom")).toBe("Error: boom");
    expect(formatError({ a: 1 })).toBe('Unknown error: {"a":1}');
  });
});

describe("installIntuitTidLogging", () => {
  // The interceptor must sit on the axios instance node-quickbooks itself uses.
  const qbAxios = () => {
    const qbRequire = createRequire(require.resolve("node-quickbooks"));
    const a = qbRequire("axios");
    return a.default ?? a;
  };

  it("logs failed calls and 200-with-Fault responses with their intuit_tid, and installs once", async () => {
    const lines: string[] = [];
    installIntuitTidLogging((l) => lines.push(l));
    installIntuitTidLogging((l) => lines.push(`second:${l}`)); // no-op

    const handlers: any[] = qbAxios().interceptors.response.handlers.filter(Boolean);
    const { fulfilled, rejected } = handlers[handlers.length - 1];

    const okRes = { status: 200, data: { QueryResponse: {} }, headers: { intuit_tid: "t0" }, config: {} };
    expect(fulfilled(okRes)).toBe(okRes);
    expect(lines).toEqual([]);

    const faultRes = {
      status: 200,
      data: { Fault: { Error: [{ code: "6000", Message: "business rule" }, {}] } },
      headers: { intuit_tid: "t1" },
      config: { method: "get", url: "https://quickbooks.api.intuit.com/v3/company/9130/reports/ProfitAndLoss?x=1" },
    };
    expect(fulfilled(faultRes)).toBe(faultRes);
    expect(lines[0]).toBe('[qbo-api] request failed status=200 method=get path=/v3/company/<realm>/reports/ProfitAndLoss intuit_tid=t1 fault="6000 business rule; "');

    const err = { config: { method: "post", url: "not a url" }, response: { status: 401, data: {}, headers: { intuit_tid: "t2" } }, code: "ERR_BAD_REQUEST" };
    await expect(rejected(err)).rejects.toBe(err);
    expect(lines[1]).toBe('[qbo-api] request failed status=401 method=post path=? intuit_tid=t2 fault="ERR_BAD_REQUEST"');

    await expect(rejected({ code: "ECONNRESET", config: { url: 5 } })).rejects.toBeDefined();
    expect(lines[2]).toBe('[qbo-api] request failed status=n/a method=? path=? intuit_tid=none fault="ECONNRESET"');
    await expect(rejected(undefined)).rejects.toBeUndefined();
    expect(lines).toHaveLength(4);
  });

  it("defaults to logging on stderr", async () => {
    jest.resetModules();
    const mod = await import("../../../src/helpers/intuit-tid");
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mod.installIntuitTidLogging();
    const handlers: any[] = qbAxios().interceptors.response.handlers.filter(Boolean);
    await expect(handlers[handlers.length - 1].rejected({})).rejects.toBeDefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[qbo-api] request failed"));
  });
});

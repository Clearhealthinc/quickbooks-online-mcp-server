import { describe, it, expect, jest, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ACCOUNTING_SCOPE,
  buildAuthorizeUrl,
  CallbackError,
  exchangeCode,
  newState,
  parseCallback,
  validateRedirectUri,
  writeTokenStore,
} from "../../../src/helpers/connect-flow";

const endpoints = {
  authorizeEndpoint: "https://appcenter.intuit.com/connect/oauth2",
  tokenEndpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revokeEndpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  userInfoEndpoint: "https://accounts.platform.intuit.com/v1/openid_connect/userinfo",
};
const REDIRECT = "https://example.ngrok-free.dev/callback";

describe("authorize URL and state", () => {
  it("builds the authorize URL from the discovered endpoint with the accounting scope and state", () => {
    const url = new URL(buildAuthorizeUrl(endpoints, "cid", REDIRECT, "s1"));
    expect(url.origin + url.pathname).toBe(endpoints.authorizeEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid", response_type: "code", scope: ACCOUNTING_SCOPE, redirect_uri: REDIRECT, state: "s1",
    });
  });
  it("makes a fresh 48-hex-char state each run", () => {
    const a = newState();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newState()).not.toBe(a);
  });
});

describe("validateRedirectUri", () => {
  it("accepts an https tunnel URL in production", () => expect(validateRedirectUri(REDIRECT, "production")).toBe(REDIRECT));
  it("accepts localhost in sandbox", () => expect(validateRedirectUri("http://localhost:8000/callback", "sandbox")).toBe("http://localhost:8000/callback"));
  it("refuses missing, malformed, http and localhost production URIs", () => {
    expect(() => validateRedirectUri(undefined, "production")).toThrow("not set");
    expect(() => validateRedirectUri("nope", "production")).toThrow("not a valid URL");
    expect(() => validateRedirectUri("http://example.com/callback", "production")).toThrow("https");
    expect(() => validateRedirectUri("https://localhost/callback", "production")).toThrow("localhost");
  });
});

describe("parseCallback", () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  it("returns code and realm when state matches", () =>
    expect(parseCallback(q({ state: "s1", code: "c", realmId: "9130" }), "s1")).toEqual({ code: "c", realmId: "9130" }));
  it("refuses a missing or different state as CSRF, before anything else", () => {
    for (const params of [q({ code: "c", realmId: "1" }), q({ state: "s2", code: "c", realmId: "1" }), q({ state: "s", error: "access_denied" })]) {
      try {
        parseCallback(params, "s1");
        throw new Error("did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(CallbackError);
        expect((e as CallbackError).kind).toBe("csrf");
      }
    }
  });
  it("reports a denied consent", () =>
    expect(() => parseCallback(q({ state: "s1", error: "access_denied" }), "s1")).toThrow(expect.objectContaining({ kind: "denied" })));
  it("reports a callback without code or realm", () =>
    expect(() => parseCallback(q({ state: "s1", code: "c" }), "s1")).toThrow(expect.objectContaining({ kind: "invalid" })));
});

describe("exchangeCode", () => {
  const res = (status: number, body: unknown, tid: string | null = "tid-1") => ({
    ok: status < 400, status, headers: { get: (n: string) => (n === "intuit_tid" ? tid : null) }, json: async () => body,
  });

  it("posts the code to the discovered token endpoint with basic auth", async () => {
    const f = jest.fn(async (..._a: any[]) => res(200, { refresh_token: "r1", x_refresh_token_expires_in: 8640000 }));
    await expect(exchangeCode(endpoints, "cid", "sec", "code1", REDIRECT, f as any)).resolves.toEqual({ refreshToken: "r1", refreshTokenExpiresInSeconds: 8640000 });
    const [url, init] = f.mock.calls[0] as any[];
    expect(url).toBe(endpoints.tokenEndpoint);
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ grant_type: "authorization_code", code: "code1", redirect_uri: REDIRECT });
  });
  it("names the intuit_tid when Intuit refuses", async () => {
    await expect(exchangeCode(endpoints, "c", "s", "x", REDIRECT, (async () => res(400, {})) as any)).rejects.toThrow("HTTP 400 (intuit_tid: tid-1)");
    await expect(exchangeCode(endpoints, "c", "s", "x", REDIRECT, (async () => res(401, {}, null)) as any)).rejects.toThrow("intuit_tid: none");
  });
  it("refuses a response without a refresh token", async () => {
    await expect(exchangeCode(endpoints, "c", "s", "x", REDIRECT, (async () => res(200, {})) as any)).rejects.toThrow("no refresh_token");
  });
  it("uses the global fetch by default", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(res(200, { refresh_token: "r2" }) as any);
    await expect(exchangeCode(endpoints, "c", "s", "x", REDIRECT)).resolves.toEqual({ refreshToken: "r2", refreshTokenExpiresInSeconds: undefined });
    spy.mockRestore();
  });
});

describe("writeTokenStore", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("replaces the token and realm, keeps every other line, and makes the file owner-only", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-"));
    const p = path.join(dir, ".env");
    fs.writeFileSync(p, "QUICKBOOKS_CLIENT_ID=cid\nQUICKBOOKS_REFRESH_TOKEN=old\n# note\n", { mode: 0o644 });
    writeTokenStore(p, { refreshToken: "new", realmId: "9130" });
    expect(fs.readFileSync(p, "utf-8")).toBe("QUICKBOOKS_CLIENT_ID=cid\nQUICKBOOKS_REFRESH_TOKEN=new\n# note\n\nQUICKBOOKS_REALM_ID=9130");
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
  it("creates the file when it does not exist", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-"));
    const p = path.join(dir, ".env");
    writeTokenStore(p, { refreshToken: "t", realmId: "1" });
    expect(fs.readFileSync(p, "utf-8")).toBe("QUICKBOOKS_REFRESH_TOKEN=t\nQUICKBOOKS_REALM_ID=1");
  });
});

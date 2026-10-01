import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { clearDiscoveryCache, discoverEndpoints, discoveryUrlFor, DISCOVERY_URLS } from "../../../src/helpers/intuit-discovery";

const doc = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  userinfo_endpoint: "https://accounts.platform.intuit.com/v1/openid_connect/userinfo",
};
const ok = (body: unknown) => jest.fn(async (..._args: any[]) => ({ ok: true, status: 200, json: async () => body }));

describe("discoverEndpoints", () => {
  beforeEach(() => clearDiscoveryCache());

  it("picks the production or sandbox document", () => {
    expect(discoveryUrlFor("production")).toBe(DISCOVERY_URLS.production);
    expect(discoveryUrlFor("sandbox")).toBe(DISCOVERY_URLS.sandbox);
    expect(discoveryUrlFor("anything-else")).toBe(DISCOVERY_URLS.sandbox);
  });

  it("maps the discovery document to intuit-oauth's setAuthorizeURLs shape", async () => {
    const f = ok(doc);
    await expect(discoverEndpoints("production", f as any)).resolves.toEqual({
      authorizeEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      revokeEndpoint: doc.revocation_endpoint,
      userInfoEndpoint: doc.userinfo_endpoint,
    });
    expect(f).toHaveBeenCalledWith(DISCOVERY_URLS.production, expect.anything());
  });

  it("fetches once per environment", async () => {
    const f = ok(doc);
    await discoverEndpoints("production", f as any);
    await discoverEndpoints("production", f as any);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next call retries", async () => {
    const bad = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(discoverEndpoints("production", bad as any)).rejects.toThrow("HTTP 503");
    const good = ok(doc);
    await expect(discoverEndpoints("production", good as any)).resolves.toBeDefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("rejects a document missing an endpoint or using http", async () => {
    await expect(discoverEndpoints("production", ok({ ...doc, token_endpoint: undefined }) as any)).rejects.toThrow("tokenEndpoint");
    clearDiscoveryCache();
    await expect(discoverEndpoints("production", ok({ ...doc, revocation_endpoint: "http://x" }) as any)).rejects.toThrow("revokeEndpoint");
  });

  it("uses the global fetch by default", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => doc } as any);
    await expect(discoverEndpoints("sandbox")).resolves.toBeDefined();
    expect(spy).toHaveBeenCalledWith(DISCOVERY_URLS.sandbox, expect.anything());
  });
});

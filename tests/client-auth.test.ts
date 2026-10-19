import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../src/auth.js";
import { AUTH_INVALID_MESSAGE, AUTH_MISSING_MESSAGE, B2matchAuthError, B2matchClient } from "../src/client.js";
import { VIEWER_STATUS } from "../src/queries.js";
import { authErrorResult } from "../src/tooling.js";

const OLD_ENV = { ...process.env };

describe("B2matchClient auth policy", () => {
  let dir: string;

  beforeEach(async () => {
    process.env = { ...OLD_ENV, B2MATCH_MCP_DISABLE_KEYCHAIN: "1" };
    dir = await mkdtemp(join(tmpdir(), "b2match-mcp-auth-"));
    process.env.B2MATCH_MCP_CONFIG_DIR = dir;
    delete process.env.B2MATCH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("throws a missing-login error without calling the API", async () => {
    const fetchImpl = vi.fn();
    const client = new B2matchClient(new AuthStore(dir), { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.query(VIEWER_STATUS, {}, { requireAuth: true })).rejects.toMatchObject({
      reason: "missing",
      message: AUTH_MISSING_MESSAGE
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(authErrorResult(new B2matchAuthError("missing")).isError).toBe(true);
  });

  it("retries a public query anonymously after 401 without deleting the stored token", async () => {
    const store = new AuthStore(dir);
    await store.save({ token: "stored-token", obtainedVia: "paste", loginEventId: "12345" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid authentication", { status: 401, headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } })
      );

    const client = new B2matchClient(store, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.query("query Public { ok }", {}, { requireAuth: false, cache: false });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await store.read())?.record.token).toBe("stored-token");

    await expect(client.query(VIEWER_STATUS, {}, { requireAuth: true, cache: false })).rejects.toMatchObject({
      reason: "invalid",
      message: AUTH_INVALID_MESSAGE
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(join(dir, "auth.json"), "utf8")).token).toBe("stored-token");
  });

  it("retries once on a transient network TypeError", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } })
      );
    const client = new B2matchClient(new AuthStore(dir), { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.query("query Public { ok }", {}, { cache: false })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const client = new B2matchClient(new AuthStore(dir), { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.query("query Public { ok }", {}, { cache: false })).rejects.toThrow("boom");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

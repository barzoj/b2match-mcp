import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStore, authFilePath, decodeJwtExpiry } from "../src/auth.js";

const OLD_ENV = { ...process.env };

describe("AuthStore", () => {
  let dir: string;

  beforeEach(async () => {
    process.env = { ...OLD_ENV, B2MATCH_MCP_DISABLE_KEYCHAIN: "1" };
    dir = await mkdtemp(join(tmpdir(), "b2match-mcp-test-"));
    process.env.B2MATCH_MCP_CONFIG_DIR = dir;
    delete process.env.B2MATCH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("stores token metadata in a 0600 fallback file", async () => {
    const store = new AuthStore(dir);
    const target = authFilePath(dir);
    const storage = await store.save({
      token: "not-a-jwt-token",
      obtainedVia: "paste",
      loginEventId: "12345"
    });

    expect(storage).toBe("file");
    const file = await stat(target);
    if (process.platform !== "win32") {
      expect(file.mode & 0o077).toBe(0);
    }

    const contents = JSON.parse(await readFile(target, "utf8")) as { token: string; loginEventId: string };
    expect(contents).toMatchObject({ token: "not-a-jwt-token", loginEventId: "12345" });
  });

  it("prefers B2MATCH_TOKEN without persisting it", async () => {
    process.env.B2MATCH_TOKEN = "env-token";
    const store = new AuthStore(dir);

    const read = await store.read();
    expect(read?.source).toBe("env");
    expect(read?.record.token).toBe("env-token");
  });

  it("decodes JWT exp when present", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString("base64url");
    expect(decodeJwtExpiry(`header.${payload}.sig`)).toBe("2027-01-15T08:00:00.000Z");
  });

  it("clears fallback storage", async () => {
    const store = new AuthStore(dir);
    await store.save({ token: "abc", obtainedVia: "paste" });
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});

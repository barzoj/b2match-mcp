import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStore, authFilePath, decodeJwtExpiry } from "../src/auth.js";
import type { CommandResult, CommandRunner, SecretBackend } from "../src/keychain.js";
import { MacOSKeychainBackend } from "../src/keychain.js";

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

  it("reports empty keychain secret as keychain-unreadable", async () => {
    const backend: SecretBackend = {
      kind: "macos-keychain",
      get: async () => "",
      set: async () => undefined,
      delete: async () => undefined
    };
    const store = new AuthStore(dir, backend);
    const status = await store.status();
    expect(status).toMatchObject({
      loggedIn: false,
      source: "keychain-unreadable"
    });
    expect(status.error).toMatch(/empty/i);
    expect(status.hint).toMatch(/login/i);
  });

  it("falls back to the 0600 file when keychain read-back mismatches", async () => {
    let stored: string | null = null;
    const backend: SecretBackend = {
      kind: "macos-keychain",
      get: async () => stored,
      set: async (secret) => {
        // Simulate the macOS bug: claim success but persist an empty secret.
        void secret;
        stored = "";
      },
      delete: async () => {
        stored = null;
      }
    };

    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new AuthStore(dir, backend);
    const storage = await store.save({ token: "paste-token", obtainedVia: "paste" });

    expect(storage).toBe("file");
    expect(stored).toBeNull();
    const file = JSON.parse(await readFile(authFilePath(dir), "utf8")) as { token: string };
    expect(file.token).toBe("paste-token");
    expect(err).toHaveBeenCalledWith("b2match-mcp: keychain read-back failed, stored in file");
    err.mockRestore();
  });

  it("keeps keychain storage when read-back matches", async () => {
    let stored: string | null = null;
    const backend: SecretBackend = {
      kind: "macos-keychain",
      get: async () => stored,
      set: async (secret) => {
        stored = secret;
      },
      delete: async () => {
        stored = null;
      }
    };

    const store = new AuthStore(dir, backend);
    const storage = await store.save({ token: "paste-token", obtainedVia: "paste" });
    expect(storage).toBe("keychain");
    expect(stored).toContain("paste-token");
    const status = await store.status();
    expect(status.source).toBe("keychain");
    expect(status.loggedIn).toBe(true);
  });
});

describe("MacOSKeychainBackend via AuthStore integration shape", () => {
  it("uses interactive -i runner for set", async () => {
    const runner: CommandRunner = vi.fn(async (): Promise<CommandResult> => ({
      code: 0,
      stdout: "",
      stderr: ""
    }));
    const backend = new MacOSKeychainBackend(runner);
    await backend.set('{"token":"x","obtainedVia":"paste","savedAt":"t"}');
    expect(runner).toHaveBeenCalledWith("/usr/bin/security", ["-i"], expect.stringContaining("-X "));
  });
});

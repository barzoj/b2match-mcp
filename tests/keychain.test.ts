import { describe, expect, it, vi } from "vitest";
import {
  LinuxSecretToolBackend,
  MacOSKeychainBackend,
  decodeKeychainPassword,
  encodeSecretForKeychain,
  linuxSecretToolCommands,
  macOSSecurityCommands,
  selectSecretBackend,
  type CommandRunner
} from "../src/keychain.js";

describe("keychain backend selection", () => {
  it("selects macOS Keychain when security is present", () => {
    expect(selectSecretBackend("darwin", true, false)).toBe("macos-keychain");
  });

  it("selects Linux secret-tool when available", () => {
    expect(selectSecretBackend("linux", false, true)).toBe("linux-secret-tool");
  });

  it("falls back to file storage otherwise", () => {
    expect(selectSecretBackend("win32", false, false)).toBe("file");
    expect(selectSecretBackend("linux", false, false)).toBe("file");
  });
});

describe("macOS security command construction", () => {
  it("writes via security -i with -X hex on stdin and keeps the secret out of argv", async () => {
    const calls: Array<{ command: string; args: string[]; input?: string }> = [];
    const runner: CommandRunner = vi.fn(async (command, args, input) => {
      calls.push({ command, args, input });
      return { code: 0, stdout: "", stderr: "" };
    });

    const secret = '{"token":"demo-token","obtainedVia":"paste","savedAt":"2026-01-01T00:00:00.000Z"}';
    await new MacOSKeychainBackend(runner).set(secret);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/usr/bin/security");
    expect(calls[0].args).toEqual(["-i"]);
    expect(calls[0].args.join(" ")).not.toContain(secret);
    expect(calls[0].input).toBeDefined();
    expect(calls[0].input).not.toContain(secret);
    expect(calls[0].input).toContain("-X ");
    expect(calls[0].input).toContain(encodeSecretForKeychain(secret));
    expect(calls[0].input).toMatch(/^add-generic-password -U -s b2match-mcp -a default -X [0-9a-f]+\n$/);
  });

  it("hex-decodes -w output when security prints hex", async () => {
    const payload = '{"token":"demo","obtainedVia":"paste","savedAt":"2026-01-01T00:00:00.000Z"}';
    const hex = encodeSecretForKeychain(payload);
    const runner: CommandRunner = vi.fn(async () => ({ code: 0, stdout: `${hex}\n`, stderr: "" }));
    const backend = new MacOSKeychainBackend(runner);

    await expect(backend.get()).resolves.toBe(payload);
  });

  it("returns raw printable -w output without hex-decoding JSON", async () => {
    const payload = '{"token":"demo","obtainedVia":"paste","savedAt":"2026-01-01T00:00:00.000Z"}';
    const runner: CommandRunner = vi.fn(async () => ({ code: 0, stdout: `${payload}\n`, stderr: "" }));
    await expect(new MacOSKeychainBackend(runner).get()).resolves.toBe(payload);
  });

  it("treats only exit 44 as not found when code is 0", async () => {
    const runner: CommandRunner = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "could not be found in the keychain" })
      .mockResolvedValueOnce({ code: 44, stdout: "", stderr: "could not be found" });
    const backend = new MacOSKeychainBackend(runner);

    // code 0 + "could not be found" must NOT be treated as missing (empty secret).
    await expect(backend.get()).resolves.toBe("");
    await expect(backend.get()).resolves.toBeNull();
  });

  it("reads and deletes with expected commands", async () => {
    const runner: CommandRunner = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "stored\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const backend = new MacOSKeychainBackend(runner);

    await expect(backend.get()).resolves.toBe("stored");
    await backend.delete();

    expect(runner).toHaveBeenNthCalledWith(1, "/usr/bin/security", macOSSecurityCommands().get[1]);
    expect(runner).toHaveBeenNthCalledWith(2, "/usr/bin/security", macOSSecurityCommands().delete[1]);
  });

  it("includes exit code and stderr in write errors without echoing the secret", async () => {
    const secret = "super-secret-value";
    const runner: CommandRunner = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "write failed: denied"
    }));

    await expect(new MacOSKeychainBackend(runner).set(secret)).rejects.toThrow(/exit 1.*stderr=write failed: denied/);
    await expect(new MacOSKeychainBackend(runner).set(secret)).rejects.not.toThrow(/super-secret/);
  });
});

describe("decodeKeychainPassword", () => {
  it("hex-decodes when not valid JSON", () => {
    const text = "hello-keychain";
    expect(decodeKeychainPassword(`${encodeSecretForKeychain(text)}\n`)).toBe(text);
  });

  it("keeps JSON passwords as-is", () => {
    const json = '{"a":1}';
    expect(decodeKeychainPassword(`${json}\n`)).toBe(json);
  });
});

describe("Linux secret-tool command construction", () => {
  it("passes the secret via stdin", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await new LinuxSecretToolBackend(runner).set("linux-secret");

    expect(runner).toHaveBeenCalledWith("secret-tool", linuxSecretToolCommands().set[1], "linux-secret\n");
  });
});

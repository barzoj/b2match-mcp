import { describe, expect, it, vi } from "vitest";
import {
  LinuxSecretToolBackend,
  MacOSKeychainBackend,
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
  it("does not put the secret in argv", async () => {
    const calls: Array<{ command: string; args: string[]; input?: string }> = [];
    const runner: CommandRunner = vi.fn(async (command, args, input) => {
      calls.push({ command, args, input });
      return { code: 0, stdout: "", stderr: "" };
    });

    await new MacOSKeychainBackend(runner).set("secret-value");

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/usr/bin/security");
    expect(calls[0].args).toEqual(macOSSecurityCommands().set[1]);
    expect(calls[0].args.join(" ")).not.toContain("secret-value");
    expect(calls[0].input).toBe("secret-value\n");
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
});

describe("Linux secret-tool command construction", () => {
  it("passes the secret via stdin", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await new LinuxSecretToolBackend(runner).set("linux-secret");

    expect(runner).toHaveBeenCalledWith(
      "secret-tool",
      linuxSecretToolCommands().set[1],
      "linux-secret\n"
    );
  });
});

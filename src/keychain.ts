import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const KEYCHAIN_SERVICE = "b2match-mcp";
export const KEYCHAIN_ACCOUNT = "default";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  input?: string
) => Promise<CommandResult>;

export interface SecretBackend {
  readonly kind: "macos-keychain" | "linux-secret-tool" | "file";
  get(): Promise<string | null>;
  set(secret: string): Promise<void>;
  delete(): Promise<void>;
}

export const runCommand: CommandRunner = (command, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });

export function macOSSecurityCommands(service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT) {
  return {
    get: ["/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"]] as const,
    set: ["/usr/bin/security", ["add-generic-password", "-U", "-s", service, "-a", account]] as const,
    delete: ["/usr/bin/security", ["delete-generic-password", "-s", service, "-a", account]] as const
  };
}

export function linuxSecretToolCommands(service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT) {
  return {
    get: ["secret-tool", ["lookup", "service", service, "account", account]] as const,
    set: [
      "secret-tool",
      ["store", "--label", service, "service", service, "account", account]
    ] as const,
    delete: ["secret-tool", ["clear", "service", service, "account", account]] as const
  };
}

export class MacOSKeychainBackend implements SecretBackend {
  readonly kind = "macos-keychain" as const;

  constructor(
    private readonly runner: CommandRunner = runCommand,
    private readonly service = KEYCHAIN_SERVICE,
    private readonly account = KEYCHAIN_ACCOUNT
  ) {}

  async get(): Promise<string | null> {
    const [command, args] = macOSSecurityCommands(this.service, this.account).get;
    const result = await this.runner(command, [...args]);
    if (result.code === 44 || /could not be found/i.test(result.stderr)) {
      return null;
    }
    if (result.code !== 0) {
      throw new Error(cleanCommandError(result.stderr, "macOS Keychain read failed"));
    }
    return stripTrailingNewline(result.stdout);
  }

  async set(secret: string): Promise<void> {
    const [command, args] = macOSSecurityCommands(this.service, this.account).set;
    const result = await this.runner(command, [...args], `${secret}\n`);
    if (result.code !== 0) {
      throw new Error(cleanCommandError(result.stderr, "macOS Keychain write failed"));
    }
  }

  async delete(): Promise<void> {
    const [command, args] = macOSSecurityCommands(this.service, this.account).delete;
    const result = await this.runner(command, [...args]);
    if (result.code !== 0 && result.code !== 44 && !/could not be found/i.test(result.stderr)) {
      throw new Error(cleanCommandError(result.stderr, "macOS Keychain delete failed"));
    }
  }
}

export class LinuxSecretToolBackend implements SecretBackend {
  readonly kind = "linux-secret-tool" as const;

  constructor(
    private readonly runner: CommandRunner = runCommand,
    private readonly service = KEYCHAIN_SERVICE,
    private readonly account = KEYCHAIN_ACCOUNT
  ) {}

  async get(): Promise<string | null> {
    const [command, args] = linuxSecretToolCommands(this.service, this.account).get;
    const result = await this.runner(command, [...args]);
    if (result.code !== 0) {
      return null;
    }
    return stripTrailingNewline(result.stdout);
  }

  async set(secret: string): Promise<void> {
    const [command, args] = linuxSecretToolCommands(this.service, this.account).set;
    const result = await this.runner(command, [...args], `${secret}\n`);
    if (result.code !== 0) {
      throw new Error(cleanCommandError(result.stderr, "secret-tool write failed"));
    }
  }

  async delete(): Promise<void> {
    const [command, args] = linuxSecretToolCommands(this.service, this.account).delete;
    const result = await this.runner(command, [...args]);
    if (result.code !== 0) {
      return;
    }
  }
}

export function selectSecretBackend(
  platform = process.platform,
  hasSecurity = existsSync("/usr/bin/security"),
  hasSecretTool = commandExistsOnPath("secret-tool")
): "macos-keychain" | "linux-secret-tool" | "file" {
  if (process.env.B2MATCH_MCP_DISABLE_KEYCHAIN) {
    return "file";
  }

  if (platform === "darwin" && hasSecurity) {
    return "macos-keychain";
  }

  if (platform === "linux" && hasSecretTool) {
    return "linux-secret-tool";
  }

  return "file";
}

export function createSecretBackend(
  runner: CommandRunner = runCommand,
  platform = process.platform
): SecretBackend | null {
  const selected = selectSecretBackend(platform);
  if (selected === "macos-keychain") {
    return new MacOSKeychainBackend(runner);
  }
  if (selected === "linux-secret-tool") {
    return new LinuxSecretToolBackend(runner);
  }
  return null;
}

function commandExistsOnPath(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path
    .split(process.platform === "win32" ? ";" : ":")
    .some((entry) => entry && existsSync(`${entry}/${command}`));
}

function stripTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function cleanCommandError(stderr: string, fallback: string): string {
  const message = stderr.trim();
  return message || fallback;
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSecretBackend, SecretBackend } from "./keychain.js";

export interface StoredAuth {
  token: string;
  expiresAt?: string;
  userId?: string;
  loginEventId?: string;
  obtainedVia: "browser" | "paste" | "env" | "password" | "magic-link";
  savedAt: string;
}

export interface AuthState {
  loggedIn: boolean;
  source: "env" | "keychain" | "file" | "none";
  expiresAt?: string;
  userId?: string;
  loginEventId?: string;
  obtainedVia?: StoredAuth["obtainedVia"];
}

export function configDir(): string {
  if (process.env.B2MATCH_MCP_CONFIG_DIR) {
    return process.env.B2MATCH_MCP_CONFIG_DIR;
  }

  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "b2match-mcp");
  }

  return join(homedir(), ".config", "b2match-mcp");
}

export function authFilePath(dir = configDir()): string {
  return join(dir, "auth.json");
}

export function decodeJwtExpiry(token: string): string | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as {
      exp?: number;
      sub?: string;
    };

    if (typeof decoded.exp === "number") {
      return new Date(decoded.exp * 1000).toISOString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function isExpired(expiresAt?: string, skewMs = 60_000): boolean {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() <= Date.now() + skewMs;
}

export class AuthStore {
  constructor(
    private readonly dir = configDir(),
    private readonly backend: SecretBackend | null = createSecretBackend()
  ) {}

  async read(): Promise<{ record: StoredAuth; source: "env" | "keychain" | "file" } | null> {
    const envToken = process.env.B2MATCH_TOKEN?.trim();
    if (envToken) {
      return {
        record: {
          token: envToken,
          expiresAt: decodeJwtExpiry(envToken),
          obtainedVia: "env",
          savedAt: new Date().toISOString()
        },
        source: "env"
      };
    }

    if (this.backend) {
      try {
        const password = await this.backend.get();
        if (password) {
          return { record: JSON.parse(password) as StoredAuth, source: "keychain" };
        }
      } catch {
        // Fall back to the local 0600 file when the OS keychain is unavailable,
        // locked, or denied by the user.
      }
    }

    try {
      const text = await readFile(authFilePath(this.dir), "utf8");
      return { record: JSON.parse(text) as StoredAuth, source: "file" };
    } catch {
      return null;
    }
  }

  async save(record: Omit<StoredAuth, "savedAt" | "expiresAt"> & { expiresAt?: string }): Promise<"keychain" | "file"> {
    const fullRecord: StoredAuth = {
      ...record,
      expiresAt: record.expiresAt ?? decodeJwtExpiry(record.token),
      savedAt: new Date().toISOString()
    };

    const serialized = JSON.stringify(fullRecord);

    if (this.backend) {
      try {
        await this.backend.set(serialized);
        await rm(authFilePath(this.dir), { force: true });
        return "keychain";
      } catch {
        // Continue to file fallback.
      }
    }

    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(authFilePath(this.dir), `${serialized}\n`, { mode: 0o600 });
    return "file";
  }

  async clear(): Promise<void> {
    if (this.backend) {
      try {
        await this.backend.delete();
      } catch {
        // Ignore keychain deletion failures; still clear the fallback file.
      }
    }

    await rm(authFilePath(this.dir), { force: true });
  }

  async status(): Promise<AuthState> {
    const stored = await this.read();
    if (!stored) {
      return { loggedIn: false, source: "none" };
    }

    const { record, source } = stored;
    return {
      loggedIn: !isExpired(record.expiresAt),
      source,
      expiresAt: record.expiresAt,
      userId: record.userId,
      loginEventId: record.loginEventId,
      obtainedVia: record.obtainedVia
    };
  }
}

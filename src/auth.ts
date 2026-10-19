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

export type AuthSource = "env" | "keychain" | "file" | "none" | "keychain-unreadable";

export interface AuthState {
  loggedIn: boolean;
  source: AuthSource;
  expiresAt?: string;
  userId?: string;
  loginEventId?: string;
  obtainedVia?: StoredAuth["obtainedVia"];
  /** Present when source is keychain-unreadable. Never includes the secret. */
  error?: string;
  hint?: string;
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

const KEYCHAIN_REREAD_HINT =
  "Re-run `b2match-mcp login` (or `login --paste`). If it keeps failing, set B2MATCH_MCP_DISABLE_KEYCHAIN=1 and try again.";

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
        if (password === null) {
          // Not found — fall through to the file.
        } else if (!password.trim()) {
          // Empty keychain item: try file fallback for callers that need a token.
        } else {
          try {
            return { record: JSON.parse(password) as StoredAuth, source: "keychain" };
          } catch {
            // Unparseable keychain payload — try file fallback.
          }
        }
      } catch {
        // Keychain unavailable/locked/denied — try file fallback.
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
        const readBack = await this.backend.get();
        if (readBack !== null && readBack === serialized) {
          await rm(authFilePath(this.dir), { force: true });
          return "keychain";
        }
        // Bad/empty read-back: remove the broken item so status does not stick on keychain-unreadable.
        try {
          await this.backend.delete();
        } catch {
          // Ignore delete failures; still fall back to the file.
        }
        console.error("b2match-mcp: keychain read-back failed, stored in file");
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
    const envToken = process.env.B2MATCH_TOKEN?.trim();
    if (envToken) {
      const expiresAt = decodeJwtExpiry(envToken);
      return {
        loggedIn: !isExpired(expiresAt),
        source: "env",
        expiresAt,
        obtainedVia: "env"
      };
    }

    if (this.backend) {
      try {
        const password = await this.backend.get();
        if (password === null) {
          // Not found — check file below.
        } else if (!password.trim()) {
          return {
            loggedIn: false,
            source: "keychain-unreadable",
            error: "macOS Keychain item exists but the secret is empty",
            hint: KEYCHAIN_REREAD_HINT
          };
        } else {
          try {
            const record = JSON.parse(password) as StoredAuth;
            return {
              loggedIn: !isExpired(record.expiresAt),
              source: "keychain",
              expiresAt: record.expiresAt,
              userId: record.userId,
              loginEventId: record.loginEventId,
              obtainedVia: record.obtainedVia
            };
          } catch {
            return {
              loggedIn: false,
              source: "keychain-unreadable",
              error: "macOS Keychain secret is not valid JSON metadata",
              hint: KEYCHAIN_REREAD_HINT
            };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          loggedIn: false,
          source: "keychain-unreadable",
          error: message,
          hint: KEYCHAIN_REREAD_HINT
        };
      }
    }

    try {
      const text = await readFile(authFilePath(this.dir), "utf8");
      const record = JSON.parse(text) as StoredAuth;
      return {
        loggedIn: !isExpired(record.expiresAt),
        source: "file",
        expiresAt: record.expiresAt,
        userId: record.userId,
        loginEventId: record.loginEventId,
        obtainedVia: record.obtainedVia
      };
    } catch {
      return { loggedIn: false, source: "none" };
    }
  }
}

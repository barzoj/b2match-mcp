import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth.js";
import { browserProfileDir } from "../src/browser.js";
import { logoutLocal } from "../src/login.js";

const OLD_ENV = { ...process.env };

describe("logoutLocal", () => {
  let dir: string;

  beforeEach(async () => {
    process.env = { ...OLD_ENV, B2MATCH_MCP_DISABLE_KEYCHAIN: "1" };
    dir = await mkdtemp(join(tmpdir(), "b2match-mcp-logout-"));
    process.env.B2MATCH_MCP_CONFIG_DIR = dir;
    delete process.env.B2MATCH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("clears the stored token without deleting the browser profile", async () => {
    const store = new AuthStore(dir);
    await store.save({ token: "stored-token", obtainedVia: "paste" });
    const profile = browserProfileDir(dir);
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "Local State"), "{}", { mode: 0o600 });

    await logoutLocal({}, dir);

    expect(await store.read()).toBeNull();
    await expect(access(join(profile, "Local State"))).resolves.toBeUndefined();
  });

  it("deletes the dedicated browser profile with --all", async () => {
    const store = new AuthStore(dir);
    await store.save({ token: "stored-token", obtainedVia: "paste" });
    const profile = browserProfileDir(dir);
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "Local State"), "{}", { mode: 0o600 });

    await logoutLocal({ all: true }, dir);

    expect(await store.read()).toBeNull();
    await expect(access(profile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

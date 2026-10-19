import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packageName, packageVersion, userAgent } from "../src/packageVersion.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };
const tscJs = join(root, "node_modules", "typescript", "lib", "tsc.js");
const cliJs = join(root, "dist", "cli.js");

describe("packageVersion", () => {
  it("matches package.json", () => {
    expect(packageVersion()).toBe(pkg.version);
    expect(packageName()).toBe(pkg.name);
    expect(userAgent()).toBe(`${pkg.name}/${pkg.version}`);
  });

  it("CLI --version equals package.json version", () => {
    execFileSync(process.execPath, [tscJs, "-p", "tsconfig.json"], { cwd: root, stdio: "pipe" });
    const output = execFileSync(process.execPath, [cliJs, "--version"], {
      cwd: root,
      encoding: "utf8"
    }).trim();
    expect(output).toBe(pkg.version);
  });
});

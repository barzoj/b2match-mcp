import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Installed package version from package.json (works from src/ and dist/). */
export function packageVersion(): string {
  return (require("../package.json") as { version: string }).version;
}

export function packageName(): string {
  return (require("../package.json") as { name: string }).name;
}

export function userAgent(): string {
  return `${packageName()}/${packageVersion()}`;
}

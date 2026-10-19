import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import WebSocket from "ws";
import { pickAuthCookie, type BrowserCookie } from "./cookies.js";
import { loginUsage } from "./invocation.js";

export const BROWSER_TARGET_COOKIE_METHOD = "Storage.getCookies";
export const PAGE_TARGET_COOKIE_METHOD = "Network.getAllCookies";

export const MAC_BROWSER_BUNDLES = [
  "Google Chrome.app",
  "Chromium.app",
  "Microsoft Edge.app",
  "Brave Browser.app"
] as const;

const MAC_BUNDLE_BINARIES: Record<string, string> = {
  "Google Chrome.app": "Contents/MacOS/Google Chrome",
  "Chromium.app": "Contents/MacOS/Chromium",
  "Microsoft Edge.app": "Contents/MacOS/Microsoft Edge",
  "Brave Browser.app": "Contents/MacOS/Brave Browser"
};

const LINUX_BROWSER_BINARIES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "microsoft-edge-stable",
  "brave-browser"
];

export interface BrowserExecutable {
  kind: "chrome" | "chromium" | "edge" | "brave";
  executable: string;
  appPath?: string;
}

export function findMacBrowserApps(exists: (path: string) => boolean = existsSync, home = homedir()): string[] {
  const roots = ["/Applications", `${home.replace(/\/$/, "")}/Applications`];
  const apps: string[] = [];
  for (const root of roots) {
    for (const bundle of MAC_BROWSER_BUNDLES) {
      const candidate = `${root}/${bundle}`;
      if (exists(candidate)) {
        apps.push(candidate);
      }
    }
  }
  return apps;
}

export function macAppExecutable(appPath: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const binary = MAC_BUNDLE_BINARIES[basename(appPath)];
  if (!binary) {
    return undefined;
  }
  const executable = `${appPath}/${binary}`;
  return exists(executable) ? executable : undefined;
}

export function findLinuxBrowserExecutables(
  exists: (path: string) => boolean = existsSync,
  pathVar = process.env.PATH ?? ""
): string[] {
  const dirs = pathVar.split(":").filter(Boolean);
  const found: string[] = [];
  for (const binary of LINUX_BROWSER_BINARIES) {
    for (const dir of dirs) {
      const candidate = `${dir}/${binary}`;
      if (exists(candidate) && !found.includes(candidate)) {
        found.push(candidate);
      }
    }
  }
  return found;
}

export function findBrowserExecutable(
  platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  home = homedir()
): BrowserExecutable | undefined {
  if (platform === "darwin") {
    for (const appPath of findMacBrowserApps(exists, home)) {
      const executable = macAppExecutable(appPath, exists);
      if (executable) {
        return { kind: browserKindFromName(appPath), executable, appPath };
      }
    }
  }

  if (platform === "linux") {
    const [executable] = findLinuxBrowserExecutables(exists);
    if (executable) {
      return { kind: browserKindFromName(executable), executable };
    }
  }

  return undefined;
}

export function buildChromiumLaunchArgs(options: { profileDir: string; port: number; url: string }): string[] {
  return [
    `--user-data-dir=${options.profileDir}`,
    `--remote-debugging-port=${options.port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    options.url
  ];
}

export function browserProfileDir(configDirectory: string): string {
  return join(configDirectory, "browser-profile");
}

export async function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Could not reserve a local debugging port."));
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

export async function waitForDebugger(port: number, timeoutMs = 15_000): Promise<string> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }

  throw new Error(
    `Timed out waiting for the dedicated browser debugger on 127.0.0.1:${port}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }.`
  );
}

export async function readBrowserCookies(
  debuggerUrl: string,
  options: {
    resolvePageDebuggerUrl?: (browserDebuggerUrl: string) => Promise<string | undefined>;
  } = {}
): Promise<BrowserCookie[]> {
  try {
    const result = await cdpCall<{ cookies?: BrowserCookie[] }>(debuggerUrl, BROWSER_TARGET_COOKIE_METHOD);
    return result.cookies ?? [];
  } catch (error) {
    const pageUrl = await (options.resolvePageDebuggerUrl ?? findPageDebuggerUrl)(debuggerUrl);
    if (!pageUrl) {
      throw error;
    }
    const result = await cdpCall<{ cookies?: BrowserCookie[] }>(pageUrl, PAGE_TARGET_COOKIE_METHOD);
    return result.cookies ?? [];
  }
}

export interface DebuggerTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export async function listDebuggerTargets(debuggerUrl: string): Promise<DebuggerTarget[]> {
  try {
    const { host } = new URL(debuggerUrl);
    const response = await fetch(`http://${host}/json/list`);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as DebuggerTarget[];
  } catch {
    return [];
  }
}

export async function findPageDebuggerUrl(browserDebuggerUrl: string): Promise<string | undefined> {
  const targets = await listDebuggerTargets(browserDebuggerUrl);
  return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
}

export async function readTargetUrls(debuggerUrl: string): Promise<string[]> {
  const targets = await listDebuggerTargets(debuggerUrl);
  return targets.filter((target) => target.type === "page" && target.url).map((target) => target.url as string);
}

/**
 * B2match's Google callback redirects to `<event url>?token=<JWT>`; the web app then
 * turns that into the event session cookie. That page can fail (Chrome has been seen
 * to 404) before the cookie is set, so the CLI also reads a JWT-shaped token from the
 * event tab URL.
 */
export function pickTokenFromUrls(urls: string[], euid?: string): string | undefined {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const isB2match = host === "b2match.com" || host.endsWith(".b2match.com") || host.endsWith(".b2match.io");
    if (!isB2match || host === "api.b2match.com") {
      continue;
    }
    const token = url.searchParams.get("token");
    if (!token || token.split(".").length !== 3) {
      continue;
    }
    if (euid && host.endsWith("b2match.com") && !url.pathname.toLowerCase().startsWith(`/e/${euid.toLowerCase()}`)) {
      continue;
    }
    return token;
  }
  return undefined;
}

export async function pollAuthCookie(options: {
  debuggerUrl: string;
  euid?: string;
  timeoutMs: number;
  intervalMs?: number;
  now?: () => number;
  readCookies?: (debuggerUrl: string) => Promise<BrowserCookie[]>;
  readUrls?: (debuggerUrl: string) => Promise<string[]>;
}): Promise<string> {
  const now = options.now ?? Date.now;
  const readCookies = options.readCookies ?? readBrowserCookies;
  const readUrls = options.readUrls ?? readTargetUrls;
  const deadline = now() + options.timeoutMs;
  const intervalMs = options.intervalMs ?? 1000;

  while (now() < deadline) {
    try {
      const fromUrl = pickTokenFromUrls(await readUrls(options.debuggerUrl), options.euid);
      if (fromUrl) {
        return fromUrl;
      }
      const token = pickAuthCookie(await readCookies(options.debuggerUrl), options.euid);
      if (token) {
        return token;
      }
    } catch {
      // The browser can be mid-navigation; try again on the next tick.
    }
    await delay(intervalMs);
  }

  throw new Error(
    `Timed out waiting for the B2match session. Finish Google sign-in in the opened window, or run \`${loginUsage("--paste")}\`.`
  );
}

export function launchDedicatedBrowser(options: {
  executable: string;
  profileDir: string;
  port: number;
  url: string;
}): ChildProcess {
  return spawn(options.executable, buildChromiumLaunchArgs(options), {
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
}

export function stopBrowserProcess(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill();
      return;
    }
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The dedicated browser may already have exited.
    }
  }
}

function browserKindFromName(name: string): BrowserExecutable["kind"] {
  const lower = name.toLowerCase();
  if (lower.includes("edge")) {
    return "edge";
  }
  if (lower.includes("brave")) {
    return "brave";
  }
  if (lower.includes("chromium")) {
    return "chromium";
  }
  return "chrome";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpCall<T>(debuggerUrl: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(debuggerUrl, { perMessageDeflate: false });
    const id = 1;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      action();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Chrome DevTools call ${method} timed out.`)));
    }, 5000);

    socket.on("open", () => {
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(String(data)) as { id?: number; result?: T; error?: { message?: string } };
        if (payload.id !== id) {
          return;
        }
        if (payload.error) {
          const message = payload.error.message ?? `${method} failed`;
          finish(() => reject(new Error(message)));
          return;
        }
        finish(() => resolve((payload.result ?? {}) as T));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.on("error", (error) => {
      finish(() => reject(error));
    });
    socket.on("close", () => {
      finish(() => reject(new Error(`Chrome DevTools call ${method} closed before a result.`)));
    });
  });
}

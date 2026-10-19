import { once } from "node:events";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  BROWSER_TARGET_COOKIE_METHOD,
  PAGE_TARGET_COOKIE_METHOD,
  buildChromiumLaunchArgs,
  findLinuxBrowserExecutables,
  findMacBrowserApps,
  macAppExecutable,
  readBrowserCookies
} from "../src/browser.js";
import { AUTH_COOKIE_FALLBACK } from "../src/cookies.js";

describe("browser discovery and launch args", () => {
  it("finds supported macOS browser app bundles in priority order", () => {
    const existing = new Set([
      "/Applications/Brave Browser.app",
      "/Users/example/Applications/Google Chrome.app",
      "/Users/example/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ]);

    const apps = findMacBrowserApps((path) => existing.has(path), "/Users/example");

    expect(apps).toEqual([
      "/Applications/Brave Browser.app",
      "/Users/example/Applications/Google Chrome.app"
    ]);
    expect(macAppExecutable(apps[1], (path) => existing.has(path))).toBe(
      "/Users/example/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    );
  });

  it("finds Linux browser binaries on PATH", () => {
    const existing = new Set(["/usr/bin/chromium", "/usr/bin/google-chrome-stable"]);
    expect(findLinuxBrowserExecutables((path) => existing.has(path), "/usr/bin:/usr/local/bin")).toEqual([
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium"
    ]);
  });

  it("builds a dedicated-profile launch command without putting secrets in argv", () => {
    const args = buildChromiumLaunchArgs({
      profileDir: "/tmp/b2match-profile",
      port: 9333,
      url: "https://api.b2match.com/integrations/login/google?event_id=1&redirect=https://www.b2match.com/e/example-event-2026"
    });

    expect(args).toEqual([
      "--user-data-dir=/tmp/b2match-profile",
      "--remote-debugging-port=9333",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "https://api.b2match.com/integrations/login/google?event_id=1&redirect=https://www.b2match.com/e/example-event-2026"
    ]);
    expect(args.join(" ")).not.toMatch(/token|cookie|bearer/i);
  });
});

describe("readBrowserCookies", () => {
  it("sends Storage.getCookies on the browser CDP target and reads the {cookies} result", async () => {
    const methods: string[] = [];
    const { url, close } = await serveCdp((message) => {
      methods.push(message.method);
      return {
        id: message.id,
        result: {
          cookies: [{ name: AUTH_COOKIE_FALLBACK, value: "scoped-token", domain: ".b2match.com" }]
        }
      };
    });

    try {
      await expect(readBrowserCookies(url)).resolves.toEqual([
        { name: AUTH_COOKIE_FALLBACK, value: "scoped-token", domain: ".b2match.com" }
      ]);
      expect(methods).toEqual([BROWSER_TARGET_COOKIE_METHOD]);
    } finally {
      await close();
    }
  });

  it("falls back to Network.getAllCookies on a page target when the browser method is missing", async () => {
    const methods: string[] = [];
    const page = await serveCdp((message) => {
      methods.push(message.method);
      return {
        id: message.id,
        result: {
          cookies: [{ name: AUTH_COOKIE_FALLBACK, value: "page-token", domain: ".b2match.com" }]
        }
      };
    });
    const browser = await serveCdp((message) => {
      methods.push(message.method);
      return {
        id: message.id,
        error: { message: `'${BROWSER_TARGET_COOKIE_METHOD}' wasn't found` }
      };
    });

    try {
      await expect(
        readBrowserCookies(browser.url, { resolvePageDebuggerUrl: async () => page.url })
      ).resolves.toEqual([{ name: AUTH_COOKIE_FALLBACK, value: "page-token", domain: ".b2match.com" }]);
      expect(methods).toEqual([BROWSER_TARGET_COOKIE_METHOD, PAGE_TARGET_COOKIE_METHOD]);
    } finally {
      await page.close();
      await browser.close();
    }
  });
});

async function serveCdp(
  reply: (message: { id: number; method: string }) => Record<string, unknown>
): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const { port } = wss.address() as AddressInfo;
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as { id: number; method: string };
      socket.send(JSON.stringify(reply(message)));
    });
  });

  return {
    url: `ws://127.0.0.1:${port}/devtools/browser/test`,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      await once(wss, "close");
    }
  };
}

import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { pickTokenFromUrls, pollAuthCookie, readTargetUrls } from "../src/browser.js";
import { eventAuthCookieName } from "../src/cookies.js";

const jwt = "aaa.bbb.ccc";
const euid = "example-event-2026";

describe("pickTokenFromUrls", () => {
  it("takes the token from the B2match event redirect URL", () => {
    expect(pickTokenFromUrls([`https://www.b2match.com/e/${euid}?token=${jwt}`], euid)).toBe(jwt);
  });

  it("ignores other hosts, other events and the API callback", () => {
    expect(
      pickTokenFromUrls(
        [
          `https://evil.example.com/e/${euid}?token=${jwt}`,
          `https://www.b2match.com/e/other-event-2026?token=${jwt}`,
          `https://api.b2match.com/integrations/login/google/callback?token=${jwt}`,
          `https://www.b2match.com/e/${euid}?token=notajwt`
        ],
        euid
      )
    ).toBeUndefined();
  });
});

describe("readTargetUrls", () => {
  it("reads page URLs from the debugger /json/list endpoint", async () => {
    const eventUrl = `https://www.b2match.com/e/${euid}?token=${jwt}`;
    const server = createServer((req, res) => {
      if (req.url === "/json/list") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify([
            { type: "page", url: eventUrl },
            { type: "iframe", url: "https://accounts.google.com/" },
            { type: "page", url: "" }
          ])
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(readTargetUrls(`ws://127.0.0.1:${port}/devtools/browser/x`)).resolves.toEqual([eventUrl]);
    } finally {
      server.close();
    }
  });
});

describe("pollAuthCookie", () => {
  it("returns the URL token even when no cookie was set", async () => {
    const token = await pollAuthCookie({
      debuggerUrl: "ws://127.0.0.1:1/devtools/browser/x",
      euid,
      timeoutMs: 1000,
      intervalMs: 1,
      readCookies: async () => [],
      readUrls: async () => [`https://www.b2match.com/e/${euid}?token=${jwt}`]
    });
    expect(token).toBe(jwt);
  });

  it("keeps polling through transient CDP errors", async () => {
    let calls = 0;
    const token = await pollAuthCookie({
      debuggerUrl: "ws://127.0.0.1:1/devtools/browser/x",
      euid,
      timeoutMs: 1000,
      intervalMs: 1,
      readUrls: async () => [],
      readCookies: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("socket hang up");
        }
        return [{ name: eventAuthCookieName(euid), value: jwt, domain: "www.b2match.com", path: "/e" }];
      }
    });
    expect(token).toBe(jwt);
  });
});

import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_FALLBACK,
  AUTH_COOKIE_PREFIX,
  eventAuthCookieName,
  pickAuthCookie
} from "../src/cookies.js";

describe("pickAuthCookie", () => {
  const euid = "example-event-2026";

  it("prefers the event-scoped session cookie", () => {
    expect(
      pickAuthCookie(
        [
          { name: AUTH_COOKIE_FALLBACK, value: "fallback", domain: ".b2match.com" },
          { name: eventAuthCookieName(euid), value: "scoped", domain: ".b2match.com" }
        ],
        euid
      )
    ).toBe("scoped");
  });

  it("accepts the fallback cookie name", () => {
    expect(
      pickAuthCookie([{ name: AUTH_COOKIE_FALLBACK, value: "fallback", domain: "www.b2match.com" }], euid)
    ).toBe("fallback");
  });

  it("ignores cookies from other domains", () => {
    expect(
      pickAuthCookie([{ name: `${AUTH_COOKIE_PREFIX}${euid}`, value: "nope", domain: "example.com" }], euid)
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { parseEventIdentifier } from "../src/eventIdentifier.js";

describe("parseEventIdentifier", () => {
  it("parses numeric ids", () => {
    expect(parseEventIdentifier("12345")).toEqual({ kind: "id", id: "12345" });
  });

  it("parses current b2match event URLs", () => {
    expect(parseEventIdentifier("https://www.b2match.com/e/example-event-2026/my")).toEqual({
      kind: "euid",
      euid: "example-event-2026"
    });
  });

  it("parses legacy b2match.io event URLs", () => {
    expect(parseEventIdentifier("https://example-event-2026.b2match.io/participants")).toEqual({
      kind: "euid",
      euid: "example-event-2026"
    });
  });

  it("parses bare slugs", () => {
    expect(parseEventIdentifier("Example-Event-2026")).toEqual({
      kind: "euid",
      euid: "example-event-2026"
    });
  });

  it("rejects unsupported identifiers", () => {
    expect(() => parseEventIdentifier("https://example.com/e/foo")).toThrow(/numeric id/);
  });
});

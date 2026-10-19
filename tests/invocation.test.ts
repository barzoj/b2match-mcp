import { describe, expect, it } from "vitest";
import { loginUsage } from "../src/invocation.js";

describe("loginUsage", () => {
  it("names the installed binary and mentions npx as an alternative", () => {
    expect(loginUsage()).toBe("b2match-mcp login <event-url> (or npx b2match-mcp login <event-url>)");
    expect(loginUsage("--paste")).toBe("b2match-mcp login --paste (or npx b2match-mcp login --paste)");
    expect(loginUsage()).not.toMatch(/^npx /);
  });
});

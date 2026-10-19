import { describe, expect, it } from "vitest";
import { compactParticipant } from "../src/participants.js";

describe("compactParticipant", () => {
  it("returns a short summary", () => {
    expect(
      compactParticipant({
        id: "1",
        profileUrl: "/e/example-event-2026/participants/1",
        organisationName: "Example Org",
        about: "A long biography that should be omitted from the default list.",
        pitch: "Also omitted",
        user: { firstName: "Ada", lastName: "Lovelace", jobPosition: "Mathematician" },
        location: { city: "London", country: { iso: "GB", name: "United Kingdom" } },
        participation: { organisation: { name: "Example Org", fullName: "Example Organisation" } }
      })
    ).toEqual({
      id: "1",
      name: "Ada Lovelace",
      job: "Mathematician",
      org: "Example Organisation",
      country: "United Kingdom",
      profileUrl: "/e/example-event-2026/participants/1"
    });
  });
});

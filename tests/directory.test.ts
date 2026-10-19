import { describe, expect, it } from "vitest";
import {
  candidateSectionPaths,
  parseRouteTypenames,
  opportunityDetailPaths,
  resolveDetailPath,
  resolveSectionPath,
  routeTypename,
  sessionAttendees
} from "../src/directory.js";

const event = {
  navigation: {
    items: {
      nodes: [
        { name: "Home", url: "/e/example-event-2026" },
        {
          name: "Directory",
          nodes: {
            nodes: [
              { name: "Participants", url: "/e/example-event-2026/components/11" },
              { name: "Companies", url: "/e/example-event-2026/components/22" },
              { name: "Cooperation profile", url: "/e/example-event-2026/components/33" },
              { name: "Agenda", url: "/components/44" },
              { name: "Speakers", url: "/components/55" }
            ]
          }
        }
      ]
    }
  }
};

describe("resolveSectionPath", () => {
  it("uses an explicit path when provided", () => {
    expect(resolveSectionPath(event, "agenda", "/custom/agenda")).toBe("/custom/agenda");
  });

  it("resolves menu items instead of hardcoded section slugs", () => {
    expect(resolveSectionPath(event, "participants")).toBe("/components/11");
    expect(resolveSectionPath(event, "organisations")).toBe("/components/22");
    expect(resolveSectionPath(event, "opportunities")).toBe("/components/33");
    expect(resolveSectionPath(event, "agenda")).toBe("/components/44");
    expect(resolveSectionPath(event, "speakers")).toBe("/components/55");
  });

  it("includes other component menu paths as later candidates", () => {
    expect(candidateSectionPaths(event, "organisations")).toContain("/components/11");
    expect(candidateSectionPaths(event, "organisations")[0]).toBe("/components/22");
  });

  it("builds canonical detail paths instead of appending to the list path", () => {
    expect(resolveDetailPath("organisations", "99")).toBe("/participations/99");
    expect(resolveDetailPath("opportunities", "abc")).toBe("/opportunities/abc");
    expect(resolveDetailPath("sessions", "s1")).toBe("/sessions/s1");
  });

  it("prefers the marketplace menu path for opportunity details", () => {
    expect(opportunityDetailPaths("/components/33", "abc")).toEqual([
      "/components/33/abc",
      "/opportunities/abc",
      "/marketplace/abc"
    ]);
  });

  it("reads a route typename from a GraphQL payload", () => {
    expect(routeTypename({ eventByEuidV2: { routeByPath: { __typename: "AgendaRoute" } } })).toBe("AgendaRoute");
  });

  it("maps aliased route typenames from one probe query", () => {
    const types = parseRouteTypenames(
      {
        eventByEuidV2: {
          r0: { __typename: "WebsitePageRoute" },
          r1: { __typename: "ParticipationsRoute" }
        }
      },
      ["/components/1", "/components/2"]
    );
    expect(types.get("/components/1")).toBe("WebsitePageRoute");
    expect(types.get("/components/2")).toBe("ParticipationsRoute");
  });

  it("returns only attendees from a session route payload", () => {
    expect(
      sessionAttendees({
        eventByEuidV2: {
          routeByPath: {
            __typename: "SessionRoute",
            session: {
              sessionId: "s1",
              title: "Pitch",
              attendees: { count: 1, nodes: [{ id: "p1" }] }
            }
          }
        }
      })
    ).toEqual({
      sessionId: "s1",
      title: "Pitch",
      attendees: { count: 1, nodes: [{ id: "p1" }] }
    });
  });
});

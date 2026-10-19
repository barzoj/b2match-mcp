import { describe, expect, it } from "vitest";
import { B2matchApi, ConversationNotFoundError, RouteNotFoundError } from "../src/api.js";
import { B2matchClient, B2matchGraphQLError } from "../src/client.js";
import { NOTIFICATION_COUNTERS, NOTIFICATIONS } from "../src/queries.js";
import { notFoundResult } from "../src/tooling.js";

const euid = "example-event-2026";
const eventId = "12345";

function mockClient(queryImpl: (...args: unknown[]) => Promise<unknown>): B2matchClient {
  return {
    resolveEvent: async () => ({ id: eventId, euid, raw: {} }),
    query: queryImpl
  } as unknown as B2matchClient;
}

function meetingsPayload() {
  return {
    viewer: {
      id: "viewer-1",
      participantByEuid: {
        id: "participant-1",
        isAvailable: true,
        openNetworkingEnabled: true,
        meetings: { accepted: { nodes: [{ id: "m1" }] } },
        availability: {
          days: {
            nodes: [
              {
                date: "2026-03-10",
                blocks: {
                  nodes: [
                    {
                      timeslots: {
                        nodes: [
                          { id: "s1", begin: "09:00", end: "09:15", viewerIsRegistered: true, meeting: null },
                          { id: "s2", begin: "09:15", end: "09:30", viewerIsRegistered: true, meeting: null }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  };
}

describe("B2matchApi meetings and availability", () => {
  it("returns merged free ranges by default", async () => {
    const api = new B2matchApi(mockClient(async () => meetingsPayload()));
    const availability = await api.myAvailability(euid);
    expect(availability.availability).toMatchObject({
      days: [{ date: "2026-03-10", free: [{ begin: "09:00", end: "09:30" }], bookedCount: 0 }]
    });
    expect(JSON.stringify(availability)).not.toContain('"timeslots"');
  });

  it("returns the full availability grid when detail is true", async () => {
    const payload = meetingsPayload();
    const api = new B2matchApi(mockClient(async () => payload));
    const availability = await api.myAvailability(euid, true);
    expect(availability.availability).toEqual(payload.viewer.participantByEuid.availability);
  });

  it("compacts unfiltered my_meetings unless detail is true", async () => {
    const payload = meetingsPayload();
    const api = new B2matchApi(mockClient(async () => payload));
    const compact = await api.myMeetings(euid);
    expect(compact.viewer.participantByEuid.meetings).toEqual(payload.viewer.participantByEuid.meetings);
    expect(compact.viewer.participantByEuid.availability.days[0].free).toEqual([{ begin: "09:00", end: "09:30" }]);
    expect(JSON.stringify(compact)).not.toContain('"timeslots"');

    const detailed = await api.myMeetings(euid, undefined, true);
    expect(detailed).toEqual(payload);
  });
});

describe("B2matchApi.getConversation", () => {
  const conversationId = "00000000-0000-4000-8000-000000000000";

  it("throws a not-found error when the conversation is missing", async () => {
    const api = new B2matchApi(mockClient(async () => ({ conversation: null })));
    await expect(api.getConversation(conversationId)).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(notFoundResult(new ConversationNotFoundError().message)).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Conversation not found." }]
    });
  });

  it("maps GraphQL not-found errors", async () => {
    const api = new B2matchApi(
      mockClient(async () => {
        throw new B2matchGraphQLError("Record not found");
      })
    );
    await expect(api.getConversation(conversationId)).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it("maps requested-element-is-null errors to Conversation not found", async () => {
    const api = new B2matchApi(
      mockClient(async () => {
        throw new B2matchGraphQLError("requested element is null for conversation");
      })
    );
    await expect(api.getConversation(conversationId)).rejects.toMatchObject({
      name: "ConversationNotFoundError",
      message: "Conversation not found."
    });
  });
});

describe("B2matchApi.listNotifications", () => {
  it("fetches counters only by default", async () => {
    const queries: string[] = [];
    const api = new B2matchApi(
      mockClient(async (query) => {
        queries.push(String(query));
        return { viewer: { participantByEuid: { notificationsCounter: { unread: 2, unseen: 4 } } } };
      })
    );
    await expect(api.listNotifications(euid)).resolves.toMatchObject({
      viewer: { participantByEuid: { notificationsCounter: { unread: 2, unseen: 4 } } }
    });
    expect(queries[0]).toBe(NOTIFICATION_COUNTERS);
    expect(queries[0]).not.toContain("notifications(");
  });

  it("fetches the full list only when list is requested", async () => {
    const queries: string[] = [];
    const api = new B2matchApi(
      mockClient(async (query) => {
        queries.push(String(query));
        return { viewer: { participantByEuid: { notifications: { nodes: [] } } } };
      })
    );
    await api.listNotifications(euid, { list: true });
    expect(queries[0]).toBe(NOTIFICATIONS);
  });
});

describe("B2matchApi.getOpportunity", () => {
  const eventRaw = {
    navigation: {
      items: {
        nodes: [{ name: "Cooperation profile", url: "/e/example-event-2026/components/33" }]
      }
    }
  };

  it("resolves the marketplace menu path and returns the opportunity route", async () => {
    const paths: string[] = [];
    const api = new B2matchApi({
      resolveEvent: async () => ({ id: eventId, euid, raw: eventRaw }),
      query: async (query: string, variables: Record<string, unknown> = {}) => {
        if (String(query).includes("RouteTypenames")) {
          return { eventByEuidV2: { r0: { __typename: "OpportunitiesRoute" } } };
        }
        paths.push(String(variables.path));
        if (variables.path === "/components/33/opp-1") {
          return { eventByEuidV2: { routeByPath: { __typename: "OpportunityRoute", id: "opp-1" } } };
        }
        return { eventByEuidV2: { routeByPath: { __typename: "NotFoundRoute" } } };
      }
    } as unknown as B2matchClient);

    await expect(api.getOpportunity(euid, "opp-1")).resolves.toMatchObject({
      eventByEuidV2: { routeByPath: { __typename: "OpportunityRoute" } }
    });
    expect(paths[0]).toBe("/components/33/opp-1");
  });

  it("returns a not-found error instead of NotFoundRoute", async () => {
    const api = new B2matchApi({
      resolveEvent: async () => ({ id: eventId, euid, raw: {} }),
      query: async () => ({ eventByEuidV2: { routeByPath: { __typename: "NotFoundRoute" } } })
    } as unknown as B2matchClient);

    await expect(api.getOpportunity(euid, "missing")).rejects.toBeInstanceOf(RouteNotFoundError);
  });
});

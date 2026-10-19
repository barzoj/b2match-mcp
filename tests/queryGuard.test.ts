import { describe, expect, it } from "vitest";
import { buildRouteTypenamesQuery } from "../src/queries.js";
import { assertReadOnlyGraphQL, UnsafeGraphQLOperationError } from "../src/queryGuard.js";

describe("assertReadOnlyGraphQL", () => {
  it("accepts query operations", () => {
    expect(() =>
      assertReadOnlyGraphQL(`
        query EventById($id: ID!) {
          event(id: $id) {
            id
            title
          }
        }
      `)
    ).not.toThrow();
  });

  it("rejects mutations", () => {
    expect(() =>
      assertReadOnlyGraphQL(`
        mutation SaveMeeting($input: SaveMeetingInput!) {
          saveMeeting(input: $input) {
            id
          }
        }
      `)
    ).toThrow(UnsafeGraphQLOperationError);
  });

  it("rejects subscriptions", () => {
    expect(() =>
      assertReadOnlyGraphQL(`
        subscription ConversationUpdates {
          conversationUpdated {
            id
          }
        }
      `)
    ).toThrow(/Only GraphQL query operations/);
  });

  it("rejects read-looking blocked operation names", () => {
    expect(() =>
      assertReadOnlyGraphQL(`
        mutation ParticipantView($input: ParticipantViewInput!) {
          participantView(input: $input) {
            id
          }
        }
      `)
    ).toThrow(/Blocked GraphQL operation/);
  });

  it("allows explicit auth mutations only when requested", () => {
    const mutation = `
      mutation LogIn($eventId: ID!, $email: String!, $password: String!) {
        login(input: { eventId: $eventId, email: $email, password: $password }) {
          ... on LoginSuccessPayload {
            payload { token expireDate }
          }
        }
      }
    `;

    expect(() => assertReadOnlyGraphQL(mutation)).toThrow();
    expect(() => assertReadOnlyGraphQL(mutation, { allowAuthMutations: true })).not.toThrow();
  });

  it("accepts the batched route-typename probe query", () => {
    const query = buildRouteTypenamesQuery(3);
    expect(query).toContain("r0: routeByPath(path: $p0)");
    expect(query).toContain("r2: routeByPath(path: $p2)");
    expect(() => assertReadOnlyGraphQL(query)).not.toThrow();
  });
});

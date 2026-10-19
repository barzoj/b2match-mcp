import { afterEach, describe, expect, it } from "vitest";
import { AUTH_INVALID_MESSAGE } from "../src/client.js";
import { CONVERSATION, NOTIFICATION_COUNTERS, NOTIFICATIONS } from "../src/queries.js";
import {
  assertNoUnacknowledgedSideEffectReads,
  assertReadOnlyGraphQL,
  UnsafeGraphQLOperationError
} from "../src/queryGuard.js";
import {
  CONVERSATION_SIDE_EFFECT_MESSAGE,
  NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE,
  SIDE_EFFECT_READS_ENV,
  conversationMessagesGate,
  notificationListGate
} from "../src/sideEffects.js";
import { errorResult } from "../src/tooling.js";

const OLD_ENV = process.env[SIDE_EFFECT_READS_ENV];

afterEach(() => {
  if (OLD_ENV === undefined) {
    delete process.env[SIDE_EFFECT_READS_ENV];
  } else {
    process.env[SIDE_EFFECT_READS_ENV] = OLD_ENV;
  }
});

describe("side-effect read gating", () => {
  it("blocks get_conversation unless env and acknowledge_marks_read are both set", () => {
    delete process.env[SIDE_EFFECT_READS_ENV];
    expect(conversationMessagesGate(true)).toBe(CONVERSATION_SIDE_EFFECT_MESSAGE);
    expect(conversationMessagesGate(false)).toBe(CONVERSATION_SIDE_EFFECT_MESSAGE);

    process.env[SIDE_EFFECT_READS_ENV] = "1";
    expect(conversationMessagesGate(false)).toBe(CONVERSATION_SIDE_EFFECT_MESSAGE);
    expect(conversationMessagesGate(true)).toBeUndefined();
    expect(errorResult(CONVERSATION_SIDE_EFFECT_MESSAGE).isError).toBe(true);
    expect(CONVERSATION_SIDE_EFFECT_MESSAGE).toMatch(/list_conversations/);
    expect(CONVERSATION_SIDE_EFFECT_MESSAGE).toMatch(/marks that conversation as read/i);
  });

  it("blocks the notification list unless env and acknowledge_marks_seen are both set", () => {
    delete process.env[SIDE_EFFECT_READS_ENV];
    expect(notificationListGate(true)).toBe(NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE);

    process.env[SIDE_EFFECT_READS_ENV] = "1";
    expect(notificationListGate(false)).toBe(NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE);
    expect(notificationListGate(true)).toBeUndefined();
    expect(NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE).toMatch(/unseen/);
  });
});

describe("graphql_read side-effect field guard", () => {
  it("rejects messagesV2 and the notifications list unless the env is set", () => {
    delete process.env[SIDE_EFFECT_READS_ENV];
    expect(() => assertReadOnlyGraphQL(CONVERSATION)).not.toThrow();
    expect(() => assertNoUnacknowledgedSideEffectReads(CONVERSATION)).toThrow(UnsafeGraphQLOperationError);
    expect(() => assertNoUnacknowledgedSideEffectReads(NOTIFICATIONS)).toThrow(/notifications/);
    expect(() => assertNoUnacknowledgedSideEffectReads(NOTIFICATION_COUNTERS)).not.toThrow();
    expect(() =>
      assertNoUnacknowledgedSideEffectReads(`
        query Conversations {
          viewer { participantByEuid(euid: "example-event-2026") { lastMessageV2 { id } } }
        }
      `)
    ).not.toThrow();
  });

  it("allows those fields when the env is set", () => {
    process.env[SIDE_EFFECT_READS_ENV] = "1";
    expect(() => assertNoUnacknowledgedSideEffectReads(CONVERSATION)).not.toThrow();
    expect(() => assertNoUnacknowledgedSideEffectReads(NOTIFICATIONS)).not.toThrow();
  });
});

describe("invalid-token error text", () => {
  it("does not wrap the login command in leftover backticks", () => {
    expect(AUTH_INVALID_MESSAGE).toContain("b2match-mcp login");
    expect(AUTH_INVALID_MESSAGE).not.toMatch(/`/);
  });
});

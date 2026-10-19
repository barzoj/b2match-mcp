import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { B2matchApi, ConversationNotFoundError, RouteNotFoundError } from "./api.js";
import { AuthStore } from "./auth.js";
import { B2matchAuthError, B2matchClient } from "./client.js";
import { SIDE_EFFECT_READS_ENV, conversationMessagesGate, notificationListGate } from "./sideEffects.js";
import { assertNoUnacknowledgedSideEffectReads, assertReadOnlyGraphQL, UnsafeGraphQLOperationError } from "./queryGuard.js";
import { EventInput, PagingInput, authErrorResult, errorResult, notFoundResult, textResult } from "./tooling.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

export function createMcpServer(authStore = new AuthStore()): McpServer {
  const client = new B2matchClient(authStore);
  const api = new B2matchApi(client);
  const server = new McpServer({
    name: "b2match-mcp",
    version: "0.1.0"
  });

  const authTool = <Args extends Record<string, unknown>, T>(
    run: (args: Args) => Promise<T>
  ) => async (args: Args) => {
    try {
      return textResult(await run(args));
    } catch (error) {
      if (error instanceof B2matchAuthError) {
        return authErrorResult(error);
      }
      throw error;
    }
  };

  server.registerTool(
    "auth_status",
    {
      title: "B2match auth status",
      description: "Show whether a local B2match token is available and, when valid, who it belongs to. Never returns the token.",
      annotations: readOnlyAnnotations
    },
    authTool(async () => {
      const local = await authStore.status();
      const viewer = await api.authStatus();
      return { logged_in: true, local, viewer };
    })
  );

  server.registerTool(
    "list_my_events",
    {
      title: "List my B2match events",
      description: "List events visible from the authenticated viewer account.",
      annotations: readOnlyAnnotations
    },
    authTool(async () => api.listMyEvents())
  );

  server.registerTool(
    "get_event",
    {
      title: "Get B2match event",
      description: "Fetch public event metadata, dates, registration window, login methods, and navigation.",
      inputSchema: EventInput.shape,
      annotations: readOnlyAnnotations
    },
    async ({ event }) => textResult((await api.getEvent(event)).raw)
  );

  server.registerTool(
    "my_participation",
    {
      title: "Get my event participation",
      description: "Fetch authenticated participant status, activation, permissions, organisation pages, and opportunities for one event.",
      inputSchema: EventInput.shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event }: { event: string }) => api.myParticipation(event))
  );

  server.registerTool(
    "list_participants",
    {
      title: "List B2match participants",
      description: "List public participants as a compact summary. Set detail=true for the fuller record; use get_participant for one profile.",
      inputSchema: EventInput.merge(PagingInput).extend({
        query: z.string().optional(),
        detail: z.boolean().default(false)
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, first, after, query, detail }) =>
      textResult(await api.listParticipants(event, { first, after, query, detail }))
  );

  server.registerTool(
    "get_participant",
    {
      title: "Get B2match participant",
      description: "Fetch a participant profile without sending B2match's profile-view tracking mutation.",
      inputSchema: EventInput.extend({ participant_id: z.string() }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, participant_id }) => textResult(await api.getParticipant(event, participant_id))
  );

  server.registerTool(
    "list_organisations",
    {
      title: "List B2match organisations",
      description: "List event organisation pages. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional() }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listOrganisations(event, { path, first, after }))
  );

  server.registerTool(
    "get_organisation",
    {
      title: "Get B2match organisation",
      description: "Fetch an organisation/participation page. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({
        participation_id: z.string(),
        path: z.string().optional()
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, participation_id, path }) => textResult(await api.getOrganisation(event, participation_id, path))
  );

  server.registerTool(
    "list_opportunities",
    {
      title: "List B2match opportunities",
      description: "List marketplace opportunities. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional() }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listOpportunities(event, { path, first, after }))
  );

  server.registerTool(
    "get_opportunity",
    {
      title: "Get B2match opportunity",
      description: "Fetch a marketplace opportunity. Resolves the marketplace menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({
        opportunity_id: z.string(),
        path: z.string().optional()
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, opportunity_id, path }) => {
      try {
        return textResult(await api.getOpportunity(event, opportunity_id, path));
      } catch (error) {
        if (error instanceof RouteNotFoundError) {
          return notFoundResult(error.message);
        }
        throw error;
      }
    }
  );

  server.registerTool(
    "get_agenda",
    {
      title: "Get B2match agenda",
      description: "Fetch agenda sessions and networking blocks. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({ path: z.string().optional() }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path }) => textResult(await api.getAgenda(event, path))
  );

  server.registerTool(
    "get_session",
    {
      title: "Get B2match session",
      description:
        "Fetch a session route. Provide session_id, or path to a session URL. Path alone is enough; session_id is not required when path is set.",
      inputSchema: EventInput.extend({
        session_id: z.string().optional(),
        path: z.string().optional(),
        attendees_first: z.number().int().min(1).max(50).default(20),
        attendees_after: z.string().optional()
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, session_id, path, attendees_first, attendees_after }) =>
      textResult(await api.getSession(event, session_id, { path, first: attendees_first, after: attendees_after }))
  );

  server.registerTool(
    "list_session_attendees",
    {
      title: "List B2match session attendees",
      description:
        "List attendees for a session. Returns only the attendees connection, not the full session route. Provide session_id or path.",
      inputSchema: EventInput.extend({
        session_id: z.string().optional(),
        path: z.string().optional(),
        first: z.number().int().min(1).max(50).default(20),
        after: z.string().optional()
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, session_id, path, first, after }) =>
      textResult(await api.listSessionAttendees(event, session_id, { path, first, after }))
  );

  server.registerTool(
    "list_speakers",
    {
      title: "List B2match speakers",
      description: "List event speakers. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional() }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listSpeakers(event, { path, first, after }))
  );

  server.registerTool(
    "my_schedule",
    {
      title: "Get my B2match schedule",
      description: "Fetch the authenticated viewer's event schedule. The PDF agenda URL is omitted unless include_pdf_link is true.",
      inputSchema: EventInput.extend({ include_pdf_link: z.boolean().default(false) }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event, include_pdf_link }: { event: string; include_pdf_link?: boolean }) =>
      api.mySchedule(event, include_pdf_link)
    )
  );

  server.registerTool(
    "my_meetings",
    {
      title: "Get my B2match meetings",
      description:
        "Fetch authenticated meetings, optionally returning one status bucket. Unfiltered responses include a compact availability summary (merged free ranges per day) unless detail=true.",
      inputSchema: EventInput.extend({
        status: z.enum(["accepted", "receivedInvitations", "sentInvitations", "canceled"]).optional(),
        detail: z.boolean().default(false)
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({
      event,
      status,
      detail
    }: {
      event: string;
      status?: "accepted" | "receivedInvitations" | "sentInvitations" | "canceled";
      detail?: boolean;
    }) => api.myMeetings(event, status, detail))
  );

  server.registerTool(
    "my_availability",
    {
      title: "Get my B2match availability",
      description:
        "Fetch authenticated availability. Default is merged free ranges per day; set detail=true for the full timeslot grid.",
      inputSchema: EventInput.extend({
        detail: z.boolean().default(false)
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event, detail }: { event: string; detail?: boolean }) => api.myAvailability(event, detail))
  );

  server.registerTool(
    "find_meeting_slots",
    {
      title: "Find B2match meeting slots",
      description: "Read common free meeting slots for the viewer and selected participants. Does not book anything.",
      inputSchema: EventInput.extend({
        participant_ids: z.array(z.string()).min(1).max(10),
        day: z.string().optional(),
        duration: z.string().optional(),
        is_long_term_networking: z.boolean().default(false)
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({
      event,
      participant_ids,
      day,
      duration,
      is_long_term_networking
    }: {
      event: string;
      participant_ids: string[];
      day?: string;
      duration?: string;
      is_long_term_networking?: boolean;
    }) =>
      api.findMeetingSlots(event, participant_ids, {
        day,
        duration,
        isLongTermNetworking: is_long_term_networking
      })
    )
  );

  server.registerTool(
    "meeting_recommendations",
    {
      title: "Get B2match meeting recommendations",
      description: "Fetch authenticated recommended and newest participants to meet.",
      inputSchema: EventInput.shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event }: { event: string }) => api.meetingRecommendations(event))
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List B2match conversations",
      description:
        "List authenticated conversations and last-message previews. This list does not mark conversations as read.",
      inputSchema: EventInput.merge(PagingInput).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event, first, after }: { event: string; first?: number; after?: string }) =>
      api.listConversations(event, { first, after })
    )
  );

  server.registerTool(
    "get_conversation",
    {
      title: "Get B2match conversation",
      description:
        `Fetch conversation messages. B2match marks that conversation as read when messagesV2 is fetched, even though this client never sends MarkConversationAsSeen. Disabled unless ${SIDE_EFFECT_READS_ENV}=1 and acknowledge_marks_read is true. Use list_conversations for last-message previews. Unknown ids return a not-found error.`,
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        acknowledge_marks_read: z
          .boolean()
          .default(false)
          .describe("Required with B2MATCH_ALLOW_SIDE_EFFECT_READS=1; fetching messages marks the conversation as read.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({
      conversation_id,
      acknowledge_marks_read
    }: {
      conversation_id: string;
      acknowledge_marks_read?: boolean;
    }) => {
      const blocked = conversationMessagesGate(acknowledge_marks_read);
      if (blocked) {
        return errorResult(blocked);
      }
      try {
        return textResult(await api.getConversation(conversation_id));
      } catch (error) {
        if (error instanceof B2matchAuthError) {
          return authErrorResult(error);
        }
        if (error instanceof ConversationNotFoundError) {
          return notFoundResult(error.message);
        }
        throw error;
      }
    }
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List B2match notifications",
      description:
        `Returns unread/unseen notification counters by default. Fetching the notification list resets B2match's unseen counter (unseen goes to 0) even though this client never sends ReadNotification. The unread counter is unchanged. The full list requires ${SIDE_EFFECT_READS_ENV}=1 and acknowledge_marks_seen=true.`,
      inputSchema: EventInput.merge(PagingInput).extend({
        acknowledge_marks_seen: z
          .boolean()
          .default(false)
          .describe("Required with B2MATCH_ALLOW_SIDE_EFFECT_READS=1 to fetch the full list; that request resets unseen.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({
      event,
      first,
      after,
      acknowledge_marks_seen
    }: {
      event: string;
      first?: number;
      after?: string;
      acknowledge_marks_seen?: boolean;
    }) => {
      try {
        if (acknowledge_marks_seen) {
          const blocked = notificationListGate(true);
          if (blocked) {
            return errorResult(blocked);
          }
          return textResult(await api.listNotifications(event, { first, after, list: true }));
        }
        return textResult(await api.listNotifications(event));
      } catch (error) {
        if (error instanceof B2matchAuthError) {
          return authErrorResult(error);
        }
        throw error;
      }
    }
  );

  if (process.env.B2MATCH_ALLOW_RAW === "1") {
    server.registerTool(
      "graphql_read",
      {
        title: "Raw read-only B2match GraphQL",
        description:
          `Run a raw B2match GraphQL query. Disabled unless B2MATCH_ALLOW_RAW=1. Rejects mutations, subscriptions, and queries that select messagesV2 or the notifications list unless ${SIDE_EFFECT_READS_ENV}=1.`,
        inputSchema: z.object({
          query: z.string(),
          variables: z.record(z.string(), z.unknown()).default({}),
          require_auth: z.boolean().default(false)
        }).shape,
        annotations: readOnlyAnnotations
      },
      async ({ query, variables, require_auth }) => {
        try {
          assertReadOnlyGraphQL(query);
          assertNoUnacknowledgedSideEffectReads(query);
          return textResult(await client.query(query, variables, { requireAuth: require_auth, cache: false }));
        } catch (error) {
          if (error instanceof UnsafeGraphQLOperationError) {
            return errorResult(error.message);
          }
          if (error instanceof B2matchAuthError) {
            return authErrorResult(error);
          }
          throw error;
        }
      }
    );
  }

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

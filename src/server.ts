import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { B2matchApi, ConversationNotFoundError, RouteNotFoundError } from "./api.js";
import { AuthStore } from "./auth.js";
import { B2matchAuthError, B2matchClient } from "./client.js";
import { SIDE_EFFECT_READS_ENV, conversationMessagesGate, notificationListGate } from "./sideEffects.js";
import {
  assertNoUnacknowledgedSideEffectReads,
  assertReadOnlyGraphQL,
  UnsafeGraphQLOperationError
} from "./queryGuard.js";
import { packageName, packageVersion } from "./packageVersion.js";
import { EventInput, PagingInput, authErrorResult, errorResult, notFoundResult, textResult } from "./tooling.js";

const PATH_DESC =
  "Optional event menu path (e.g. /components/<id>) from get_event navigation; omit to resolve it automatically.";

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
    name: packageName(),
    version: packageVersion()
  });

  const authTool =
    <Args extends Record<string, unknown>, T>(run: (args: Args) => Promise<T>) =>
    async (args: Args) => {
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
      description:
        "Show whether a local B2match token is available and, when valid, who it belongs to. Never returns the token. Call this first when an authenticated tool (my_*, list_my_events, conversations, notifications) reports a login error; public tools work without a token.",
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
      description:
        "List events the logged-in viewer has joined, with ids/slugs usable as the event argument elsewhere. Requires login; use get_event for any single public event instead.",
      annotations: readOnlyAnnotations
    },
    authTool(async () => api.listMyEvents())
  );

  server.registerTool(
    "get_event",
    {
      title: "Get B2match event",
      description:
        "Fetch public event metadata, dates, registration window, login methods, and navigation menu paths. Start here to resolve an event before calling the other event tools; use list_my_events to find events you joined. Works without login.",
      inputSchema: EventInput.shape,
      annotations: readOnlyAnnotations
    },
    async ({ event }) => textResult((await api.getEvent(event)).raw)
  );

  server.registerTool(
    "my_participation",
    {
      title: "Get my event participation",
      description:
        "Fetch the logged-in viewer's own participant status, activation, permissions, organisation pages, and opportunities for one event. Use get_participant for someone else's public profile.",
      inputSchema: EventInput.shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event }: { event: string }) => api.myParticipation(event))
  );

  server.registerTool(
    "list_participants",
    {
      title: "List B2match participants",
      description:
        "List public participants as a compact summary. Set detail=true for the fuller record; use get_participant for one profile.",
      inputSchema: EventInput.merge(PagingInput).extend({
        query: z.string().optional().describe("Free-text search on participant name, organisation, or profile text."),
        detail: z
          .boolean()
          .default(false)
          .describe("true returns the full participant records instead of compact summaries (larger output).")
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
      description:
        "Fetch one participant's full public profile without sending B2match's profile-view tracking mutation. Use list_participants to search or find ids; use my_participation for your own status.",
      inputSchema: EventInput.extend({
        participant_id: z
          .string()
          .describe("Participant id from list_participants, list_session_attendees, or meeting_recommendations.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, participant_id }) => textResult(await api.getParticipant(event, participant_id))
  );

  server.registerTool(
    "list_organisations",
    {
      title: "List B2match organisations",
      description:
        "List organisation pages (participations) of an event, paginated. Use get_organisation for one page, list_participants for people. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional().describe(PATH_DESC) }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listOrganisations(event, { path, first, after }))
  );

  server.registerTool(
    "get_organisation",
    {
      title: "Get B2match organisation",
      description:
        "Fetch one organisation page (a participation: organisation details plus its representatives). Use list_organisations to find participation ids; use get_participant for a single person. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({
        participation_id: z.string().describe("Participation id from list_organisations or my_participation."),
        path: z.string().optional().describe(PATH_DESC)
      }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, participation_id, path }) => textResult(await api.getOrganisation(event, participation_id, path))
  );

  server.registerTool(
    "list_opportunities",
    {
      title: "List B2match opportunities",
      description:
        "List published marketplace opportunities (offers/requests) of an event, paginated. Use get_opportunity for one entry's full details. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional().describe(PATH_DESC) }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listOpportunities(event, { path, first, after }))
  );

  server.registerTool(
    "get_opportunity",
    {
      title: "Get B2match opportunity",
      description:
        "Fetch a marketplace opportunity. Use the id or url from list_opportunities (published marketplace ids differ from opportunity ids on my_participation). Resolves the marketplace menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({
        opportunity_id: z.string().describe("Published opportunity id or URL from list_opportunities."),
        path: z.string().optional().describe(PATH_DESC)
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
      description:
        "Fetch the event agenda: sessions and networking blocks with times. Use get_session for one session's details and my_schedule for your personal schedule. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.extend({ path: z.string().optional().describe(PATH_DESC) }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path }) => textResult(await api.getAgenda(event, path))
  );

  server.registerTool(
    "get_session",
    {
      title: "Get B2match session",
      description:
        "Fetch one agenda session with its details and a first page of attendees. Provide session_id, or path to a session URL; path alone is enough. Use list_session_attendees to page through attendees only, get_agenda to find sessions.",
      inputSchema: EventInput.extend({
        session_id: z.string().optional().describe("Session id from get_agenda. Optional when path is set."),
        path: z.string().optional().describe("Session URL path from get_agenda; alternative to session_id."),
        attendees_first: z.number().int().min(1).max(50).default(20).describe("Attendee page size, capped at 50."),
        attendees_after: z.string().optional().describe("Attendee pagination cursor from a previous response.")
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
        "Page through the attendees of one agenda session. Returns only the attendee list with a cursor, not the session details; use get_session for those. Provide session_id or path (from get_agenda).",
      inputSchema: EventInput.extend({
        session_id: z.string().optional().describe("Session id from get_agenda. Optional when path is set."),
        path: z.string().optional().describe("Session URL path from get_agenda; alternative to session_id."),
        first: z.number().int().min(1).max(50).default(20).describe("Page size, capped at 50."),
        after: z.string().optional().describe("Opaque pagination cursor from a previous response.")
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
      description:
        "List the speakers shown on the event's speakers page, paginated. Use list_participants for all registered participants. Resolves the menu path automatically; pass path to override.",
      inputSchema: EventInput.merge(PagingInput).extend({ path: z.string().optional().describe(PATH_DESC) }).shape,
      annotations: readOnlyAnnotations
    },
    async ({ event, path, first, after }) => textResult(await api.listSpeakers(event, { path, first, after }))
  );

  server.registerTool(
    "my_schedule",
    {
      title: "Get my B2match schedule",
      description:
        "Fetch the logged-in viewer's personal event schedule (booked sessions and meetings). Use get_agenda for the full public agenda and my_meetings for meeting requests by status. The PDF agenda URL is omitted unless include_pdf_link is true.",
      inputSchema: EventInput.extend({
        include_pdf_link: z.boolean().default(false).describe("true adds the downloadable PDF agenda URL.")
      }).shape,
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
        "Fetch the logged-in viewer's meetings and meeting requests, optionally one status bucket. Unfiltered responses include a compact availability summary (merged free ranges per day) unless detail=true. Use my_schedule for the overall timetable and find_meeting_slots to find free times with others.",
      inputSchema: EventInput.extend({
        status: z
          .enum(["accepted", "receivedInvitations", "sentInvitations", "canceled"])
          .optional()
          .describe("Return only this bucket; omit for all buckets."),
        detail: z
          .boolean()
          .default(false)
          .describe("true returns the full availability timeslot grid instead of the summary.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(
      async ({
        event,
        status,
        detail
      }: {
        event: string;
        status?: "accepted" | "receivedInvitations" | "sentInvitations" | "canceled";
        detail?: boolean;
      }) => api.myMeetings(event, status, detail)
    )
  );

  server.registerTool(
    "my_availability",
    {
      title: "Get my B2match availability",
      description:
        "Fetch the logged-in viewer's own meeting availability. Default is merged free ranges per day; set detail=true for the full timeslot grid. Use find_meeting_slots for slots shared with specific participants.",
      inputSchema: EventInput.extend({
        detail: z.boolean().default(false).describe("true returns the full timeslot grid instead of merged ranges.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(async ({ event, detail }: { event: string; detail?: boolean }) => api.myAvailability(event, detail))
  );

  server.registerTool(
    "find_meeting_slots",
    {
      title: "Find B2match meeting slots",
      description:
        "Find free meeting slots shared by the logged-in viewer and selected participants on one day. Read-only: does not book or request a meeting. Use my_availability for your own free time only.",
      inputSchema: EventInput.extend({
        participant_ids: z
          .array(z.string())
          .min(1)
          .max(10)
          .describe("1-10 participant ids (from list_participants) to meet with."),
        day: z
          .string()
          .optional()
          .describe("Day to search, as a days[].date value from my_availability; omit for the default day."),
        duration: z
          .string()
          .optional()
          .describe(
            "B2match MeetingDuration enum value (e.g. THIRTHY, B2match's spelling); omit for the event default."
          ),
        is_long_term_networking: z
          .boolean()
          .default(false)
          .describe("true searches the event's long-term networking calendar instead of the main meeting days.")
      }).shape,
      annotations: readOnlyAnnotations
    },
    authTool(
      async ({
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
      description:
        "Fetch B2match's recommended and newest participants for the logged-in viewer to meet. Use list_participants to search all participants and find_meeting_slots to check shared free time.",
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
        "List the logged-in viewer's conversations with last-message previews, paginated. Does not mark conversations as read; prefer it over get_conversation unless full message history is needed.",
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
      description: `Fetch conversation messages. B2match marks that conversation as read when messagesV2 is fetched, even though this client never sends MarkConversationAsSeen. Disabled unless ${SIDE_EFFECT_READS_ENV}=1 and acknowledge_marks_read is true. Use list_conversations for last-message previews. Unknown ids return a not-found error.`,
      inputSchema: z.object({
        conversation_id: z.string().uuid().describe("Conversation UUID from list_conversations."),
        acknowledge_marks_read: z
          .boolean()
          .default(false)
          .describe(
            "Required with B2MATCH_ALLOW_SIDE_EFFECT_READS=1; fetching messages marks the conversation as read."
          )
      }).shape,
      annotations: { ...readOnlyAnnotations, readOnlyHint: false, destructiveHint: false, idempotentHint: false }
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
      description: `Returns unread/unseen notification counters by default. Fetching the notification list resets B2match's unseen counter (unseen goes to 0) even though this client never sends ReadNotification. The unread counter is unchanged. The full list requires ${SIDE_EFFECT_READS_ENV}=1 and acknowledge_marks_seen=true.`,
      inputSchema: EventInput.merge(PagingInput).extend({
        acknowledge_marks_seen: z
          .boolean()
          .default(false)
          .describe(
            "Required with B2MATCH_ALLOW_SIDE_EFFECT_READS=1 to fetch the full list; that request resets unseen."
          )
      }).shape,
      annotations: { ...readOnlyAnnotations, readOnlyHint: false, destructiveHint: false, idempotentHint: false }
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
        description: `Run a raw B2match GraphQL query. Disabled unless B2MATCH_ALLOW_RAW=1. Rejects mutations, subscriptions, and queries that select messagesV2 or the notifications list unless ${SIDE_EFFECT_READS_ENV}=1.`,
        inputSchema: z.object({
          query: z.string().describe("GraphQL query document; only query operations are allowed."),
          variables: z.record(z.string(), z.unknown()).default({}).describe("GraphQL variables object."),
          require_auth: z
            .boolean()
            .default(false)
            .describe("true sends the stored token and fails if none is available.")
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

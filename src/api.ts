import { compactAvailability } from "./availability.js";
import { B2matchClient, B2matchGraphQLError } from "./client.js";
import {
  DETAIL_TYPENAMES,
  SECTION_TYPENAMES,
  candidateSectionPaths,
  detailPathCandidates,
  normalizeRoutePath,
  opportunityDetailPaths,
  parseRouteTypenames,
  resolveSectionPath,
  routeTypename,
  sessionAttendees,
  unavailableSection,
  type DetailKind,
  type SectionKind
} from "./directory.js";
import { compactParticipant } from "./participants.js";
import {
  CONVERSATION,
  CONVERSATIONS,
  DIRECTORY_ROUTE,
  FIND_MEETING_SLOTS,
  LIST_PARTICIPANTS,
  MY_EVENTS,
  MY_MEETINGS_AND_AVAILABILITY,
  MY_PARTICIPATION,
  MY_SCHEDULE,
  NOTIFICATION_COUNTERS,
  NOTIFICATIONS,
  PARTICIPANT_DETAIL,
  RECOMMENDATIONS,
  buildRouteTypenamesQuery,
  routeTypenameVariables,
  VIEWER_STATUS
} from "./queries.js";
import { defaultRouteVariables, pageVars } from "./tooling.js";

export class ConversationNotFoundError extends Error {
  constructor(message = "Conversation not found.") {
    super(message);
    this.name = "ConversationNotFoundError";
  }
}

export class RouteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteNotFoundError";
  }
}

export class B2matchApi {
  private readonly routeTypeCache = new Map<string, Map<string, string | undefined>>();

  constructor(private readonly client: B2matchClient) {}

  async authStatus() {
    return this.client.query(VIEWER_STATUS, {}, { requireAuth: true, cache: false });
  }

  async listMyEvents() {
    return this.client.query(MY_EVENTS, {}, { requireAuth: true, cache: true });
  }

  async getEvent(event: string) {
    return this.client.resolveEvent(event);
  }

  async myParticipation(event: string) {
    const resolved = await this.client.resolveEvent(event);
    return this.client.query(MY_PARTICIPATION, { euid: resolved.euid }, { requireAuth: true, cache: true });
  }

  async listParticipants(event: string, options: { first?: number; after?: string; query?: string; detail?: boolean } = {}) {
    const resolved = await this.client.resolveEvent(event);
    const data = await this.client.query<Record<string, unknown>>(
      LIST_PARTICIPANTS,
      { eventId: resolved.id, euid: resolved.euid, query: options.query ?? "", ...pageVars(options.first, options.after) },
      { cache: true }
    );
    const connection = (((data.event as Record<string, unknown> | undefined)?.participants ?? {}) as Record<string, unknown>);
    const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
    return {
      event: { id: resolved.id, euid: resolved.euid, title: resolved.title },
      totalCount: connection.totalCount,
      pageInfo: connection.pageInfo,
      nodes: options.detail ? nodes : nodes.map((node) => compactParticipant(node))
    };
  }

  async getParticipant(event: string, participantId: string) {
    const resolved = await this.client.resolveEvent(event);
    return this.client.query(PARTICIPANT_DETAIL, { euid: resolved.euid, id: participantId }, { cache: true });
  }

  async listOrganisations(event: string, options: { path?: string; first?: number; after?: string } = {}) {
    return this.routeSection(event, "organisations", options);
  }

  async getOrganisation(event: string, participationId: string, path?: string) {
    return this.routeDetail(event, "organisations", participationId, path);
  }

  async listOpportunities(event: string, options: { path?: string; first?: number; after?: string } = {}) {
    return this.routeSection(event, "opportunities", options);
  }

  async getOpportunity(event: string, opportunityId: string, path?: string) {
    const resolved = await this.client.resolveEvent(event);
    const expected = DETAIL_TYPENAMES.opportunities;
    const sectionPaths = path?.trim() ? [] : candidateSectionPaths(resolved.raw, "opportunities");
    const types = sectionPaths.length > 0 ? await this.peekRoutes(resolved.euid, sectionPaths) : new Map<string, string | undefined>();
    const section = sectionPaths.find((candidate) => types.get(candidate) === SECTION_TYPENAMES.opportunities);
    const candidates = opportunityDetailPaths(section, opportunityId, path);
    let last: unknown;
    for (const candidate of candidates) {
      last = await this.route(resolved.euid, candidate);
      if (routeTypename(last) === expected) {
        return last;
      }
      if (path?.trim()) {
        break;
      }
    }
    throw new RouteNotFoundError("Opportunity not found.");
  }

  async getAgenda(event: string, path?: string) {
    return this.routeSection(event, "agenda", { path, first: 50 });
  }

  async getSession(event: string, sessionId?: string, options: { path?: string; first?: number; after?: string } = {}) {
    if (options.path?.trim()) {
      const resolved = await this.client.resolveEvent(event);
      return this.route(resolved.euid, normalizeRoutePath(options.path), options.first, options.after);
    }
    if (!sessionId?.trim()) {
      throw new Error("session_id is required unless path is provided.");
    }
    return this.routeDetail(event, "sessions", sessionId, undefined, options.first, options.after);
  }

  async listSessionAttendees(
    event: string,
    sessionId?: string,
    options: { path?: string; first?: number; after?: string } = {}
  ) {
    return sessionAttendees(await this.getSession(event, sessionId, options));
  }

  async listSpeakers(event: string, options: { path?: string; first?: number; after?: string } = {}) {
    return this.routeSection(event, "speakers", options);
  }

  async mySchedule(event: string, includePdfLink = false) {
    const resolved = await this.client.resolveEvent(event);
    const data = await this.client.query<Record<string, unknown>>(MY_SCHEDULE, { euid: resolved.euid }, { requireAuth: true, cache: false });
    if (!includePdfLink) {
      const participant = (((data.viewer as Record<string, unknown> | undefined)?.participantByEuid ?? {}) as Record<string, unknown>);
      delete participant.pdfAgendaUrl;
    }
    return data;
  }

  async myMeetings(
    event: string,
    status?: "accepted" | "receivedInvitations" | "sentInvitations" | "canceled",
    detail = false
  ) {
    const resolved = await this.client.resolveEvent(event);
    const data = await this.client.query<Record<string, unknown>>(
      MY_MEETINGS_AND_AVAILABILITY,
      { euid: resolved.euid },
      { requireAuth: true, cache: false }
    );
    const viewer = ((data.viewer ?? {}) as Record<string, unknown>);
    const participant = ((viewer.participantByEuid ?? {}) as Record<string, unknown>);
    if (status) {
      return { [status]: (participant.meetings as Record<string, unknown>)?.[status] };
    }
    if (detail) {
      return data;
    }
    return {
      ...data,
      viewer: {
        ...viewer,
        participantByEuid: {
          ...participant,
          availability: compactAvailability(participant.availability)
        }
      }
    };
  }

  async myAvailability(event: string, detail = false) {
    const resolved = await this.client.resolveEvent(event);
    const data = await this.client.query<Record<string, unknown>>(
      MY_MEETINGS_AND_AVAILABILITY,
      { euid: resolved.euid },
      { requireAuth: true, cache: false }
    );
    const participant = (((data.viewer as Record<string, unknown> | undefined)?.participantByEuid ?? {}) as Record<string, unknown>);
    return {
      availability: detail ? participant.availability : compactAvailability(participant.availability),
      isAvailable: participant.isAvailable,
      openNetworkingEnabled: participant.openNetworkingEnabled
    };
  }

  async findMeetingSlots(
    event: string,
    participantIds: string[],
    options: { day?: string; duration?: string; isLongTermNetworking?: boolean } = {}
  ) {
    const resolved = await this.client.resolveEvent(event);
    return this.client.query(
      FIND_MEETING_SLOTS,
      {
        euid: resolved.euid,
        participantIds,
        day: options.day ?? "",
        duration: options.duration ?? null,
        meetingId: null,
        isLtm: options.isLongTermNetworking ?? false
      },
      { requireAuth: true, cache: false }
    );
  }

  async meetingRecommendations(event: string) {
    const resolved = await this.client.resolveEvent(event);
    return this.client.query(RECOMMENDATIONS, { euid: resolved.euid }, { requireAuth: true, cache: false });
  }

  async listConversations(event: string, options: { first?: number; after?: string } = {}) {
    const resolved = await this.client.resolveEvent(event);
    return this.client.query(CONVERSATIONS, { euid: resolved.euid, ...pageVars(options.first, options.after) }, { requireAuth: true, cache: false });
  }

  async getConversation(conversationId: string) {
    try {
      const data = await this.client.query<{ conversation?: unknown }>(
        CONVERSATION,
        { conversationId },
        { requireAuth: true, cache: false }
      );
      if (!data?.conversation) {
        throw new ConversationNotFoundError();
      }
      return data;
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        throw error;
      }
      if (isConversationNotFound(error)) {
        throw new ConversationNotFoundError();
      }
      throw error;
    }
  }

  async listNotifications(event: string, options: { first?: number; after?: string; list?: boolean } = {}) {
    const resolved = await this.client.resolveEvent(event);
    if (!options.list) {
      return this.client.query(NOTIFICATION_COUNTERS, { euid: resolved.euid }, { requireAuth: true, cache: false });
    }
    return this.client.query(
      NOTIFICATIONS,
      { euid: resolved.euid, ...pageVars(options.first, options.after), useClientCache: false },
      { requireAuth: true, cache: false }
    );
  }

  private async routeSection(
    event: string,
    section: SectionKind,
    options: { path?: string; first?: number; after?: string } = {}
  ) {
    const resolved = await this.client.resolveEvent(event);
    const expected = SECTION_TYPENAMES[section];
    if (options.path?.trim()) {
      return this.route(resolved.euid, resolveSectionPath(resolved.raw, section, options.path), options.first, options.after);
    }

    const paths = candidateSectionPaths(resolved.raw, section);
    const types = await this.peekRoutes(resolved.euid, paths);
    const match = paths.find((path) => types.get(path) === expected);
    if (!match) {
      return unavailableSection(section);
    }
    return this.route(resolved.euid, match, options.first, options.after);
  }

  private async routeDetail(
    event: string,
    kind: DetailKind,
    id: string,
    explicitPath?: string,
    first?: number,
    after?: string
  ) {
    const resolved = await this.client.resolveEvent(event);
    const expected = DETAIL_TYPENAMES[kind];
    let last: unknown;
    for (const path of detailPathCandidates(kind, id, explicitPath)) {
      last = await this.route(resolved.euid, path, first, after);
      if (routeTypename(last) === expected) {
        return last;
      }
      if (explicitPath?.trim()) {
        break;
      }
    }
    return last ?? unavailableSection(kind);
  }

  private async peekRoutes(euid: string, paths: string[]): Promise<Map<string, string | undefined>> {
    const cached = this.routeTypeCache.get(euid) ?? new Map<string, string | undefined>();
    const missing = paths.filter((path) => !cached.has(path));
    if (missing.length > 0) {
      const data = await this.client.query(
        buildRouteTypenamesQuery(missing.length),
        routeTypenameVariables(euid, missing),
        { cache: true }
      );
      for (const [path, typename] of parseRouteTypenames(data, missing)) {
        cached.set(path, typename);
      }
      this.routeTypeCache.set(euid, cached);
    }

    return new Map(paths.map((path) => [path, cached.get(path)]));
  }

  private async route(euid: string, path: string, first?: number, after?: string) {
    return this.client.query(DIRECTORY_ROUTE, defaultRouteVariables(euid, path, first, after), { cache: true });
  }
}

function isConversationNotFound(error: unknown): boolean {
  const text = collectErrorText(error);
  return (
    text.includes("not found") ||
    text.includes("couldn't find") ||
    text.includes("could not find") ||
    text.includes("requested element is null") ||
    text.includes("element is null")
  );
}

function collectErrorText(error: unknown): string {
  if (error instanceof B2matchGraphQLError) {
    const extras = Array.isArray(error.errors)
      ? error.errors
          .map((item) => {
            if (item && typeof item === "object" && "message" in item) {
              return String((item as { message?: unknown }).message ?? "");
            }
            return typeof item === "string" ? item : "";
          })
          .join(" ")
      : "";
    return `${error.message} ${extras}`.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
}

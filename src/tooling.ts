import { z } from "zod";
import { B2matchAuthError } from "./client.js";

export const EventInput = z.object({
  event: z.string().describe("B2match event URL, slug/euid, or numeric event id.")
});

export const PagingInput = z.object({
  first: z.number().int().min(1).max(50).default(20).describe("Page size, capped at 50."),
  after: z.string().optional().describe("Opaque pagination cursor from a previous response.")
});

export function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function authErrorResult(error: B2matchAuthError) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: error.message
      }
    ]
  };
}

export function errorResult(message: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: message
      }
    ]
  };
}

export function notFoundResult(message: string) {
  return errorResult(message);
}

export function pageVars(first = 20, after?: string) {
  return {
    first: Math.min(Math.max(first, 1), 50),
    after: after ?? ""
  };
}

export function defaultRouteVariables(euid: string, path: string, first = 20, after?: string) {
  const page = pageVars(first, after);
  return {
    euid,
    path,
    page,
    participantFilters: null,
    participantsGroupedBy: null,
    participationFilters: null,
    opportunityFilters: null,
    agendaFilters: {},
    speakersFirst: page.first,
    speakersAfter: page.after,
    sessionAttendeesFirst: page.first,
    sessionAttendeesAfter: page.after,
    useClientCache: false
  };
}


export type SectionKind = "participants" | "organisations" | "opportunities" | "agenda" | "speakers";
export type DetailKind = "organisations" | "opportunities" | "sessions";

export const SECTION_TYPENAMES: Record<SectionKind, string> = {
  participants: "ParticipantsRoute",
  organisations: "ParticipationsRoute",
  opportunities: "OpportunitiesRoute",
  agenda: "AgendaRoute",
  speakers: "SpeakersRoute"
};

export const DETAIL_TYPENAMES: Record<DetailKind, string> = {
  organisations: "ParticipationProfileRoute",
  opportunities: "OpportunityRoute",
  sessions: "SessionRoute"
};

const SECTION_KEYWORDS: Record<SectionKind, string[]> = {
  participants: ["participant", "attendee", "people"],
  organisations: ["organisation", "organization", "company", "companies", "participation"],
  opportunities: ["opportunit", "marketplace", "offer", "request", "cooperation"],
  agenda: ["agenda", "programme", "program", "session", "schedule"],
  speakers: ["speaker"]
};

const SECTION_FALLBACKS: Record<SectionKind, string[]> = {
  participants: ["/participants"],
  organisations: ["/organisations", "/organizations", "/companies"],
  opportunities: ["/opportunities", "/marketplace"],
  agenda: ["/agenda", "/programme", "/program"],
  speakers: ["/speakers"]
};

const DETAIL_PATH_PREFIXES: Record<DetailKind, string[]> = {
  organisations: ["/participations", "/organisations", "/companies"],
  opportunities: ["/opportunities", "/marketplace"],
  sessions: ["/sessions"]
};

export interface NavigationLink {
  id?: string;
  name?: string;
  url?: string;
  externalUrl?: string;
}

export function flattenNavigation(rawEvent: unknown): NavigationLink[] {
  const event = asRecord(rawEvent);
  const items = asArray(asRecord(asRecord(event.navigation)?.items)?.nodes);
  const links: NavigationLink[] = [];

  for (const item of items) {
    collectNavigation(item, links);
  }

  return links;
}

export function resolveSectionPath(rawEvent: unknown, section: SectionKind, explicitPath?: string): string {
  return candidateSectionPaths(rawEvent, section, explicitPath)[0] ?? SECTION_FALLBACKS[section][0];
}

export function candidateSectionPaths(rawEvent: unknown, section: SectionKind, explicitPath?: string): string[] {
  const paths: string[] = [];
  const add = (value?: string) => {
    if (!value?.trim()) {
      return;
    }
    if (/^https?:/i.test(value) && !/b2match\.(com|io)/i.test(value)) {
      return;
    }
    const normalized = normalizeRoutePath(value);
    if (!normalized || normalized === "/") {
      return;
    }
    if (!paths.includes(normalized)) {
      paths.push(normalized);
    }
  };

  if (explicitPath?.trim()) {
    add(explicitPath);
    return paths;
  }

  const links = flattenNavigation(rawEvent);
  const keywords = SECTION_KEYWORDS[section];
  for (const link of links) {
    const haystack = `${link.name ?? ""} ${link.url ?? ""}`.toLowerCase();
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      add(link.url);
    }
  }
  for (const link of links) {
    if (normalizeRoutePath(link.url ?? "").startsWith("/components/")) {
      add(link.url);
    }
  }
  for (const fallback of SECTION_FALLBACKS[section]) {
    add(fallback);
  }
  return paths;
}

export function resolveDetailPath(kind: DetailKind, id: string, explicitPath?: string): string {
  return detailPathCandidates(kind, id, explicitPath)[0] ?? `/${id}`;
}

export function detailPathCandidates(kind: DetailKind, id: string, explicitPath?: string): string[] {
  if (explicitPath?.trim()) {
    return [normalizeRoutePath(explicitPath)];
  }
  return DETAIL_PATH_PREFIXES[kind].map((prefix) => `${prefix}/${id}`.replace(/\/{2,}/g, "/"));
}

export function opportunityDetailPaths(sectionPath: string | undefined, id: string, explicitPath?: string): string[] {
  if (explicitPath?.trim()) {
    return [normalizeRoutePath(explicitPath)];
  }
  const paths: string[] = [];
  if (sectionPath?.trim()) {
    paths.push(`${normalizeRoutePath(sectionPath).replace(/\/$/, "")}/${id}`);
  }
  for (const path of detailPathCandidates("opportunities", id)) {
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

export function normalizeRoutePath(path: string): string {
  try {
    const url = new URL(path, "https://www.b2match.com");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "e" && parts[1]) {
      return `/${parts.slice(2).join("/")}`;
    }
    return `/${parts.join("/")}`;
  } catch {
    const trimmed = path.trim();
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}

export function routeTypename(payload: unknown): string | undefined {
  const route = asRecord(asRecord(asRecord(payload).eventByEuidV2).routeByPath);
  return typeof route.__typename === "string" ? route.__typename : undefined;
}

export function unavailableSection(section: string) {
  return {
    available: false,
    section,
    message: `This event has no ${section} page in its navigation menu.`
  };
}

export function parseRouteTypenames(data: unknown, paths: string[]): Map<string, string | undefined> {
  const event = asRecord(asRecord(data).eventByEuidV2);
  const types = new Map<string, string | undefined>();
  paths.forEach((path, index) => {
    const typename = asRecord(event[`r${index}`]).__typename;
    types.set(path, typeof typename === "string" ? typename : undefined);
  });
  return types;
}

export function sessionAttendees(payload: unknown) {
  if (asRecord(payload).available === false) {
    return payload;
  }

  const route = asRecord(asRecord(asRecord(payload).eventByEuidV2).routeByPath);
  if (route.__typename === "NotFoundRoute") {
    return payload;
  }

  const session = asRecord(route.session);
  return {
    sessionId: session.sessionId,
    title: session.title,
    attendees: session.attendees ?? { nodes: [], count: 0 }
  };
}

function collectNavigation(node: unknown, links: NavigationLink[]): void {
  const record = asRecord(node);
  if (typeof record.url === "string" || typeof record.name === "string") {
    links.push({
      id: record.id == null ? undefined : String(record.id),
      name: typeof record.name === "string" ? record.name : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
      externalUrl: typeof record.externalUrl === "string" ? record.externalUrl : undefined
    });
  }

  const nested = asArray(asRecord(record.nodes)?.nodes);
  for (const child of nested) {
    collectNavigation(child, links);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

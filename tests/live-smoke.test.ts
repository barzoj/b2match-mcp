import { describe, expect, it } from "vitest";
import { B2matchApi } from "../src/api.js";
import { B2matchClient } from "../src/client.js";
import { flattenNavigation, resolveSectionPath, routeTypename } from "../src/directory.js";

const eventRef = process.env.B2MATCH_SMOKE_EVENT?.trim();
const runSmoke = process.env.B2MATCH_LIVE_SMOKE === "1" && Boolean(eventRef);
const describeSmoke = runSmoke ? describe : describe.skip;

describeSmoke("live public B2match API smoke", () => {
  it("exercises every public tool against the configured event", async () => {
    if (!eventRef) {
      throw new Error("B2MATCH_SMOKE_EVENT is required for the live smoke test.");
    }

    const api = new B2matchApi(new B2matchClient());
    const byRef = await api.getEvent(eventRef);
    expect(byRef.id).toBeTruthy();
    expect(byRef.euid).toBeTruthy();
    expect(flattenNavigation(byRef.raw).length).toBeGreaterThan(0);
    expect((byRef.raw as { hasGoogleLogin?: boolean }).hasGoogleLogin).toBeTypeOf("boolean");

    const byId = await api.getEvent(byRef.id);
    expect(byId.euid).toBe(byRef.euid);
    expect(flattenNavigation(byId.raw).length).toBe(flattenNavigation(byRef.raw).length);
    expect((byId.raw as { hasGoogleLogin?: boolean }).hasGoogleLogin).toBe(
      (byRef.raw as { hasGoogleLogin?: boolean }).hasGoogleLogin
    );

    const participants = await api.listParticipants(eventRef, { first: 3 });
    expect(Array.isArray(participants.nodes)).toBe(true);
    expect(participants.nodes.length).toBeGreaterThan(0);
    const first = participants.nodes[0] as { id: string; name?: string; about?: string };
    expect(first.id).toBeTruthy();
    expect(first.about).toBeUndefined();

    const detailed = await api.getParticipant(eventRef, first.id);
    expect(detailed).toBeTruthy();

    expect(resolveSectionPath(byRef.raw, "agenda")).toMatch(/^\//);

    const organisations = await api.listOrganisations(eventRef, { first: 3 });
    expectDirectoryTool(organisations, "ParticipationsRoute", { allowMissing: true });

    const opportunities = await api.listOpportunities(eventRef, { first: 3 });
    expectDirectoryTool(opportunities, "OpportunitiesRoute", { allowMissing: true });

    const agenda = await api.getAgenda(eventRef);
    expectDirectoryTool(agenda, "AgendaRoute");

    const speakers = await api.listSpeakers(eventRef, { first: 3 });
    expectDirectoryTool(speakers, "SpeakersRoute", { allowMissing: true });

    const sessionId = findFirstSessionId(agenda);
    const session = await api.getSession(eventRef, sessionId ?? "session", { first: 3 });
    expectDirectoryTool(session, "SessionRoute", { allowMissing: !sessionId });
    const attendees = await api.listSessionAttendees(eventRef, sessionId ?? "session", { first: 3 });
    if (sessionId) {
      expect(asRecord(attendees).attendees).toBeTruthy();
      expect(asRecord(attendees).eventByEuidV2).toBeUndefined();
    } else {
      expectDirectoryTool(attendees, "SessionRoute", { allowMissing: true });
    }

    const organisationId = findFirstOrganisationId(organisations) ?? findFirstOrganisationId(opportunities);
    const organisation = await api.getOrganisation(eventRef, organisationId ?? "1");
    expectDirectoryTool(organisation, "ParticipationProfileRoute", { allowMissing: !organisationId });

    const opportunityId = findFirstOpportunityId(opportunities);
    const opportunity = await api.getOpportunity(eventRef, opportunityId ?? "1");
    expectDirectoryTool(opportunity, "OpportunityRoute", { allowMissing: !opportunityId });
  });
});

function expectDirectoryTool(payload: unknown, expectedType: string, options: { allowMissing?: boolean } = {}) {
  if (asRecord(payload).available === false) {
    expect(options.allowMissing, `expected ${expectedType} but the section is unavailable`).toBe(true);
    return;
  }
  const typename = routeTypename(payload);
  if (options.allowMissing && typename === "NotFoundRoute") {
    return;
  }
  expect(typename).toBe(expectedType);
}

function findFirstSessionId(payload: unknown): string | undefined {
  const text = JSON.stringify(payload);
  const match = text.match(/"sessionId":"([^"]+)"/);
  return match?.[1];
}

function findFirstOrganisationId(payload: unknown): string | undefined {
  const text = JSON.stringify(payload);
  const participation = text.match(/"participation":\{"id":(\d+)/) ?? text.match(/"participation":\{"id":"([^"]+)"/);
  if (participation?.[1]) {
    return participation[1];
  }
  const route = asRecord(asRecord(asRecord(payload).eventByEuidV2).routeByPath);
  const nodes = asArray(asRecord(route.participationsV2).nodes);
  return asRecord(nodes[0]).id == null ? undefined : String(asRecord(nodes[0]).id);
}

function findFirstOpportunityId(payload: unknown): string | undefined {
  const route = asRecord(asRecord(asRecord(payload).eventByEuidV2).routeByPath);
  const nodes = asArray(asRecord(route.opportunitiesV2).nodes);
  const first = asRecord(nodes[0]);
  return typeof first.opportunityId === "string" ? first.opportunityId : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

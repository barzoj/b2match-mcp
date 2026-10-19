import crypto from "node:crypto";
import { AuthStore, isExpired } from "./auth.js";
import { parseEventIdentifier } from "./eventIdentifier.js";
import { loginUsage } from "./invocation.js";
import { EVENT_BY_EUID, EVENT_ID_LOOKUP } from "./queries.js";
import { assertNoUnacknowledgedSideEffectReads, assertReadOnlyGraphQL } from "./queryGuard.js";
import { userAgent } from "./packageVersion.js";

const API_URL = "https://api.b2match.com/v4/query";
const CACHE_TTL_MS = 60_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const NETWORK_RETRY_BACKOFF_MS = [250, 750];

export const AUTH_MISSING_MESSAGE = `You are not logged in. Run ${loginUsage()} or set B2MATCH_TOKEN.`;
export const AUTH_INVALID_MESSAGE = `B2match authentication is invalid or expired. Run ${loginUsage()} again.`;

export class B2matchAuthError extends Error {
  constructor(
    public readonly reason: "missing" | "invalid",
    message = reason === "missing" ? AUTH_MISSING_MESSAGE : AUTH_INVALID_MESSAGE
  ) {
    super(message);
    this.name = "B2matchAuthError";
  }
}

export class B2matchGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors?: unknown
  ) {
    super(message);
    this.name = "B2matchGraphQLError";
  }
}

interface CacheEntry {
  expiresAt: number;
  data: unknown;
}

export interface GraphQLRequestOptions {
  requireAuth?: boolean;
  cache?: boolean;
  token?: string;
}

export interface ResolvedEvent {
  id: string;
  euid: string;
  title?: string;
  websiteUrl?: string;
  raw: unknown;
}

export interface B2matchClientOptions {
  fetchImpl?: typeof fetch;
}

export class B2matchClient {
  private readonly cache = new Map<string, CacheEntry>();
  private nextRequestAt = 0;
  private invalidToken = false;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly authStore = new AuthStore(),
    options: B2matchClientOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: GraphQLRequestOptions = {}
  ): Promise<T> {
    assertReadOnlyGraphQL(query);
    assertNoUnacknowledgedSideEffectReads(query);

    const overrideToken = options.token?.trim();
    const auth = overrideToken ? null : await this.authStore.read();
    const storedToken = auth?.record.token;
    const storedExpired = isExpired(auth?.record.expiresAt);
    const usableStoredToken = Boolean(storedToken && !storedExpired && !this.invalidToken);

    if (options.requireAuth && !overrideToken && !usableStoredToken) {
      throw new B2matchAuthError(storedToken ? "invalid" : "missing");
    }

    const token = overrideToken || (usableStoredToken ? storedToken : undefined);
    const cacheKey = options.cache === false ? undefined : this.cacheKey(query, variables, Boolean(token));
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data as T;
      }
    }

    try {
      const data = await this.send<T>(query, variables, token);
      if (cacheKey) {
        this.cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return data;
    } catch (error) {
      if (error instanceof B2matchAuthError && token) {
        this.invalidToken = true;
        if (options.requireAuth) {
          throw new B2matchAuthError("invalid");
        }
        return this.send<T>(query, variables, undefined);
      }

      throw error;
    }
  }

  async resolveEvent(event: string | number): Promise<ResolvedEvent> {
    const parsed = parseEventIdentifier(event);
    const euid = parsed.kind === "euid" ? parsed.euid : await this.lookupEuid(parsed.id);
    return this.fetchEventByEuid(euid);
  }

  private async lookupEuid(id: string): Promise<string> {
    const data = await this.query<{ event: { id?: string; euid?: string } | null }>(
      EVENT_ID_LOOKUP,
      { id },
      { cache: true }
    );
    if (!data.event?.euid) {
      throw new Error(`B2match event id ${id} was not found.`);
    }
    return String(data.event.euid);
  }

  private async fetchEventByEuid(euid: string): Promise<ResolvedEvent> {
    const data = await this.query<{ eventByEuidV2: ResolvedEvent & { __typename?: string; message?: string } }>(
      EVENT_BY_EUID,
      { euid },
      { cache: true }
    );

    const eventNode = data.eventByEuidV2;
    if (!eventNode || eventNode.__typename !== "Event") {
      const reason = eventNode?.message ?? eventNode?.__typename ?? "unknown reason";
      throw new Error(`B2match event "${euid}" was not found (${reason}).`);
    }

    return normalizeEvent(eventNode);
  }

  private async send<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<T> {
    await this.throttle();

    const response = await this.fetchWithRetry(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": userAgent(),
        "X-App": "event-next-client",
        "X-b2match-Language": "en",
        "X-Event-Route-Prefix": "/e",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ query, variables })
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (response.status === 401) {
      throw new B2matchAuthError(token ? "invalid" : "missing");
    }

    if (!response.ok) {
      throw new Error(`B2match API returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    if (!contentType.includes("application/json")) {
      throw new Error(`B2match API returned non-JSON response: ${text.slice(0, 500)}`);
    }

    const payload = JSON.parse(text) as { data?: T; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      const message = payload.errors.map((item) => item.message ?? "GraphQL error").join("; ");
      throw new B2matchGraphQLError(message, payload.errors);
    }

    return payload.data as T;
  }

  // B2match's edge occasionally drops idle keep-alive connections ("fetch failed").
  // Every request we send is a read-only query, so retries are safe.
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= NETWORK_RETRY_BACKOFF_MS.length; attempt += 1) {
      try {
        return await this.fetchImpl(url, init);
      } catch (error) {
        lastError = error;
        if (!(error instanceof TypeError) || attempt === NETWORK_RETRY_BACKOFF_MS.length) {
          throw error;
        }
        await delay(NETWORK_RETRY_BACKOFF_MS[attempt]);
      }
    }
    throw lastError;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + MIN_REQUEST_INTERVAL_MS;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  private cacheKey(query: string, variables: Record<string, unknown>, authenticated: boolean): string {
    return crypto.createHash("sha256").update(JSON.stringify({ query, variables, authenticated })).digest("hex");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEvent(node: ResolvedEvent): ResolvedEvent {
  if (!node.id || !node.euid) {
    throw new Error("B2match event response did not include both id and euid.");
  }

  return {
    id: String(node.id),
    euid: String(node.euid),
    title: node.title,
    websiteUrl: node.websiteUrl,
    raw: node
  };
}

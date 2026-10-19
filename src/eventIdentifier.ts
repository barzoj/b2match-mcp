export type EventIdentifier = { kind: "id"; id: string } | { kind: "euid"; euid: string };

const EUID_RE = /^[a-z0-9][a-z0-9-]{1,180}$/i;

export function parseEventIdentifier(input: string | number): EventIdentifier {
  const raw = String(input).trim();
  if (!raw) {
    throw new Error("Event identifier is required.");
  }

  if (/^\d+$/.test(raw)) {
    return { kind: "id", id: raw };
  }

  const fromUrl = parseEventUrl(raw);
  if (fromUrl) {
    return fromUrl;
  }

  if (EUID_RE.test(raw)) {
    return { kind: "euid", euid: raw.toLowerCase() };
  }

  throw new Error("Event must be a numeric id, a b2match event slug, or a b2match event URL.");
}

function parseEventUrl(raw: string): EventIdentifier | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);

  if ((host === "www.b2match.com" || host === "b2match.com") && pathParts[0] === "e" && pathParts[1]) {
    return { kind: "euid", euid: pathParts[1].toLowerCase() };
  }

  if (host.endsWith(".b2match.io")) {
    const [subdomain] = host.split(".");
    if (subdomain && EUID_RE.test(subdomain)) {
      return { kind: "euid", euid: subdomain.toLowerCase() };
    }
  }

  return null;
}

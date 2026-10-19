export interface CompactParticipant {
  id: string;
  name: string;
  job?: string;
  org?: string;
  country?: string;
  profileUrl?: string;
}

export function compactParticipant(node: unknown): CompactParticipant {
  const record = asRecord(node);
  const user = asRecord(record.user);
  const location = asRecord(record.location);
  const country = asRecord(location.country);
  const participation = asRecord(record.participation);
  const organisation = asRecord(participation.organisation);

  const firstName = stringValue(user.firstName);
  const lastName = stringValue(user.lastName);
  const name =
    [firstName, lastName].filter(Boolean).join(" ") || stringValue(record.organisationName) || stringValue(record.id);

  return {
    id: stringValue(record.id),
    name,
    job: stringValue(user.jobPosition) || undefined,
    org:
      stringValue(organisation.fullName) ||
      stringValue(organisation.name) ||
      stringValue(record.organisationName) ||
      undefined,
    country: stringValue(country.name) || stringValue(country.iso) || undefined,
    profileUrl: stringValue(record.profileUrl) || undefined
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

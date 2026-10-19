export interface CompactFreeRange {
  begin: string;
  end: string;
}

export interface CompactDayAvailability {
  date: string;
  free: CompactFreeRange[];
  bookedCount: number;
}

export interface CompactAvailability {
  viewerShouldSeeAvailabilityButton?: unknown;
  viewerAvailabilityChangesPaused?: unknown;
  viewerAvailabilityLocked?: unknown;
  days: CompactDayAvailability[];
}

export function compactAvailability(availability: unknown): CompactAvailability {
  const root = asRecord(availability);
  return {
    viewerShouldSeeAvailabilityButton: root.viewerShouldSeeAvailabilityButton,
    viewerAvailabilityChangesPaused: root.viewerAvailabilityChangesPaused,
    viewerAvailabilityLocked: root.viewerAvailabilityLocked,
    days: nodesOf(root.days).map(compactDay)
  };
}

function compactDay(day: unknown): CompactDayAvailability {
  const record = asRecord(day);
  const slots: Array<Record<string, unknown>> = [];
  for (const block of nodesOf(record.blocks)) {
    for (const slot of nodesOf(asRecord(block).timeslots)) {
      slots.push(asRecord(slot));
    }
  }
  slots.sort((left, right) => stringValue(left.begin).localeCompare(stringValue(right.begin)));

  return {
    date: stringValue(record.date),
    free: mergeFreeRanges(slots),
    bookedCount: slots.filter((slot) => Boolean(slotMeetingId(slot))).length
  };
}

function mergeFreeRanges(slots: Array<Record<string, unknown>>): CompactFreeRange[] {
  const ranges: CompactFreeRange[] = [];
  for (const slot of slots) {
    if (!isFreeSlot(slot)) {
      continue;
    }
    const begin = stringValue(slot.begin);
    const end = stringValue(slot.end);
    const last = ranges[ranges.length - 1];
    if (last && begin <= last.end) {
      if (end > last.end) {
        last.end = end;
      }
      continue;
    }
    ranges.push({ begin, end });
  }
  return ranges;
}

function isFreeSlot(slot: Record<string, unknown>): boolean {
  return !slotMeetingId(slot) && slot.viewerIsRegistered !== false;
}

function slotMeetingId(slot: Record<string, unknown>): string | undefined {
  const meeting = asRecord(slot.meeting);
  return meeting.id == null || meeting.id === "" ? undefined : String(meeting.id);
}

function nodesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray((value as { nodes?: unknown }).nodes)) {
    return (value as { nodes: unknown[] }).nodes;
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

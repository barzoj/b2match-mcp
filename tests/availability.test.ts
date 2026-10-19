import { describe, expect, it } from "vitest";
import { compactAvailability } from "../src/availability.js";

describe("compactAvailability", () => {
  it("merges consecutive free timeslots per day and counts booked slots", () => {
    const compact = compactAvailability({
      viewerShouldSeeAvailabilityButton: true,
      viewerAvailabilityLocked: false,
      days: {
        nodes: [
          {
            date: "2026-03-10",
            blocks: {
              nodes: [
                {
                  timeslots: {
                    nodes: [
                      { begin: "09:00", end: "09:15", viewerIsRegistered: true, meeting: null },
                      { begin: "09:15", end: "09:30", viewerIsRegistered: true, meeting: { id: null } },
                      { begin: "09:30", end: "09:45", viewerIsRegistered: true, meeting: { id: "12345" } },
                      { begin: "09:45", end: "10:00", viewerIsRegistered: true },
                      { begin: "10:00", end: "10:15", viewerIsRegistered: false },
                      { begin: "11:00", end: "11:15", viewerIsRegistered: true }
                    ]
                  }
                }
              ]
            }
          }
        ]
      }
    });

    expect(compact).toEqual({
      viewerShouldSeeAvailabilityButton: true,
      viewerAvailabilityChangesPaused: undefined,
      viewerAvailabilityLocked: false,
      days: [
        {
          date: "2026-03-10",
          free: [
            { begin: "09:00", end: "09:30" },
            { begin: "09:45", end: "10:00" },
            { begin: "11:00", end: "11:15" }
          ],
          bookedCount: 1
        }
      ]
    });
  });

  it("returns an empty day list when availability is missing", () => {
    expect(compactAvailability(null).days).toEqual([]);
  });
});

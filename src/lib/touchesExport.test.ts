import { describe, expect, it } from "vitest";
import { buildTouchesCsv, buildTouchesCsvRows, TOUCH_EXPORT_HEADERS } from "./touchesExport";
import type { Touch } from "@/types";

function touch(p: Partial<Touch> & { id: string }): Touch {
  return {
    orgId: "org1",
    caseId: "case1",
    touchDate: "2026-07-10",
    entryType: "touchpoint",
    touchType: "call",
    outcome: "successful",
    nextFollowUpDate: null,
    notes: null,
    coordinatorId: "u1",
    taskId: null,
    communicationEventId: null,
    source: "manual",
    createdAt: "2026-07-10T12:00:00Z",
    clearsFollowUp: false,
    recipientName: null,
    recipientContact: null,
    correctsTouchId: null,
    ...p,
  };
}

describe("touchesExport (Compliance CSV)", () => {
  it("carries type / outcome / recipient / source / dates / actor", () => {
    const rows = buildTouchesCsvRows(
      [
        touch({
          id: "t1",
          touchType: "provider_outreach",
          outcome: "attempted",
          recipientName: "Dr. Casey Lin",
          recipientContact: "casey@example.test",
          nextFollowUpDate: "2026-07-20",
        }),
      ],
      (id) => (id === "u1" ? "Sowmya Seed" : "—"),
    );
    expect(rows[0]).toEqual([...TOUCH_EXPORT_HEADERS]);
    const [date, loggedAt, entryType, type, outcome, rName, rContact, source, actor] = rows[1];
    expect(date).toBe("2026-07-10");
    expect(loggedAt).toBe("2026-07-10T12:00:00Z");
    expect(entryType).toBe("touchpoint");
    expect(type).toBe("Provider Outreach");
    expect(outcome).toBe("Attempted");
    expect(rName).toBe("Dr. Casey Lin");
    expect(rContact).toBe("casey@example.test");
    expect(source).toBe("manual");
    expect(actor).toBe("Sowmya Seed");
  });

  it("renders historical rows (legacy outcome, mail type) unchanged", () => {
    const rows = buildTouchesCsvRows(
      [touch({ id: "t2", touchType: "mail", outcome: "left_voicemail" })],
      () => "Actor",
    );
    expect(rows[1][3]).toBe("Mail");
    expect(rows[1][4]).toBe("Left voicemail");
  });

  it("quotes notes containing commas/newlines via the shared CSV serializer", () => {
    const csv = buildTouchesCsv(
      [touch({ id: "t3", notes: "Called, left message\nwill retry" })],
      () => "Actor",
    );
    expect(csv).toContain('"Called, left message\nwill retry"');
  });
});

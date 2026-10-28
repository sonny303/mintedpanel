import { describe, expect, it } from "vitest";
import {
  INTAKE_MAX_BYTES,
  canContinue,
  canResend,
  deriveStage,
  deriveWaitingOn,
  documentSlots,
  needsPractice,
  sectionProgress,
  validateUpload,
  verificationSummary,
} from "./providerOnboarding";
import { HIRES, VERIFICATION_CHECKS, initialDraft } from "@/services/providerOnboardingFixtures";
import type {
  FieldValue,
  IntakeDraft,
  OnboardingEvent,
  OnboardingEventType,
  VerificationCheck,
} from "@/types/providerOnboarding";

function ev(type: OnboardingEventType, at: string): OnboardingEvent {
  return { type, at: `2026-10-${at}` };
}

const YOU = { label: "You entered this", asOf: "2026-10-20" };
function given(value: string): FieldValue<string> {
  return { value, source: YOU };
}
const EMPTY: FieldValue<string> = { value: null, source: null };

function completeDraft(): IntakeDraft {
  return {
    identity: {
      firstName: given("Anita"),
      lastName: given("Rao"),
      npi: given("1234567893"),
      taxonomyCode: given("225100000X"),
      dateOfBirth: given("1990-04-02"),
      caqhId: given("12345678"),
      ssnOnFile: true,
    },
    contact: {
      email: "anita.rao@example.test",
      mobile: given("(704) 555-0100"),
      homeAddress: given("1 Main St, Charlotte, NC 28202"),
    },
    licenses: [{ state: given("NC"), number: given("PT1234"), expiresOn: given("2027-06-30") }],
    logins: { caqhOnFile: true, pecosOnFile: true },
  };
}

describe("deriveStage", () => {
  it("is the highest-ranked milestone present, whatever the timestamps", () => {
    expect(deriveStage([ev("invited", "13T09:00:00Z")])).toBe("invited");
    expect(deriveStage([ev("submitted", "10T09:00:00Z"), ev("signed_in", "15T09:00:00Z")])).toBe(
      "submitted",
    );
    expect(
      deriveStage([ev("invited", "13T09:00:00Z"), ev("first_case_created", "01T00:00:00Z")]),
    ).toBe("in_credentialing");
  });

  it("treats admitted without submitted as ready", () => {
    expect(deriveStage([ev("invited", "13T09:00:00Z"), ev("admitted", "14T09:00:00Z")])).toBe(
      "ready",
    );
  });

  it("does not move on a resend, reminder, save or help event", () => {
    const events = [
      ev("invited", "13T09:00:00Z"),
      ev("invitation_resent", "14T09:00:00Z"),
      ev("reminder_sent", "15T09:00:00Z"),
      ev("help_requested", "15T10:00:00Z"),
    ];
    expect(deriveStage(events)).toBe("invited");
  });
});

describe("deriveWaitingOn and needsPractice", () => {
  const started = [ev("invited", "13T09:00:00Z"), ev("signed_in", "14T09:00:00Z")];

  it("waits on the provider before submit and on Minted after", () => {
    expect(deriveWaitingOn(started)).toBe("provider");
    expect(deriveWaitingOn([...started, ev("submitted", "15T09:00:00Z")])).toBe("minted");
    expect(deriveWaitingOn([...started, ev("admitted", "16T09:00:00Z")])).toBe("minted");
  });

  it("waits on the practice while a help request is open, until it is contacted", () => {
    const help = [...started, ev("help_requested", "15T09:00:00Z")];
    expect(deriveWaitingOn(help)).toBe("practice");
    expect(needsPractice(help)).toBe(true);

    const contacted = [...help, ev("practice_contacted", "15T12:00:00Z")];
    expect(deriveWaitingOn(contacted)).toBe("provider");
    expect(needsPractice(contacted)).toBe(false);

    const again = [...contacted, ev("help_requested", "16T09:00:00Z")];
    expect(needsPractice(again)).toBe(true);
  });

  it("treats 'I was told I don't need to do this' as a help request", () => {
    expect(needsPractice([...started, ev("told_not_needed", "15T09:00:00Z")])).toBe(true);
  });

  it("does not ask the practice once she has submitted", () => {
    const events = [
      ...started,
      ev("help_requested", "15T09:00:00Z"),
      ev("submitted", "16T09:00:00Z"),
    ];
    expect(needsPractice(events)).toBe(false);
    expect(deriveWaitingOn(events)).toBe("minted");
  });
});

describe("canResend", () => {
  const invitedAt = ev("invited", "13T09:00:00Z");

  it("allows a resend before submit, once 10 minutes have passed since the last send", () => {
    expect(canResend([invitedAt], new Date("2026-10-13T09:09:59Z"))).toBe(false);
    expect(canResend([invitedAt], new Date("2026-10-13T09:10:00Z"))).toBe(true);
    const resent = [invitedAt, ev("invitation_resent", "14T09:00:00Z")];
    expect(canResend(resent, new Date("2026-10-14T09:05:00Z"))).toBe(false);
  });

  it("never offers a resend from submitted onward", () => {
    const events = [invitedAt, ev("signed_in", "13T10:00:00Z"), ev("submitted", "14T09:00:00Z")];
    expect(canResend(events, new Date("2026-10-20T00:00:00Z"))).toBe(false);
  });
});

describe("sectionProgress and canContinue", () => {
  it("counts only fields with a source, so a default or a bare prefill does not count", () => {
    const draft = completeDraft();
    draft.identity.taxonomyCode = { value: "225100000X", source: null };
    draft.identity.dateOfBirth = EMPTY;
    draft.licenses[0].state = { value: "NC", source: null };
    const progress = sectionProgress(draft);
    expect(progress.identity).toEqual({ done: 5, total: 7 });
    expect(progress.licenses).toEqual({ done: 0, total: 1 });
    expect(canContinue(draft)).toBe(false);
  });

  it("counts the verified email in Contact", () => {
    const draft = completeDraft();
    draft.contact.mobile = EMPTY;
    draft.contact.homeAddress = EMPTY;
    expect(sectionProgress(draft).contact).toEqual({ done: 1, total: 3 });
  });

  it("needs every required field, at least one license and both logins", () => {
    expect(canContinue(completeDraft())).toBe(true);

    const noLicense = completeDraft();
    noLicense.licenses = [];
    expect(canContinue(noLicense)).toBe(false);
    expect(sectionProgress(noLicense).licenses).toEqual({ done: 0, total: 1 });

    const noPecos = completeDraft();
    noPecos.logins.pecosOnFile = false;
    expect(canContinue(noPecos)).toBe(false);

    const noSsn = completeDraft();
    noSsn.identity.ssnOnFile = false;
    expect(canContinue(noSsn)).toBe(false);
  });
});

describe("documentSlots", () => {
  const cv = { name: "cv.pdf", sizeBytes: 1000, expiresOn: null };

  it("requires a CV and one license copy per distinct, non-blank license state", () => {
    const draft = completeDraft();
    draft.licenses.push(
      { state: given("SC"), number: given("2"), expiresOn: given("2027-01-31") },
      { state: given("NC"), number: given("3"), expiresOn: given("2027-01-31") },
      { state: EMPTY, number: EMPTY, expiresOn: EMPTY },
    );
    const required = documentSlots(draft, {}).filter((s) => s.required);
    expect(required.map((s) => s.key)).toEqual(["cv", "license:NC", "license:SC"]);
  });

  it("drops an upload when its license is removed", () => {
    const draft = completeDraft();
    const files = { cv, "license:NC": { ...cv, name: "nc.pdf" } };
    expect(documentSlots(draft, files).find((s) => s.key === "license:NC")?.file?.name).toBe(
      "nc.pdf",
    );
    draft.licenses = [];
    expect(documentSlots(draft, files).some((s) => s.key === "license:NC")).toBe(false);
    expect(documentSlots(draft, files).find((s) => s.key === "cv")?.file).toEqual(cv);
  });

  it("asks for an expiration date only on the liability policy", () => {
    const slots = documentSlots(completeDraft(), {});
    expect(slots.filter((s) => s.needsExpiration).map((s) => s.kind)).toEqual(["coi"]);
    expect(slots.filter((s) => !s.required).map((s) => s.kind)).toEqual([
      "diploma",
      "board_cert",
      "coi",
      "other",
    ]);
  });
});

describe("validateUpload", () => {
  it("accepts PDF, JPG and PNG up to 10 MB", () => {
    expect(validateUpload({ name: "a.pdf", type: "application/pdf", size: INTAKE_MAX_BYTES })).toBe(
      null,
    );
    expect(validateUpload({ name: "a.jpg", type: "image/jpeg", size: 10 })).toBe(null);
    expect(validateUpload({ name: "a.png", type: "image/png", size: 10 })).toBe(null);
  });

  it("rejects other types and anything over 10 MB", () => {
    expect(validateUpload({ name: "a.docx", type: "application/msword", size: 10 })).toMatch(
      /PDF, JPG or PNG/,
    );
    expect(
      validateUpload({ name: "a.pdf", type: "application/pdf", size: INTAKE_MAX_BYTES + 1 }),
    ).toMatch(/10 MB/);
  });
});

describe("verificationSummary", () => {
  it("counts confirmed and pending checks", () => {
    const check = (key: string, status: VerificationCheck["status"]): VerificationCheck => ({
      key,
      label: key,
      status,
      method: status === "confirmed" ? "auto" : "person",
      confirmedBy: null,
      action: null,
    });
    expect(
      verificationSummary([
        check("a", "confirmed"),
        check("b", "confirmed"),
        check("c", "pending"),
      ]),
    ).toEqual({ confirmed: 2, pending: 1, total: 3 });
  });
});

describe("preview fixtures", () => {
  it("derive the canvas screen 0 headline: 1 waiting on you · 2 with the clinician · 2 with Minted", () => {
    const waiting = HIRES.map((h) => [
      h.displayName,
      deriveStage(h.events),
      deriveWaitingOn(h.events),
    ]);
    expect(waiting).toEqual([
      ["Jisoo Kim, PT", "started", "practice"],
      ["Anita Rao, PT", "invited", "provider"],
      ["Marcus Bell, DPT", "started", "provider"],
      ["Lena Ortiz, PTA", "submitted", "minted"],
      ["Owen Park, PT", "ready", "minted"],
    ]);
  });

  it("start Anita's form with only the roster fields counted (board 5a: Identity 2 of 7)", () => {
    const progress = sectionProgress(initialDraft("anita.rao@example.test"));
    expect(progress.identity).toEqual({ done: 2, total: 7 });
    expect(progress.licenses).toEqual({ done: 0, total: 1 });
    expect(verificationSummary(VERIFICATION_CHECKS)).toEqual({
      confirmed: 10,
      pending: 3,
      total: 13,
    });
  });
});

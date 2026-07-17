// E4.5 TE-12 — pure document-store logic: current-version derivation (no
// forks), required expirations, every 30/60/90-day boundary, SOP requirement
// matching, MIME/size/path validation, and the orphan-sweep halves.
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KIND_META,
  DOCUMENT_MAX_BYTES,
  UPLOAD_INTENT_TTL_MS,
  caseDocumentStatus,
  checkDocumentFile,
  classifyExpiration,
  currentGroupReadinessDocuments,
  currentVersions,
  documentFamilyPrefix,
  documentObjectPath,
  expirationDateError,
  expiringCredentialRows,
  familyHistory,
  isOrphanExpired,
  nextVersionNumber,
  orphanVersionFolders,
  parseDocumentKind,
  requiredDocumentKinds,
  safeFileName,
  uploadableKinds,
} from "./documents";
import type { SOPStep } from "@/types";

const TODAY = "2026-07-17";

interface Row {
  id: string;
  documentFamilyId: string;
  versionNumber: number;
  supersedesDocumentId: string | null;
  docType: string;
  expirationDate: string | null;
  groupId: string | null;
}

function row(partial: Partial<Row> & { id: string }): Row {
  return {
    documentFamilyId: "fam-1",
    versionNumber: 1,
    supersedesDocumentId: null,
    docType: "state_license",
    expirationDate: null,
    groupId: null,
    ...partial,
  };
}

describe("kind metadata (TE-5)", () => {
  it("requires expiration for state_license, dea, and coi only", () => {
    const required = Object.values(DOCUMENT_KIND_META)
      .filter((m) => m.expirationRequired)
      .map((m) => m.kind)
      .sort();
    expect(required).toEqual(["coi", "dea", "state_license"]);
  });

  it("keeps the reviewer-default thresholds: 90 license / 60 DEA / 30 elsewhere", () => {
    expect(DOCUMENT_KIND_META.state_license.expiringSoonDays).toBe(90);
    expect(DOCUMENT_KIND_META.dea.expiringSoonDays).toBe(60);
    expect(DOCUMENT_KIND_META.coi.expiringSoonDays).toBe(30);
    expect(DOCUMENT_KIND_META.board_cert.expiringSoonDays).toBe(30);
  });

  it("offers provider kinds and group kinds per the D1 grains, never filled_form", () => {
    const provider = uploadableKinds("provider").map((m) => m.kind);
    const group = uploadableKinds("group").map((m) => m.kind);
    expect(provider).toContain("state_license");
    expect(provider).toContain("dea");
    expect(provider).toContain("cv");
    expect(provider).not.toContain("w9");
    expect(group).toContain("w9");
    expect(group).toContain("cms_460");
    expect(group).toContain("voided_check");
    expect(group).toContain("coi");
    expect(group).not.toContain("state_license");
    expect(provider).not.toContain("filled_form");
    expect(group).not.toContain("filled_form");
  });

  it("expirationDateError blocks a dated kind without a date and passes others", () => {
    expect(expirationDateError("state_license", null)).toMatch(/expiration date/);
    expect(expirationDateError("state_license", "2027-01-01")).toBeNull();
    expect(expirationDateError("w9", null)).toBeNull();
  });
});

describe("file + path validation (TE-4/TE-2)", () => {
  it("accepts only the centralized MIME types and size ceiling", () => {
    expect(checkDocumentFile({ name: "a.pdf", size: 100, type: "application/pdf" })).toBeNull();
    expect(checkDocumentFile({ name: "a.png", size: 100, type: "image/png" })).toBeNull();
    expect(
      checkDocumentFile({ name: "a.exe", size: 100, type: "application/x-msdownload" }),
    ).toMatch(/PDF, PNG, or JPEG/);
    expect(checkDocumentFile({ name: "a.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
    expect(
      checkDocumentFile({ name: "a.pdf", size: DOCUMENT_MAX_BYTES + 1, type: "application/pdf" }),
    ).toMatch(/limited/);
    expect(
      checkDocumentFile({ name: "a.pdf", size: DOCUMENT_MAX_BYTES, type: "application/pdf" }),
    ).toBeNull();
  });

  it("collapses unsafe filenames and never returns empty", () => {
    expect(safeFileName("My License (2026)?.pdf")).toBe("My_License_2026_.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("///")).toBe("document");
    expect(safeFileName("x".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("builds the org-bound path contract", () => {
    expect(
      documentObjectPath({
        orgId: "org-1",
        ownerType: "provider",
        ownerId: "prov-1",
        familyId: "fam-1",
        version: 2,
        fileName: "license.pdf",
      }),
    ).toBe("org/org-1/provider/prov-1/fam-1/2/license.pdf");
    expect(
      documentFamilyPrefix({ orgId: "o", ownerType: "group", ownerId: "g", familyId: "f" }),
    ).toBe("org/o/group/g/f");
  });
});

describe("current-version derivation (TE-1)", () => {
  it("derives current as the family row with no successor", () => {
    const v1 = row({ id: "a", versionNumber: 1 });
    const v2 = row({ id: "b", versionNumber: 2, supersedesDocumentId: "a" });
    expect(currentVersions([v1, v2]).map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps one current row per family across families", () => {
    const famA1 = row({ id: "a1", documentFamilyId: "A" });
    const famA2 = row({
      id: "a2",
      documentFamilyId: "A",
      versionNumber: 2,
      supersedesDocumentId: "a1",
    });
    const famB1 = row({ id: "b1", documentFamilyId: "B" });
    const current = currentVersions([famA1, famA2, famB1]).map((r) => r.id);
    expect(current.sort()).toEqual(["a2", "b1"]);
  });

  it("never forks: an anomaly with two heads resolves to the highest version", () => {
    const v1 = row({ id: "a", versionNumber: 1 });
    const v3 = row({ id: "c", versionNumber: 3 }); // head with no supersedes link
    expect(currentVersions([v1, v3]).map((r) => r.id)).toEqual(["c"]);
  });

  it("familyHistory returns newest first; nextVersionNumber is max+1", () => {
    const v1 = row({ id: "a", versionNumber: 1 });
    const v2 = row({ id: "b", versionNumber: 2, supersedesDocumentId: "a" });
    expect(familyHistory([v1, v2], "fam-1").map((r) => r.id)).toEqual(["b", "a"]);
    expect(nextVersionNumber([v1, v2])).toBe(3);
    expect(nextVersionNumber([])).toBe(1);
  });
});

describe("expiration classification boundaries (TE-6/TE-12)", () => {
  it("yesterday is expired; today is expiring_soon, never expired", () => {
    expect(classifyExpiration("coi", "2026-07-16", TODAY)).toBe("expired");
    expect(classifyExpiration("coi", TODAY, TODAY)).toBe("expiring_soon");
  });

  it("COI: day 30 is expiring_soon, day 31 is current", () => {
    expect(classifyExpiration("coi", "2026-08-16", TODAY)).toBe("expiring_soon"); // +30
    expect(classifyExpiration("coi", "2026-08-17", TODAY)).toBe("current"); // +31
  });

  it("DEA: day 60 is expiring_soon, day 61 is current", () => {
    expect(classifyExpiration("dea", "2026-09-15", TODAY)).toBe("expiring_soon"); // +60
    expect(classifyExpiration("dea", "2026-09-16", TODAY)).toBe("current"); // +61
  });

  it("state license: day 90 is expiring_soon, day 91 is current", () => {
    expect(classifyExpiration("state_license", "2026-10-15", TODAY)).toBe("expiring_soon"); // +90
    expect(classifyExpiration("state_license", "2026-10-16", TODAY)).toBe("current"); // +91
  });

  it("a dateless row classifies to null (no tracking)", () => {
    expect(classifyExpiration("w9", null, TODAY)).toBeNull();
  });
});

describe("expiring-credentials projection (F4.5.2)", () => {
  it("keeps only dated CURRENT versions, sorted soonest first", () => {
    const expired = row({
      id: "e",
      documentFamilyId: "E",
      docType: "coi",
      expirationDate: "2026-07-01",
    });
    const soon = row({
      id: "s",
      documentFamilyId: "S",
      docType: "coi",
      expirationDate: "2026-08-07",
    }); // 21 days
    const current = row({
      id: "c",
      documentFamilyId: "C",
      docType: "state_license",
      expirationDate: "2027-07-01",
    });
    const dateless = row({ id: "d", documentFamilyId: "D", docType: "w9" });
    const supersededSoon = row({
      id: "old",
      documentFamilyId: "S",
      versionNumber: 0,
      docType: "coi",
      expirationDate: "2026-07-02",
    });
    const rows = expiringCredentialRows([expired, soon, current, dateless, supersededSoon], TODAY);
    expect(rows.map((r) => r.document.id)).toEqual(["e", "s", "c"]);
    expect(rows.map((r) => r.status)).toEqual(["expired", "expiring_soon", "current"]);
  });
});

describe("SOP required-kind matching (TE-7)", () => {
  it("resolves machine kinds, labels, and aliases; free-form names never join", () => {
    expect(parseDocumentKind("state_license")).toBe("state_license");
    expect(parseDocumentKind("State License")).toBe("state_license");
    expect(parseDocumentKind("W-9")).toBe("w9");
    expect(parseDocumentKind("CMS-460")).toBe("cms_460");
    expect(parseDocumentKind("certificate of insurance")).toBe("coi");
    expect(parseDocumentKind("Voided Check")).toBe("voided_check");
    expect(parseDocumentKind("Submission confirmation PDF")).toBeNull();
  });

  it("extracts distinct kinds from tasks' step artifacts in first-appearance order", () => {
    const step = (artifacts: string[]): SOPStep => ({
      id: "s",
      order: 1,
      label: "step",
      isCompleted: false,
      requiredArtifacts: artifacts,
    });
    const kinds = requiredDocumentKinds([
      { sopContent: [step(["W-9", "Fax cover sheet"]), step(["coi"])] },
      { sopContent: [step(["w9", "state_license"])] },
    ]);
    expect(kinds).toEqual(["w9", "coi", "state_license"]);
  });
});

describe("case document status (F4.5.3)", () => {
  const providerLicense = row({
    id: "lic2",
    documentFamilyId: "L",
    versionNumber: 2,
    supersedesDocumentId: "lic1",
    docType: "state_license",
    expirationDate: "2027-01-01",
  });
  const providerLicenseV1 = row({
    id: "lic1",
    documentFamilyId: "L",
    docType: "state_license",
    expirationDate: "2026-01-01",
  });
  const groupCoiExpired = row({
    id: "coi1",
    documentFamilyId: "GC",
    docType: "coi",
    expirationDate: "2026-07-01",
  });

  it("derives present from the CURRENT version, expired and missing explicitly", () => {
    const checks = caseDocumentStatus(
      ["state_license", "coi", "w9"],
      [providerLicense, providerLicenseV1],
      [groupCoiExpired],
      TODAY,
    );
    expect(checks.map((c) => [c.kind, c.state])).toEqual([
      ["state_license", "present"],
      ["coi", "expired"],
      ["w9", "missing"],
    ]);
    expect(checks[0].document?.id).toBe("lic2"); // never the superseded v1
    expect(checks[1].document?.id).toBe("coi1"); // the expired current, for context
    expect(checks[2].document).toBeNull();
  });

  it("flags a present document inside its expiring-soon window", () => {
    const soonCoi = row({
      id: "c",
      documentFamilyId: "C",
      docType: "coi",
      expirationDate: "2026-08-07",
    });
    const [check] = caseDocumentStatus(["coi"], [], [soonCoi], TODAY);
    expect(check.state).toBe("present");
    expect(check.expiringSoon).toBe(true);
  });
});

describe("readiness bridge (TE-6)", () => {
  it("reduces raw group rows to current versions in the readiness input shape", () => {
    const v1 = row({
      id: "a",
      documentFamilyId: "F",
      docType: "coi",
      expirationDate: "2026-01-01",
      groupId: "g1",
    });
    const v2 = row({
      id: "b",
      documentFamilyId: "F",
      versionNumber: 2,
      supersedesDocumentId: "a",
      docType: "coi",
      expirationDate: "2027-01-01",
      groupId: "g1",
    });
    expect(currentGroupReadinessDocuments([v1, v2])).toEqual([
      { groupId: "g1", docType: "coi", expirationDate: "2027-01-01" },
    ]);
  });
});

describe("orphan sweep (TE-4)", () => {
  it("flags storage version folders with no metadata row, numeric only", () => {
    expect(orphanVersionFolders(["1", "2", "3", ".tmp"], [1, 3])).toEqual(["2"]);
  });

  it("only sweeps objects older than the upload-token lifetime", () => {
    const now = Date.parse("2026-07-17T12:00:00Z");
    const fresh = new Date(now - UPLOAD_INTENT_TTL_MS + 60_000).toISOString();
    const stale = new Date(now - UPLOAD_INTENT_TTL_MS - 60_000).toISOString();
    expect(isOrphanExpired(fresh, now)).toBe(false);
    expect(isOrphanExpired(stale, now)).toBe(true);
    expect(isOrphanExpired("not-a-date", now)).toBe(false);
  });
});

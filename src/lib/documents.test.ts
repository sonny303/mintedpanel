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
  documentOwnerTarget,
  downloadableCaseDocuments,
  expirationDateError,
  expiringCredentialRows,
  familyHistory,
  isOrphanExpired,
  nextVersionNumber,
  orphanVersionFolders,
  parseDocumentKind,
  requireableDocumentKinds,
  requiredDocumentKinds,
  resolvableStepArtifactKind,
  resolveDocumentOwnerTarget,
  safeFileName,
  stepArtifactRows,
  uploadOwnerTargetForCheck,
  uploadableKinds,
  vaultPickerKinds,
} from "./documents";
import type { SOPStep, SOPStepAttachment } from "@/types";

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

  it("offers provider kinds and group kinds per the D1 grains", () => {
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
  });

  it("filled_form IS server-uploadable (the step-artifact write path) but never in the manual vault picker (D-ASD-4)", () => {
    // The generic catch-all kind must be a real, storable kind — the step-
    // artifact attach/upload flow uses it — but it must not clutter the
    // "+ Upload" dropdown a human works from.
    expect(uploadableKinds("provider").map((m) => m.kind)).toContain("filled_form");
    expect(uploadableKinds("group").map((m) => m.kind)).toContain("filled_form");
    expect(vaultPickerKinds("provider").map((m) => m.kind)).not.toContain("filled_form");
    expect(vaultPickerKinds("group").map((m) => m.kind)).not.toContain("filled_form");
    // vaultPickerKinds otherwise matches uploadableKinds exactly (minus filled_form).
    expect(vaultPickerKinds("provider").map((m) => m.kind)).toEqual(
      uploadableKinds("provider")
        .map((m) => m.kind)
        .filter((k) => k !== "filled_form"),
    );
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

describe("resolveDocumentOwnerTarget (ASD BITE-ASD-02/03)", () => {
  it("routes a provider-only kind to the provider grain when one is on hand", () => {
    expect(resolveDocumentOwnerTarget("state_license", "prov-1", "grp-1")).toEqual({
      ownerType: "provider",
      ownerId: "prov-1",
    });
  });

  it("routes a group-only kind to the group grain, ignoring a present provider id", () => {
    expect(resolveDocumentOwnerTarget("w9", "prov-1", "grp-1")).toEqual({
      ownerType: "group",
      ownerId: "grp-1",
    });
  });

  it("prefers provider for a dual-grain kind (coi) when both are available", () => {
    expect(resolveDocumentOwnerTarget("coi", "prov-1", "grp-1")).toEqual({
      ownerType: "provider",
      ownerId: "prov-1",
    });
  });

  it("falls back to group for a dual-grain kind when no provider is on hand", () => {
    expect(resolveDocumentOwnerTarget("coi", null, "grp-1")).toEqual({
      ownerType: "group",
      ownerId: "grp-1",
    });
  });

  it("returns null when neither grain is available for the kind", () => {
    expect(resolveDocumentOwnerTarget("w9", "prov-1", null)).toBeNull();
    expect(resolveDocumentOwnerTarget("state_license", null, "grp-1")).toBeNull();
  });
});

describe("documentOwnerTarget / uploadOwnerTargetForCheck", () => {
  const groupCoi = { providerId: null, groupId: "grp-1" };
  const providerCoi = { providerId: "prov-1", groupId: null };

  it("follows the document's own grain", () => {
    expect(documentOwnerTarget(groupCoi)).toEqual({ ownerType: "group", ownerId: "grp-1" });
    expect(documentOwnerTarget(providerCoi)).toEqual({
      ownerType: "provider",
      ownerId: "prov-1",
    });
    expect(documentOwnerTarget({ providerId: null, groupId: null })).toBeNull();
  });

  // The defect this covers: a dual-grain kind whose existing version is the
  // GROUP's was routed to the provider by kind preference, so replacing an
  // expired group COI on a case that also has a provider sent the group's
  // family id with ownerType "provider" — a 422 every time.
  it("replaces an expired GROUP coi against the group, even when the case has a provider", () => {
    expect(
      uploadOwnerTargetForCheck({ kind: "coi", document: groupCoi }, "prov-1", "grp-1"),
    ).toEqual({ ownerType: "group", ownerId: "grp-1" });
  });

  it("replaces a provider-held coi against the provider", () => {
    expect(
      uploadOwnerTargetForCheck({ kind: "coi", document: providerCoi }, "prov-1", "grp-1"),
    ).toEqual({ ownerType: "provider", ownerId: "prov-1" });
  });

  it("falls back to the kind's preference for a MISSING kind (no document to follow)", () => {
    expect(uploadOwnerTargetForCheck({ kind: "coi", document: null }, "prov-1", "grp-1")).toEqual({
      ownerType: "provider",
      ownerId: "prov-1",
    });
    expect(uploadOwnerTargetForCheck({ kind: "w9", document: null }, "prov-1", "grp-1")).toEqual({
      ownerType: "group",
      ownerId: "grp-1",
    });
    expect(uploadOwnerTargetForCheck({ kind: "w9", document: null }, "prov-1", null)).toBeNull();
  });
});

describe("downloadableCaseDocuments (ASD BITE-ASD-03 / D-ASD-8)", () => {
  it("selects present and expired rows (both carry a document), never missing", () => {
    const checks = caseDocumentStatus(
      ["state_license", "coi", "w9"],
      [
        row({
          id: "lic1",
          documentFamilyId: "L",
          docType: "state_license",
          expirationDate: "2027-01-01",
        }),
      ],
      [row({ id: "coi1", documentFamilyId: "C", docType: "coi", expirationDate: "2020-01-01" })],
      TODAY,
    );
    const downloadable = downloadableCaseDocuments(checks);
    expect(downloadable.map((d) => d.id)).toEqual(["lic1", "coi1"]);
  });

  it("returns an empty list when every check is missing", () => {
    const checks = caseDocumentStatus(["w9"], [], [], TODAY);
    expect(downloadableCaseDocuments(checks)).toEqual([]);
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

describe("requireableDocumentKinds (TS-164 template picker)", () => {
  it("excludes `other` — meaningless as a payer requirement", () => {
    expect(requireableDocumentKinds().map((m) => m.kind)).not.toContain("other");
  });

  // The regression this guards: `filled_form.uploadable` is TRUE (the server
  // accepts it — the ASD step-artifact catch-all writes it directly), so a
  // filter on `uploadable` alone silently puts "Filled Form" in the authoring
  // picker. It must be excluded BY NAME, exactly as vaultPickerKinds does.
  it("excludes `filled_form` even though it is uploadable", () => {
    expect(DOCUMENT_KIND_META.filled_form.uploadable).toBe(true);
    expect(requireableDocumentKinds().map((m) => m.kind)).not.toContain("filled_form");
  });

  it("offers the real payer-requirement kinds", () => {
    const kinds = requireableDocumentKinds().map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(["w9", "coi", "cv", "cms_460", "voided_check"]));
  });

  it("is owner-agnostic — a template requirement has no provider or group yet", () => {
    const kinds = requireableDocumentKinds().map((m) => m.kind);
    // w9 is group-only, cv is provider-only: both must be offerable.
    expect(kinds).toContain("w9");
    expect(kinds).toContain("cv");
  });
});

describe("vaultPickerKinds (D-ASD-4)", () => {
  it("excludes filled_form from the manual picker even though it is uploadable", () => {
    expect(DOCUMENT_KIND_META.filled_form.uploadable).toBe(true);
    expect(vaultPickerKinds("provider").map((m) => m.kind)).not.toContain("filled_form");
    expect(vaultPickerKinds("group").map((m) => m.kind)).not.toContain("filled_form");
  });

  it("still offers every other uploadable kind for the owner", () => {
    expect(vaultPickerKinds("provider").map((m) => m.kind)).toEqual(
      uploadableKinds("provider")
        .map((m) => m.kind)
        .filter((k) => k !== "filled_form"),
    );
  });
});

describe("resolvableStepArtifactKind (D-ASD-4)", () => {
  it("resolves a canonical name", () => {
    expect(resolvableStepArtifactKind("State License")).toBe("state_license");
    expect(resolvableStepArtifactKind("dea_certificate")).toBe("dea");
  });

  it("never resolves to filled_form or other, even by literal name", () => {
    expect(resolvableStepArtifactKind("Filled Form")).toBeNull();
    expect(resolvableStepArtifactKind("Other")).toBeNull();
  });

  it("returns null for a free-form artifact name", () => {
    expect(resolvableStepArtifactKind("Portal confirmation screenshot")).toBeNull();
  });
});

describe("stepArtifactRows (D-ASD-1/D-ASD-5)", () => {
  function attachment(
    documentId: string,
    artifactName: string,
    uploadedAt: string,
  ): SOPStepAttachment {
    return {
      documentId,
      artifactName,
      fileName: `${documentId}.pdf`,
      uploadedAt,
      uploadedBy: "user-1",
      kind: "state_license",
    };
  }

  it("one row per required artifact, resolved kind attached", () => {
    const step: Pick<SOPStep, "requiredArtifacts" | "attachments"> = {
      requiredArtifacts: ["State License", "Portal confirmation screenshot"],
      attachments: [],
    };
    const plan = stepArtifactRows(step);
    expect(plan.rows).toEqual([
      { artifactName: "State License", resolvedKind: "state_license", attachments: [] },
      {
        artifactName: "Portal confirmation screenshot",
        resolvedKind: null,
        attachments: [],
      },
    ]);
    expect(plan.orphans).toEqual([]);
  });

  it("a second attachment under one name is never hidden — both render, newest first", () => {
    const first = attachment("doc-1", "State License", "2026-07-01T00:00:00Z");
    const second = attachment("doc-2", "State License", "2026-07-15T00:00:00Z");
    const plan = stepArtifactRows({
      requiredArtifacts: ["State License"],
      attachments: [first, second],
    });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].attachments.map((a) => a.documentId)).toEqual(["doc-2", "doc-1"]);
  });

  it("an attachment whose name no longer matches any requiredArtifacts entry is an orphan, never dropped", () => {
    const orphaned = attachment("doc-3", "Old License Copy", "2026-06-01T00:00:00Z");
    const plan = stepArtifactRows({
      requiredArtifacts: ["State License"],
      attachments: [orphaned],
    });
    expect(plan.rows[0].attachments).toEqual([]);
    expect(plan.orphans).toEqual([orphaned]);
  });

  it("de-dupes a template that saved a duplicate requiredArtifacts name, defensively", () => {
    const plan = stepArtifactRows({
      requiredArtifacts: ["State License", "State License"],
      attachments: [],
    });
    expect(plan.rows).toHaveLength(1);
  });

  it("missing requiredArtifacts/attachments arrays degrade to empty, never throw", () => {
    expect(stepArtifactRows({})).toEqual({ rows: [], orphans: [] });
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

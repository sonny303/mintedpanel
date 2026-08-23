// E4.5 — pure document-store logic (TE-5/TE-6/TE-7): the ONE shared kind
// metadata map (labels, owner grains, expiration-required, expiring-soon
// thresholds), file/path rules, current-version derivation, expiration
// classification, and the SOP required-kind join. Fully derived — nothing
// here stores flags, reads a clock, or touches Supabase; "today" is always a
// passed-in date-only ISO string (the enrollmentReadiness idiom).
//
// Dependency direction: enrollmentReadiness.ts imports FROM this module (the
// COI advisory threshold); this module imports nothing from it, so the
// date-only helpers are self-contained.

import type { DocumentExpirationStatus, DocumentKind, DocumentOwnerType, SOPStep } from "@/types";

// ---------------------------------------------------------------------------
// TE-5 — the shared kind metadata map. Components never hard-code parallel
// kind arrays; the DB CHECK mirrors `expirationRequired` exactly
// (provider_documents_expiring_kind_dated) and the doc_type CHECK mirrors the
// key set.
// ---------------------------------------------------------------------------

export interface DocumentKindMeta {
  kind: DocumentKind;
  label: string;
  /** Which canonical owner grains may hold this kind (D1). */
  owners: DocumentOwnerType[];
  /** Kinds that expire require an expiration date at upload (D2/TE-5). */
  expirationRequired: boolean;
  /** "Expiring soon" window in days (TE-6 reviewer defaults: 90 State
   * License / 60 DEA / 30 COI and any other expiration-tracked kind). A PM
   * change is one edit here — never a schema migration. */
  expiringSoonDays: number;
  /** Whether the SERVER accepts this kind as an upload target at all, which
   * is also what the vault's manual picker offers (`uploadableKinds`). The
   * two diverged only while `filled_form` was a step-artifact catch-all; with
   * proof capture withdrawn that kind is dormant again and one flag answers
   * both questions. */
  uploadable: boolean;
  /** Normalized alternate spellings for the SOP required-kind join (TE-7). */
  aliases: string[];
}

const DEFAULT_EXPIRING_SOON_DAYS = 30;

export const DOCUMENT_KIND_META: Record<DocumentKind, DocumentKindMeta> = {
  state_license: {
    kind: "state_license",
    label: "State License",
    owners: ["provider"],
    expirationRequired: true,
    expiringSoonDays: 90,
    uploadable: true,
    aliases: ["state_license"],
  },
  dea: {
    kind: "dea",
    label: "DEA",
    owners: ["provider"],
    expirationRequired: true,
    expiringSoonDays: 60,
    uploadable: true,
    aliases: ["dea", "dea_registration", "dea_certificate"],
  },
  coi: {
    kind: "coi",
    label: "COI",
    owners: ["provider", "group"],
    expirationRequired: true,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["coi", "certificate_of_insurance"],
  },
  w9: {
    kind: "w9",
    label: "W-9",
    owners: ["group"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["w9", "w_9"],
  },
  cms_460: {
    kind: "cms_460",
    label: "CMS-460",
    owners: ["group"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["cms_460", "cms460"],
  },
  voided_check: {
    kind: "voided_check",
    label: "Voided Check",
    owners: ["group"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["voided_check"],
  },
  cv: {
    kind: "cv",
    label: "CV",
    owners: ["provider"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["cv", "curriculum_vitae", "resume"],
  },
  diploma: {
    kind: "diploma",
    label: "Diploma",
    owners: ["provider"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["diploma"],
  },
  board_cert: {
    kind: "board_cert",
    label: "Board Certification",
    owners: ["provider"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["board_cert", "board_certification"],
  },
  filled_form: {
    kind: "filled_form",
    // Dormant (E4.5 shape, restored 2026-08-23 when proof-of-submission
    // capture was withdrawn). No owner grain and not uploadable, so it is
    // offered by no picker and written by no client path; the doc_type CHECK
    // still permits it, and `parseDocumentKind` still resolves the name, so
    // any future consumer starts from a known-good vocabulary entry.
    label: "Filled Form",
    owners: [],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: false,
    aliases: ["filled_form"],
  },
  other: {
    kind: "other",
    label: "Other",
    owners: ["provider", "group"],
    expirationRequired: false,
    expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS,
    uploadable: true,
    aliases: ["other"],
  },
};

export const ALL_DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_META) as DocumentKind[];

export function isDocumentKind(raw: string): raw is DocumentKind {
  return raw in DOCUMENT_KIND_META;
}

export function documentKindLabel(kind: string): string {
  return isDocumentKind(kind) ? DOCUMENT_KIND_META[kind].label : kind;
}

/** The kinds the SERVER accepts as an upload target for one owner grain. */
export function uploadableKinds(ownerType: DocumentOwnerType): DocumentKindMeta[] {
  return ALL_DOCUMENT_KINDS.map((k) => DOCUMENT_KIND_META[k]).filter(
    (m) => m.uploadable && m.owners.includes(ownerType),
  );
}

/** The kinds SOP authoring may declare as "required documents" on a step —
 * every real, storable kind, minus the `other` catch-all (a step asking for
 * "Other" tells the specialist nothing and joins no vault family). Dormant
 * kinds are excluded by `uploadable`, so `filled_form` drops out on its own.
 * Single-sourced here because the authoring picker and its test must agree,
 * and because a new kind should appear in the picker automatically. */
export function requireableDocumentKinds(): DocumentKind[] {
  return ALL_DOCUMENT_KINDS.filter((k) => DOCUMENT_KIND_META[k].uploadable && k !== "other");
}

/** D2/TE-5: a dated kind cannot be saved without its expiration date. */
export function expirationDateError(
  kind: DocumentKind,
  expirationDate: string | null,
): string | null {
  if (DOCUMENT_KIND_META[kind].expirationRequired && !expirationDate) {
    return `${DOCUMENT_KIND_META[kind].label} requires an expiration date`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TE-4 — file limits + the org-bound object path contract. The bucket-level
// limits in migration 20260717150100 are the storage-side backstop of these
// values; the UI mirrors them for pre-flight validation.
// ---------------------------------------------------------------------------

export const DOCUMENT_BUCKET = "provider-documents";
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
/** Signed download URLs are short-lived by contract (TE-3). */
export const DOWNLOAD_URL_TTL_SECONDS = 120;
/** Signed upload tokens live ~2h (storage default); an un-finalized object
 * older than this is an orphan the bounded sweep may clean (TE-4). */
export const UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export function checkDocumentFile(file: {
  name: string;
  size: number;
  type: string;
}): string | null {
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Only PDF, PNG, or JPEG files are supported";
  }
  if (file.size <= 0) return "The file is empty";
  if (file.size > DOCUMENT_MAX_BYTES) {
    return `Files are limited to ${Math.floor(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB`;
  }
  return null;
}

/** Collapse a user filename to a storage-safe key segment. Never empty. */
export function safeFileName(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
  const capped = trimmed.slice(0, 100);
  return capped || "document";
}

export interface DocumentPathParts {
  orgId: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  familyId: string;
  version: number;
  fileName: string;
}

/** The TE-2 path contract. Keys are generated SERVER-side from these parts —
 * never accepted verbatim from the browser. */
export function documentObjectPath(parts: DocumentPathParts): string {
  return [
    "org",
    parts.orgId,
    parts.ownerType,
    parts.ownerId,
    parts.familyId,
    String(parts.version),
    safeFileName(parts.fileName),
  ].join("/");
}

/** The family prefix (everything above the version folders) — the bounded
 * scope of the TE-4 orphan sweep. */
export function documentFamilyPrefix(
  parts: Pick<DocumentPathParts, "orgId" | "ownerType" | "ownerId" | "familyId">,
): string {
  return ["org", parts.orgId, parts.ownerType, parts.ownerId, parts.familyId].join("/");
}

// ---------------------------------------------------------------------------
// TE-1 — current-version derivation. "Current" is the family row with no
// successor; history is a chain (one successor per superseded row, DB-unique).
// Structural inputs so the browser domain type and narrow service projections
// both fit.
// ---------------------------------------------------------------------------

export interface DocumentVersionShape {
  id: string;
  documentFamilyId: string;
  versionNumber: number;
  supersedesDocumentId: string | null;
}

/** One current row per family: the row no other family row supersedes.
 * Tiebreak (data anomaly only — the DB forbids forks): highest version.
 * Runtime-defensive: a row with no family id (a pre-migration projection)
 * acts as its own single-row family — exactly the activation migration's
 * backfill semantic. */
export function currentVersions<T extends DocumentVersionShape>(rows: readonly T[]): T[] {
  const familyKey = (row: T) => row.documentFamilyId ?? row.id;
  const byFamily = new Map<string, T[]>();
  for (const row of rows) {
    byFamily.set(familyKey(row), [...(byFamily.get(familyKey(row)) ?? []), row]);
  }
  const current: T[] = [];
  for (const family of byFamily.values()) {
    const superseded = new Set(
      family
        .map((r) => r.supersedesDocumentId)
        .filter((id): id is string => typeof id === "string"),
    );
    const heads = family.filter((r) => !superseded.has(r.id));
    const head = [...heads].sort((a, b) => (b.versionNumber ?? 1) - (a.versionNumber ?? 1))[0];
    if (head) current.push(head);
  }
  return current;
}

/** A family's full history, newest version first. */
export function familyHistory<T extends DocumentVersionShape>(
  rows: readonly T[],
  familyId: string,
): T[] {
  return rows
    .filter((r) => r.documentFamilyId === familyId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

/** The next version number for a family (1 for a new family). */
export function nextVersionNumber(rows: readonly { versionNumber: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.versionNumber), 0) + 1;
}

// ---------------------------------------------------------------------------
// TE-6 — expiration classification. Date-only math (ISO YYYY-MM-DD), no
// clock reads; boundaries: the threshold day itself is expiring_soon, the
// day past it is current, today is expiring_soon, yesterday is expired.
// ---------------------------------------------------------------------------

/** Whole days from `from` to `to` (UTC midnights — no TZ drift). */
function dateOnlyDays(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Classify one dated document; null when the row tracks no expiration. */
export function classifyExpiration(
  kind: DocumentKind,
  expirationDate: string | null,
  today: string,
): DocumentExpirationStatus | null {
  if (!expirationDate) return null;
  const daysUntil = dateOnlyDays(today, expirationDate);
  if (daysUntil < 0) return "expired";
  if (daysUntil <= DOCUMENT_KIND_META[kind].expiringSoonDays) return "expiring_soon";
  return "current";
}

/** True when a dated end is inside the kind's expiring-soon window but not
 * yet past — the readiness advisory condition (TE-6). */
export function isExpiringSoon(kind: DocumentKind, endDate: string, today: string): boolean {
  return classifyExpiration(kind, endDate, today) === "expiring_soon";
}

export interface ExpiringCredentialShape extends DocumentVersionShape {
  docType: string;
  expirationDate: string | null;
}

export interface ExpiringCredentialRow<T> {
  document: T;
  status: DocumentExpirationStatus;
}

/** F4.5.2 — the expiring-credentials projection: CURRENT versions that track
 * an expiration date, sorted by soonest expiration, each classified. Kinds
 * outside the vocabulary never crash — they classify at the default window. */
export function expiringCredentialRows<T extends ExpiringCredentialShape>(
  rows: readonly T[],
  today: string,
): ExpiringCredentialRow<T>[] {
  return currentVersions(rows)
    .filter((r) => r.expirationDate !== null)
    .sort((a, b) => (a.expirationDate as string).localeCompare(b.expirationDate as string))
    .map((document) => ({
      document,
      status: classifyExpiration(
        isDocumentKind(document.docType) ? document.docType : "other",
        document.expirationDate,
        today,
      ) as DocumentExpirationStatus,
    }));
}

// ---------------------------------------------------------------------------
// TE-7 — SOP required-kind join. Requirements reference the shared MACHINE
// kind (a requiredArtifacts entry that resolves to a DocumentKind); free-form
// artifact names ("Submission confirmation PDF") stay artifacts and never
// join the document store.
// ---------------------------------------------------------------------------

function normalizeKindToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const KIND_BY_TOKEN: Map<string, DocumentKind> = (() => {
  const map = new Map<string, DocumentKind>();
  for (const meta of Object.values(DOCUMENT_KIND_META)) {
    map.set(normalizeKindToken(meta.kind), meta.kind);
    map.set(normalizeKindToken(meta.label), meta.kind);
    for (const alias of meta.aliases) map.set(alias, meta.kind);
  }
  return map;
})();

/** Resolve a requiredArtifacts entry to a machine kind, or null for a
 * free-form artifact name. */
export function parseDocumentKind(raw: string): DocumentKind | null {
  return KIND_BY_TOKEN.get(normalizeKindToken(raw)) ?? null;
}

/** The distinct machine kinds a case's tasks require, in first-appearance
 * order across steps (E1.7b stamping already pinned which SOP version's
 * requirements apply — the caller passes that resolved sop_content). */
export function requiredDocumentKinds(
  tasks: ReadonlyArray<{ sopContent: SOPStep[] }>,
): DocumentKind[] {
  const kinds: DocumentKind[] = [];
  for (const task of tasks) {
    for (const step of task.sopContent ?? []) {
      for (const artifact of step.requiredArtifacts ?? []) {
        const kind = parseDocumentKind(artifact);
        if (kind && !kinds.includes(kind)) kinds.push(kind);
      }
    }
  }
  return kinds;
}

export type CaseDocumentState = "present" | "expired" | "missing";

export interface CaseDocumentCheck<T> {
  kind: DocumentKind;
  label: string;
  state: CaseDocumentState;
  /** Set for present/expired — the CURRENT version backing the row (the
   * one-click download target, F4.5.3). */
  document: T | null;
  /** present + inside the kind's expiring-soon window. */
  expiringSoon: boolean;
}

export interface CaseDocumentShape extends DocumentVersionShape {
  docType: string;
  expirationDate: string | null;
}

/** F4.5.3/TE-7 — derive the case's required-document status from the CURRENT
 * provider/group document versions plus the task's required-kind list. Live
 * advisory only: nothing is copied onto the case or task. */
export function caseDocumentStatus<T extends CaseDocumentShape>(
  requiredKinds: readonly DocumentKind[],
  providerDocs: readonly T[],
  groupDocs: readonly T[],
  today: string,
): CaseDocumentCheck<T>[] {
  const currentDocs = [...currentVersions(providerDocs), ...currentVersions(groupDocs)];
  return requiredKinds.map((kind) => {
    const candidates = currentDocs.filter((d) => d.docType === kind);
    // Prefer an unexpired document with the latest expiration; a dateless
    // document (non-expiring kind) counts as present.
    const unexpired = candidates.filter(
      (d) => classifyExpiration(kind, d.expirationDate, today) !== "expired",
    );
    const best =
      [...unexpired].sort((a, b) =>
        (b.expirationDate ?? "9999").localeCompare(a.expirationDate ?? "9999"),
      )[0] ?? null;
    if (best) {
      return {
        kind,
        label: DOCUMENT_KIND_META[kind].label,
        state: "present" as const,
        document: best,
        expiringSoon: classifyExpiration(kind, best.expirationDate, today) === "expiring_soon",
      };
    }
    const expired = [...candidates].sort((a, b) =>
      (b.expirationDate ?? "").localeCompare(a.expirationDate ?? ""),
    )[0];
    if (expired) {
      return {
        kind,
        label: DOCUMENT_KIND_META[kind].label,
        state: "expired" as const,
        document: expired,
        expiringSoon: false,
      };
    }
    return {
      kind,
      label: DOCUMENT_KIND_META[kind].label,
      state: "missing" as const,
      document: null,
      expiringSoon: false,
    };
  });
}

// ---------------------------------------------------------------------------
// The shared owner-grain resolver: which vault (provider or group) a kind's
// upload should land in. `CaseRequiredDocuments` is its consumer — the case's
// Active Documents rail filing a W-9 against the group and a licence against
// the provider. Answers "where does a NEW document of this kind go"; it is
// NOT the right question when REPLACING an existing one (that must follow the
// document's own grain — see the note on the replace path).
// ---------------------------------------------------------------------------

export function resolveDocumentOwnerTarget(
  kind: DocumentKind,
  providerId: string | null,
  groupId: string | null,
): { ownerType: DocumentOwnerType; ownerId: string } | null {
  const owners = DOCUMENT_KIND_META[kind].owners;
  if (owners.includes("provider") && providerId)
    return { ownerType: "provider", ownerId: providerId };
  if (owners.includes("group") && groupId) return { ownerType: "group", ownerId: groupId };
  return null;
}

// ---------------------------------------------------------------------------
// BITE-ASD-03 (D-ASD-8) — bulk download selection. The download ACTION itself
// (sequential anchor-click downloads, never `window.open` in a loop — a loop
// of new-tab opens is what triggers the browser's popup blocker) lives in the
// component; this is the pure part: which checks have something to download.
// ---------------------------------------------------------------------------

export function downloadableCaseDocuments<T>(checks: readonly CaseDocumentCheck<T>[]): T[] {
  return checks.filter((c) => c.document !== null).map((c) => c.document as T);
}

// ---------------------------------------------------------------------------
// TE-6 — the readiness bridge: reduce raw group-document rows to CURRENT
// versions in the GroupDocumentInput shape enrollmentReadiness consumes. Both
// readiness services (browser + server queue assembly) run their group-doc
// reads through this ONE reducer so a superseded W-9/COI version never
// satisfies (or fails) a check.
// ---------------------------------------------------------------------------

export interface GroupReadinessDocumentRow extends DocumentVersionShape {
  groupId: string | null;
  docType: string;
  expirationDate: string | null;
}

export function currentGroupReadinessDocuments(
  rows: readonly GroupReadinessDocumentRow[],
): Array<{ groupId: string | null; docType: string; expirationDate: string | null }> {
  return currentVersions(rows).map((r) => ({
    groupId: r.groupId,
    docType: r.docType,
    expirationDate: r.expirationDate,
  }));
}

// ---------------------------------------------------------------------------
// TE-4 — the bounded orphan sweep (pure halves). An object uploaded but never
// finalized (no metadata row) is an orphan once its upload token has expired;
// the server sweeps ONLY the family prefix it is about to issue a new intent
// for — bounded by construction.
// ---------------------------------------------------------------------------

/** Version folders present in storage but absent from metadata. */
export function orphanVersionFolders(
  storageFolders: readonly string[],
  metadataVersions: readonly number[],
): string[] {
  const known = new Set(metadataVersions.map(String));
  return storageFolders.filter((f) => /^\d+$/.test(f) && !known.has(f));
}

/** An orphan object is sweepable only after the upload token has expired —
 * an in-flight upload is never deleted out from under its finalize. */
export function isOrphanExpired(objectCreatedAt: string, nowMs: number): boolean {
  const created = Date.parse(objectCreatedAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created > UPLOAD_INTENT_TTL_MS;
}

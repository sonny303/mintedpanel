import type { StateLicense } from "@/services/lookups";
import type { LicenseInput } from "@/services/providers";

export type LicenseCommand =
  | { type: "add"; values: Omit<LicenseInput, "id"> }
  | { type: "update"; id: string; expected: StateLicense; values: Omit<LicenseInput, "id"> }
  | { type: "remove"; id: string; expected: StateLicense };

// Include scope, identity, all editable values and the complete verification
// trail. A snapshot is captured when editing starts, never from a later refetch.
export const LICENSE_SNAPSHOT_COLUMNS = {
  id: "id",
  org_id: "orgId",
  provider_id: "providerId",
  state: "state",
  license_number: "licenseNumber",
  license_type: "licenseType",
  issue_date: "issueDate",
  expiration_date: "expirationDate",
  status: "status",
  created_at: "createdAt",
  verified_status: "verifiedStatus",
  verified_at: "verifiedAt",
  verified_by: "verifiedBy",
  verification_source_url: "verificationSourceUrl",
} as const satisfies Record<string, keyof StateLicense>;

export function licenseSnapshotFields(snapshot: StateLicense): Array<[string, string | null]> {
  return Object.entries(LICENSE_SNAPSHOT_COLUMNS).map(([column, property]) => {
    const value = snapshot[property];
    if (value !== null && typeof value !== "string") {
      throw new Error("The original license details are incomplete. Reload before saving.");
    }
    return [column, value];
  });
}

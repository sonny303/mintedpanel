// License editor draft model (E1.3). Non-component module so the editor
// file exports only components (react-refresh rule).
import type { PsvStatus } from "@/lib/licensePsv";

export interface LicenseDraft {
  /** Existing row id (edit); absent for new rows. */
  id?: string;
  state: string;
  licenseNumber: string;
  licenseType: string;
  issueDate: string;
  expirationDate: string;
  verifiedStatus: PsvStatus;
  verificationSourceUrl: string;
  /** Stored values (edit) — for the verified-on display + reset warnings. */
  storedExpirationDate?: string | null;
  storedVerifiedAt?: string | null;
}

export const EMPTY_LICENSE_DRAFT: LicenseDraft = {
  state: "",
  licenseNumber: "",
  licenseType: "full",
  issueDate: "",
  expirationDate: "",
  verifiedStatus: "unverified",
  verificationSourceUrl: "",
};

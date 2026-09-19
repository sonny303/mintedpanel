import type { SetActiveCaseInput, SetActiveCaseMessage } from "@/lib/extensionHandoff";

/** Sanitized P05/P06 contract fixtures. Both repos may mirror these exact
 * values in compatibility tests; they carry identifiers and a fake HTTPS URL
 * only. */
export const HANDOFF_EXTENSION_ID_FIXTURE = "abcdefghijklmnopabcdefghijklmnop";
export const HANDOFF_CASE_ID_FIXTURE = "b7a90000-0000-4000-a000-0000000000c1";
export const HANDOFF_PROVIDER_ID_FIXTURE = "49ad83a8-d8b6-419d-8dcc-88c04a54c4da";
export const HANDOFF_ORG_ID_FIXTURE = "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d";
export const HANDOFF_FACILITY_ID_FIXTURE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const HANDOFF_PORTAL_URL_FIXTURE = "https://portal.example/enroll";
export const HANDOFF_PORTAL_KEY_FIXTURE = "regional_enrollment";

export const SET_ACTIVE_CASE_INPUT_FIXTURE: SetActiveCaseInput = {
  caseId: HANDOFF_CASE_ID_FIXTURE,
  providerId: HANDOFF_PROVIDER_ID_FIXTURE,
  orgId: HANDOFF_ORG_ID_FIXTURE,
  portalUrl: HANDOFF_PORTAL_URL_FIXTURE,
  portalKey: HANDOFF_PORTAL_KEY_FIXTURE,
  facilityId: HANDOFF_FACILITY_ID_FIXTURE,
};

export const SET_ACTIVE_CASE_MESSAGE_FIXTURE: SetActiveCaseMessage = {
  type: "SET_ACTIVE_CASE",
  caseId: HANDOFF_CASE_ID_FIXTURE,
  providerId: HANDOFF_PROVIDER_ID_FIXTURE,
  orgId: HANDOFF_ORG_ID_FIXTURE,
  portalUrl: HANDOFF_PORTAL_URL_FIXTURE,
  portalKey: HANDOFF_PORTAL_KEY_FIXTURE,
  facilityId: HANDOFF_FACILITY_ID_FIXTURE,
};

export const SET_ACTIVE_CASE_RECEIPT_FIXTURE = { ok: true } as const;

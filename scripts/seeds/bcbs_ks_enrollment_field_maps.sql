-- Seed: BCBS KS Provider Network Application (form 15-481) field maps.
-- Portal: https://provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm.faces
--
-- Field inventory sourced from the published 15-481 application (the .faces
-- form implements it); the live JSF DOM was not reachable from the build
-- sandbox, so selectors use the 'label:' locator convention (fill engine
-- matches by label text) and every row is status 'proposed'.
-- To finalize: run scripts/record-form-fields.js on the live form, replace
-- selectors with recorded name/id CSS selectors, then set status 'approved'.
--
-- Rerunnable: deletes existing proposed rows for this portal first.

DELETE FROM public.portal_field_maps
WHERE portal_key = 'bcbs_ks_enrollment' AND status = 'proposed';

INSERT INTO public.portal_field_maps
  (org_id, portal_key, url_pattern, map_type, selector, source, token, hardcoded_value, transform, field_type, notes, status)
VALUES
  -- Section 1: Office Contact Information
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:First Name', 'manual', NULL, NULL, NULL, 'text',
   'Office contact first name (Section 1). Group credentialing contact stores a full name — split it. Disambiguate from Provider''s First Name when recording selectors.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Last Name', 'manual', NULL, NULL, NULL, 'text',
   'Office contact last name (Section 1). Split from the group credentialing contact full name.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Office Contact Position/Title', 'manual', NULL, NULL, NULL, 'text',
   'Not tracked in Minted Panel. Typically "Credentialing Coordinator".', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Phone Number', 'token', '{{group.credentialingPhone}}', NULL, NULL, 'text',
   'Office contact phone (Section 1). Disambiguate from Location Phone Number when recording selectors.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Appointment Scheduling Number', 'token', '{{facility.appointmentPhone}}', NULL, NULL, 'text',
   'Appears in both the office-contact and service-location sections — record both selectors.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Email Address', 'token', '{{group.credentialingEmail}}', NULL, NULL, 'text',
   NULL, 'proposed'),

  -- Provider information
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Provider''s First Name', 'token', '{{provider.firstName}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Provider''s Last Name', 'token', '{{provider.lastName}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Gender', 'token', '{{provider.gender}}', NULL, NULL, 'radio',
   'Match the form''s option text; confirm option values when recording.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Date of Birth', 'token', '{{provider.dateOfBirth}}', NULL, 'date_mmddyyyy', 'date', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:CAQH Provider ID Number', 'token', '{{provider.caqhId}}', NULL, NULL, 'text',
   'CAQH must be current and attested before submitting.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Provider''s NPI Number', 'token', '{{provider.npi}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Billing NPI Number', 'token', '{{group.npiType2}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Organizational or Subpart NPI Number(s)', 'manual_partial', '{{group.npiType2}}', NULL, NULL, 'text',
   'Primary billing NPI pre-filled. Add subpart NPIs if the group bills under any.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Specialty/Taxonomy', 'token', '{{provider.taxonomyCode}}', NULL, NULL, 'text',
   'BCBSKS validates against NPPES — must match the provider''s NPPES registration exactly.', 'proposed'),

  -- Service location
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Service Location Address', 'token', '{{facility.street}}', NULL, NULL, 'text',
   'Street line only; city/state/ZIP are separate fields.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:City', 'token', '{{facility.city}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:State', 'token', '{{facility.state}}', NULL, 'state_abbrev', 'select', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:ZIP Code', 'token', '{{facility.zip}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Available days and hours', 'manual', NULL, NULL, NULL, 'text',
   'Facility hours live on the facility record — enter per the form''s layout.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Location Phone Number', 'token', '{{facility.phone}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Location Fax Number', 'token', '{{facility.fax}}', NULL, NULL, 'text', NULL, 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Will the provider be rendering telemedicine services', 'manual', NULL, NULL, NULL, 'radio',
   'Not tracked in Minted Panel — confirm with the group.', 'proposed'),
  (NULL, 'bcbs_ks_enrollment', 'provider.bcbsks.com/bcbsks-provider/facelets/allUsers/form/NetworkEnrollmentForm*', 'web',
   'label:Date patients will begin receiving services through the group', 'token', '{{provider.startDate}}', NULL, 'date_mmddyyyy', 'date',
   'Provider start date — confirm against the case''s expected effective date; BCBSKS wants the request 60+ days ahead.', 'proposed');

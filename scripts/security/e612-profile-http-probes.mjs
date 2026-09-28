// R2 case-bound profile evidence on the real, disposable E6.12 HTTP stack.
// This module is copied into the isolated gateway container by the host runner.
export async function runE612ProfileHttpProbes({
  id,
  tokens,
  request,
  headers,
  assert,
  app,
  rest,
  anonKey,
  fixtures,
}) {
  const profilePath = (caseId, query = "") =>
    `/api/providers/${id.provider}/profile?${query}${query ? "&" : ""}case_id=${caseId}`;
  const orgAHeaders = headers(tokens.admin, { "x-org-id": id.orgA });
  const readProfile = (path, extraHeaders = orgAHeaders) =>
    request(app, path, { headers: extraHeaders });
  const tokenValue = (profile, token) =>
    profile?.tokens?.find((entry) => entry.token === token)?.value ?? null;
  const facilityIds = (profile) =>
    Array.isArray(profile?.facilities)
      ? profile.facilities.map((facility) => facility.id).sort()
      : [];
  const expectMissing = (name, result) =>
    assert(
      name,
      result.response.status === 404 && result.body?.data === null,
      `status_${result.response.status}`,
    );
  const validPath = profilePath(
    fixtures.caseWithLocations,
    `state=KS&facilityId=${fixtures.facilitySecondary}`,
  );

  const selectedSecondary = await readProfile(validPath);
  const profile = selectedSecondary.body?.data;
  assert(
    "profile.case.valid_secondary_identity_and_set",
    selectedSecondary.response.status === 200 &&
      profile?.case_id === fixtures.caseWithLocations &&
      profile?.selected_facility_id === fixtures.facilitySecondary &&
      JSON.stringify(facilityIds(profile)) ===
        JSON.stringify([fixtures.facilityPrimary, fixtures.facilitySecondary].sort()),
    `status_${selectedSecondary.response.status}`,
  );
  assert(
    "profile.case.group_state_override_and_computed_tokens",
    tokenValue(profile, "group.name") === "E612 Case Override Group" &&
      tokenValue(profile, "groupInsurance.policyNumber") === "E612-CASE-GROUP-POLICY" &&
      tokenValue(profile, "license.licenseNumber") === "E612-CASE-CO" &&
      tokenValue(profile, "facility.name") === "E612 Case Secondary" &&
      tokenValue(profile, "assignment.practiceFrequency") === "Case secondary assignment" &&
      tokenValue(profile, "provider.fullName") === "E612 Provider" &&
      tokenValue(profile, "provider.fullNameWithCredentials") === "E612 Provider, DO" &&
      tokenValue(profile, "provider.lastFirst") === "Provider, E612" &&
      tokenValue(profile, "facility.streetAddress") === "220 Case Secondary Ave, Suite 202" &&
      tokenValue(profile, "facility.fullAddress") ===
        "220 Case Secondary Ave, Suite 202, Overland Park, CO 66212",
  );
  assert(
    "profile.case.phi_no_store",
    selectedSecondary.response.headers.get("cache-control")?.toLowerCase() === "no-store",
  );

  const providerOnly = await readProfile(
    `/api/providers/${id.provider}/profile?state=KS&facilityId=${id.facilityA}`,
  );
  assert(
    "profile.case.provider_only_null_binding_preserves_provider_scope",
    providerOnly.response.status === 200 &&
      providerOnly.body?.data?.case_id === null &&
      providerOnly.body?.data?.selected_facility_id === id.facilityA &&
      facilityIds(providerOnly.body.data).includes(id.facilityA) &&
      tokenValue(providerOnly.body.data, "group.name") === "E612 Group A1",
  );

  const emptyLocations = await readProfile(profilePath(fixtures.caseEmptyLocations));
  assert(
    "profile.case.empty_locations_do_not_fall_back_to_provider",
    emptyLocations.response.status === 200 &&
      emptyLocations.body?.data?.case_id === fixtures.caseEmptyLocations &&
      emptyLocations.body?.data?.facilities?.length === 0 &&
      emptyLocations.body?.data?.selected_facility_id === null &&
      tokenValue(emptyLocations.body.data, "facility.name") === null &&
      emptyLocations.body?.meta?.needs_facility !== true,
    `status_${emptyLocations.response.status}`,
  );
  const emptyWithProviderFacility = await readProfile(
    profilePath(fixtures.caseEmptyLocations, `facilityId=${id.facilityA}`),
  );
  expectMissing("profile.case.empty_set_rejects_provider_facility", emptyWithProviderFacility);

  const unselectedSecondary = await readProfile(profilePath(fixtures.caseUnselectedSecondary));
  assert(
    "profile.case.single_secondary_is_not_implicitly_selected",
    unselectedSecondary.response.status === 200 &&
      facilityIds(unselectedSecondary.body?.data).length === 1 &&
      facilityIds(unselectedSecondary.body?.data)[0] === fixtures.facilityUnselectedSecondary &&
      unselectedSecondary.body?.data?.selected_facility_id === null &&
      unselectedSecondary.body?.meta?.needs_facility === true &&
      tokenValue(unselectedSecondary.body.data, "facility.name") === null,
    `status_${unselectedSecondary.response.status}`,
  );

  const nullGroup = await readProfile(profilePath(fixtures.caseNullGroup));
  assert(
    "profile.case.null_group_does_not_fall_back_to_provider_group",
    nullGroup.response.status === 200 &&
      nullGroup.body?.data?.case_id === fixtures.caseNullGroup &&
      tokenValue(nullGroup.body.data, "group.name") === null &&
      tokenValue(nullGroup.body.data, "groupInsurance.policyNumber") === null,
    `status_${nullGroup.response.status}`,
  );

  const removed = await request(
    rest,
    `/case_facilities?case_id=eq.${fixtures.caseWithLocations}&facility_id=eq.${fixtures.facilitySecondary}`,
    {
      method: "DELETE",
      headers: headers(tokens.admin, { prefer: "return=minimal" }),
    },
  );
  assert(
    "profile.case.fixture_secondary_removed",
    removed.response.status === 204,
    `status_${removed.response.status}`,
  );
  const removedSelection = await readProfile(validPath);
  expectMissing("profile.case.removed_selection_does_not_fall_back", removedSelection);

  const wrongProvider = await readProfile(profilePath(fixtures.caseWrongProvider));
  expectMissing("profile.case.same_org_wrong_provider_denied", wrongProvider);
  const otherOrg = await readProfile(profilePath(fixtures.caseOtherOrg));
  expectMissing("profile.case.cross_org_case_denied", otherOrg);
  const wrongOrgHeader = await readProfile(
    profilePath(fixtures.caseWithLocations),
    headers(tokens.admin, { "x-org-id": id.orgB }),
  );
  expectMissing("profile.case.request_org_scope_denied", wrongOrgHeader);

  const signedOut = await readProfile(validPath, { apikey: anonKey });
  assert(
    "profile.case.signed_out_denied",
    [401, 403].includes(signedOut.response.status) && signedOut.body?.data === null,
    `status_${signedOut.response.status}`,
  );

  for (const [name, caseId] of [
    ["invalid", "not-a-uuid"],
    ["present_empty", ""],
  ]) {
    const result = await readProfile(profilePath(caseId));
    assert(
      `profile.case.${name}_intent_fails_closed`,
      result.response.status >= 400 && result.response.status < 500 && result.body?.data === null,
      `status_${result.response.status}`,
    );
  }

  process.stdout.write("E612|PROFILE|PASS\n");
}

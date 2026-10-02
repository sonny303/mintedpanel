// MINT-66 disposable HTTP proof for legacy POST /api/portal-field-maps clients.
// The seed is for the isolated E6.12 Postgres stack only. The probes use the
// real Nitro route and a real signed-in E6.12 admin token supplied by its
// existing HTTP driver; they never contact a hosted project.
export const M66_LEGACY_POST = Object.freeze({
  genericConflict: "This form configuration requires expected_mapping_generation.",
  ids: Object.freeze({
    typedPortal: "38000000-0000-4000-a000-000000000066",
    resetPortal: "38000000-0000-4000-a000-000000000067",
    mixedSharedPortal: "38000000-0000-4000-a000-000000000068",
    mixedOrgPortal: "38000000-0000-4000-a000-000000000069",
    legacyPortal: "38000000-0000-4000-a000-000000000070",
    typedMap: "48000000-0000-4000-a000-000000000066",
    resetMap: "48000000-0000-4000-a000-000000000067",
    mixedMap: "48000000-0000-4000-a000-000000000068",
    resetIdempotencyKey: "4fb29911-4b2e-4d83-a000-000000000066",
  }),
  keys: Object.freeze({
    typed: "m66_http_typed_existing",
    reset: "m66_http_reset_generation_two",
    mixed: "m66_http_mixed_shared_explicit",
    legacy: "m66_http_legacy_positive",
  }),
  seededPayers: Object.freeze({
    global: "60000000-0000-4000-8000-000000000001",
    organization: "60000000-0000-4000-8000-000000000002",
  }),
  selectors: Object.freeze({
    typed: "#m66-typed-existing",
    reset: "#m66-reset-existing",
    mixed: "#m66-mixed-existing",
    legacy: "#m66-legacy-new-field",
  }),
  legacyLabel: "M66 Synthetic Legacy Intake Label",
});

const ids = M66_LEGACY_POST.ids;
const keys = M66_LEGACY_POST.keys;
const selectors = M66_LEGACY_POST.selectors;
const seededPayers = M66_LEGACY_POST.seededPayers;
const protectedKeys = [keys.typed, keys.reset, keys.mixed];
const allKeys = [...protectedKeys, keys.legacy];
const protectedPortalIds = [
  ids.typedPortal,
  ids.resetPortal,
  ids.mixedSharedPortal,
  ids.mixedOrgPortal,
];
const allPortalIds = [...protectedPortalIds, ids.legacyPortal];

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Seed five exact-key configurations and three approved maps in disposable PG. */
export function m66LegacyPostFixtureSql({ orgId, adminId } = {}) {
  check("fixture_org_uuid", isUuid(orgId));
  check("fixture_admin_uuid", isUuid(adminId));
  const mixedUrl = "https://m66-http.example.invalid/application";
  const portalRows = [
    [
      ids.typedPortal,
      orgId,
      keys.typed,
      "M66 HTTP typed explicit configuration",
      seededPayers.organization,
      "contract",
      true,
      1,
    ],
    [
      ids.resetPortal,
      orgId,
      keys.reset,
      "M66 HTTP reset legacy configuration",
      null,
      null,
      false,
      1,
    ],
    [
      ids.mixedSharedPortal,
      null,
      keys.mixed,
      "M66 HTTP shared explicit configuration",
      seededPayers.global,
      "enrollment",
      true,
      1,
    ],
    [
      ids.mixedOrgPortal,
      orgId,
      keys.mixed,
      "M66 HTTP organization legacy configuration",
      null,
      null,
      false,
      1,
    ],
    [
      ids.legacyPortal,
      orgId,
      keys.legacy,
      "M66 HTTP legacy positive configuration",
      null,
      null,
      false,
      1,
    ],
  ];
  const portalValues = portalRows
    .map(
      ([id, ownerOrg, key, name, payerId, caseType, requiresSelection, generation]) =>
        `(${sqlLiteral(id)}, ${sqlLiteral(ownerOrg)}, ${sqlLiteral(key)}, ${sqlLiteral(name)}, ${sqlLiteral(mixedUrl)}, ${sqlLiteral(payerId)}, ${sqlLiteral(caseType)}, ${sqlLiteral(requiresSelection)}, ${generation})`,
    )
    .join(",\n");
  const mapRows = [
    [ids.typedMap, orgId, keys.typed, selectors.typed, "M66 typed protected map"],
    [ids.resetMap, orgId, keys.reset, selectors.reset, "M66 reset protected map"],
    [ids.mixedMap, null, keys.mixed, selectors.mixed, "M66 shared protected map"],
  ];
  const mapValues = mapRows
    .map(
      ([id, ownerOrg, key, selector, notes]) =>
        `(${sqlLiteral(id)}, ${sqlLiteral(ownerOrg)}, ${sqlLiteral(key)}, 'web', ${sqlLiteral(selector)}, 'token', 'text', 'approved', ${sqlLiteral(notes)}, 'provider.npi', 1)`,
    )
    .join(",\n");

  return `
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO public.portals(
  id, org_id, portal_key, name, form_url, payer_id, case_type,
  requires_explicit_selection, mapping_generation
) VALUES
${portalValues};

-- The approved rows are fixed synthetic fixtures. MINT-57's write guard still
-- resolves each exact portal identity and stamps the current generation.
SET LOCAL minted.expected_mapping_generation = '1';
INSERT INTO public.portal_field_maps(
  id, org_id, portal_key, map_type, selector, source, field_type,
  status, notes, token, mapping_generation
) VALUES
${mapValues};

-- Raise only the org-only fixture from generation 1 to 2 through the real
-- authenticated reset RPC. There is intentionally no shared fallback row.
SELECT set_config('request.jwt.claim.sub', ${sqlLiteral(adminId)}, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  ${sqlLiteral(JSON.stringify({ sub: adminId, role: "authenticated" }))},
  true
);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.reset_portal_mapping(
    ${sqlLiteral(ids.resetPortal)}, 1, ${sqlLiteral(ids.resetIdempotencyKey)}
  );
END; $$;
RESET ROLE;

COMMIT;
`;
}

function check(name, condition) {
  if (!condition) throw new Error(`M66_HTTP_ASSERT_${name}`);
}

function orderedRows(result, name) {
  check(`${name}_http`, result.response.status === 200);
  check(`${name}_array`, Array.isArray(result.body));
  return result.body;
}

function queryPath(table, filter, order = "id.asc") {
  const query = new URLSearchParams({ select: "*", ...filter, order });
  return `/${table}?${query.toString()}`;
}

function sameRows(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Run legacy-body POSTs over Nitro, and inspect persistent state through the
 * disposable PostgREST service-role path. `request` and `headers` are the
 * existing E6.12 driver's helpers, avoiding a second auth/network harness.
 */
export async function runM66LegacyPostHttpProbes({
  request,
  headers,
  app,
  rest,
  adminToken,
  anonKey,
  orgId,
  adminUserToken,
}) {
  check("driver_helpers", typeof request === "function" && typeof headers === "function");
  check("driver_urls", typeof app === "string" && typeof rest === "string");
  check("driver_org_uuid", isUuid(orgId));
  check("driver_tokens", Boolean(adminToken && anonKey && adminUserToken));

  const restHeaders = headers(adminToken, { accept: "application/json" });
  const appHeaders = headers(adminUserToken, {
    "x-org-id": orgId,
    "content-type": "application/json",
  });
  const readRows = async (table, filter, name) =>
    orderedRows(await request(rest, queryPath(table, filter), { headers: restHeaders }), name);
  const readSnapshot = async () => {
    const [portals, maps, resetEvents, audits] = await Promise.all([
      readRows("portals", { id: `in.(${allPortalIds.join(",")})` }, "snapshot_portals"),
      readRows("portal_field_maps", { portal_key: `in.(${allKeys.join(",")})` }, "snapshot_maps"),
      readRows(
        "form_mapping_reset_events",
        { portal_id: `eq.${ids.resetPortal}` },
        "snapshot_reset_events",
      ),
      Promise.all(
        allKeys.map((key) =>
          readRows(
            "audit_log",
            { description: `eq.Field proposed by extension on ${key}` },
            `snapshot_audit_${key}`,
          ),
        ),
      ),
    ]);
    return { portals, maps, resetEvents, audits };
  };

  const before = await readSnapshot();
  check("fixture_portal_count", before.portals.length === 5);
  check("fixture_map_count", before.maps.length === 3);
  check("fixture_reset_receipt_count", before.resetEvents.length === 1);
  check(
    "fixture_typed_explicit_gen1",
    before.portals.some(
      (row) =>
        row.id === ids.typedPortal &&
        row.org_id === orgId &&
        row.payer_id === seededPayers.organization &&
        row.case_type === "contract" &&
        row.requires_explicit_selection === true &&
        row.mapping_generation === 1,
    ),
  );
  check(
    "fixture_org_only_gen2_reset",
    before.portals.some(
      (row) =>
        row.id === ids.resetPortal &&
        row.org_id === orgId &&
        row.case_type === null &&
        row.requires_explicit_selection === false &&
        row.mapping_generation === 2,
    ) &&
      !before.portals.some((row) => row.org_id === null && row.portal_key === keys.reset) &&
      before.resetEvents[0]?.old_mapping_generation === 1 &&
      before.resetEvents[0]?.new_mapping_generation === 2,
  );
  const mixedGlobal = before.portals.find((row) => row.id === ids.mixedSharedPortal);
  const mixedOrg = before.portals.find((row) => row.id === ids.mixedOrgPortal);
  check(
    "fixture_mixed_tiers_same_key_and_url",
    mixedGlobal?.portal_key === keys.mixed &&
      mixedGlobal.org_id === null &&
      mixedGlobal.payer_id === seededPayers.global &&
      mixedGlobal.case_type === "enrollment" &&
      mixedGlobal.requires_explicit_selection === true &&
      mixedOrg?.portal_key === keys.mixed &&
      mixedOrg.org_id === orgId &&
      mixedOrg.case_type === null &&
      mixedOrg.requires_explicit_selection === false &&
      mixedOrg.form_url === mixedGlobal.form_url,
  );
  check(
    "fixture_genuine_legacy_gen1",
    before.portals.some(
      (row) =>
        row.id === ids.legacyPortal &&
        row.org_id === orgId &&
        row.case_type === null &&
        row.requires_explicit_selection === false &&
        row.mapping_generation === 1,
    ) && !before.maps.some((row) => row.portal_key === keys.legacy),
  );
  check(
    "fixture_approved_token_maps",
    [
      [keys.typed, selectors.typed, orgId],
      [keys.reset, selectors.reset, orgId],
      [keys.mixed, selectors.mixed, null],
    ].every(([key, selector, ownerOrg]) =>
      before.maps.some(
        (row) =>
          row.portal_key === key &&
          row.selector === selector &&
          row.org_id === ownerOrg &&
          row.status === "approved" &&
          row.token === "provider.npi" &&
          row.mapping_generation === 1,
      ),
    ),
  );
  check(
    "fixture_no_prior_audit",
    before.audits.every((rows) => rows.length === 0),
  );

  const postLegacy = (portalKey, selector, fieldLabel) =>
    request(app, "/api/portal-field-maps", {
      method: "POST",
      headers: appHeaders,
      body: JSON.stringify({ portal_key: portalKey, selector, field_label: fieldLabel }),
    });
  const blockedBodies = [
    [keys.typed, selectors.typed, "M66 Typed Synthetic Label"],
    [keys.reset, selectors.reset, "M66 Reset Synthetic Label"],
    [keys.mixed, selectors.mixed, "M66 Mixed Synthetic Label"],
  ];
  for (const [name, [portalKey, selector, fieldLabel]] of [
    ["typed_existing", blockedBodies[0]],
    ["reset_generation_two", blockedBodies[1]],
    ["mixed_shared_map", blockedBodies[2]],
  ]) {
    const result = await postLegacy(portalKey, selector, fieldLabel);
    check(
      `legacy_${name}_generic_409`,
      result.response.status === 409 &&
        result.body?.data === null &&
        result.body?.error === M66_LEGACY_POST.genericConflict &&
        result.body?.meta === null &&
        sameRows(Object.keys(result.body ?? {}).sort(), ["data", "error", "meta"]),
    );
  }

  const afterBlocked = await readSnapshot();
  check("blocked_portals_unchanged", sameRows(before.portals, afterBlocked.portals));
  check(
    "blocked_existing_maps_byte_identical",
    sameRows(
      before.maps.filter((row) => protectedKeys.includes(row.portal_key)),
      afterBlocked.maps.filter((row) => protectedKeys.includes(row.portal_key)),
    ),
  );
  check("blocked_reset_receipt_unchanged", sameRows(before.resetEvents, afterBlocked.resetEvents));
  check("blocked_audit_absent", sameRows(before.audits, afterBlocked.audits));
  check(
    "blocked_requests_inserted_no_maps",
    !afterBlocked.maps.some(
      (row) => protectedKeys.includes(row.portal_key) && row.status !== "approved",
    ),
  );

  const positive = await postLegacy(keys.legacy, selectors.legacy, M66_LEGACY_POST.legacyLabel);
  check(
    "legacy_gen1_created_201",
    positive.response.status === 201 &&
      positive.body?.error === null &&
      positive.body?.data?.map?.portalKey === keys.legacy &&
      positive.body?.data?.map?.selector === selectors.legacy &&
      positive.body?.data?.map?.orgId === orgId &&
      positive.body?.data?.map?.mappingGeneration === 1 &&
      positive.body?.data?.map?.status === "proposed" &&
      positive.body?.data?.map?.token === null &&
      positive.body?.data?.suggestion === null,
  );
  const replay = await postLegacy(keys.legacy, selectors.legacy, M66_LEGACY_POST.legacyLabel);
  check(
    "legacy_gen1_exact_replay_200",
    replay.response.status === 200 &&
      replay.body?.error === null &&
      replay.body?.data?.map?.id === positive.body?.data?.map?.id &&
      replay.body?.data?.map?.token === null &&
      replay.body?.data?.map?.status === "proposed" &&
      replay.body?.data?.suggestion === null,
  );

  const afterPositive = await readSnapshot();
  check("positive_portals_unchanged", sameRows(before.portals, afterPositive.portals));
  check(
    "positive_protected_maps_unchanged",
    sameRows(
      before.maps.filter((row) => protectedKeys.includes(row.portal_key)),
      afterPositive.maps.filter((row) => protectedKeys.includes(row.portal_key)),
    ),
  );
  check(
    "positive_reset_receipt_unchanged",
    sameRows(before.resetEvents, afterPositive.resetEvents),
  );
  check(
    "positive_protected_audits_absent",
    sameRows(
      before.audits.slice(0, protectedKeys.length),
      afterPositive.audits.slice(0, protectedKeys.length),
    ),
  );
  check(
    "positive_one_inert_proposal",
    afterPositive.maps.filter(
      (row) => row.portal_key === keys.legacy && row.selector === selectors.legacy,
    ).length === 1 &&
      afterPositive.maps.some(
        (row) =>
          row.portal_key === keys.legacy &&
          row.selector === selectors.legacy &&
          row.org_id === orgId &&
          row.status === "proposed" &&
          row.source === "manual" &&
          row.token === null &&
          row.mapping_generation === 1,
      ),
  );
  check(
    "positive_single_audit_after_replay",
    before.audits[protectedKeys.length].length === 0 &&
      afterPositive.audits[protectedKeys.length].length === 1,
  );

  return Object.freeze({
    blockedGeneric409: true,
    blockedStateUnchanged: true,
    legacyCreate201: true,
    legacyReplay200: true,
    protectedAuditAbsent: true,
  });
}

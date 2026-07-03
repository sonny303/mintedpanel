// resolve-fill: the single token resolver for portal form filling.
// Input:  { caseId, portalKey, pageStep?, mapType? }
// Output: case summary + every approved portal_field_maps row for the portal,
//         resolved to a concrete value (or flagged manual/partial/empty).
// Auth: caller's JWT — all reads ride RLS. Consumed by the fill-pdf edge
// function, the future fill-sheet UI, and the Chrome extension.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface FieldMap {
  id: string;
  portal_key: string;
  url_pattern: string | null;
  page_step: string | null;
  map_type: "web" | "pdf";
  selector: string;
  selector_fallbacks: unknown;
  source: "token" | "manual" | "manual_partial" | "hardcoded";
  token: string | null;
  hardcoded_value: string | null;
  transform: string | null;
  field_type: string;
  notes: string | null;
}

interface VocabEntry {
  token: string;
  table: string;
  column: string;
}

type Row = Record<string, unknown> | null;

// get_sop_field_tokens() table name -> resolved entity key
const TABLE_TO_ENTITY: Record<string, string> = {
  providers: "provider",
  provider_groups: "group",
  facilities: "facility",
  payers: "payer",
  msos: "mso",
  contracts: "contract",
  state_licenses: "license",
  provider_facility_assignments: "assignment",
  group_insurance_policies: "groupInsurance",
};

const STATE_ABBREV: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => stringify(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function applyTransform(value: string, transform: string | null): string {
  if (!value || !transform) return value;
  switch (transform) {
    case "date_mmddyyyy": {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
    }
    case "phone_digits":
      return value.replace(/\D/g, "");
    case "state_abbrev": {
      if (/^[A-Za-z]{2}$/.test(value.trim())) return value.trim().toUpperCase();
      return STATE_ABBREV[value.trim().toLowerCase()] ?? value;
    }
    case "uppercase":
      return value.toUpperCase();
    default:
      return value;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  let body: { caseId?: string; portalKey?: string; pageStep?: string; mapType?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const { caseId, portalKey, pageStep, mapType } = body;
  if (!caseId || !portalKey) return jsonResponse({ error: "caseId and portalKey are required" }, 400);

  const { data: caseRow, error: caseError } = await supabase
    .from("credential_cases")
    .select("id, org_id, provider_id, group_id, facility_id, payer_id, mso_id, state")
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) return jsonResponse({ error: caseError.message }, 500);
  if (!caseRow) return jsonResponse({ error: "Case not found or not visible to this user" }, 404);

  let mapsQuery = supabase
    .from("portal_field_maps")
    .select("*")
    .eq("portal_key", portalKey)
    .eq("status", "approved")
    .or(`org_id.is.null,org_id.eq.${caseRow.org_id}`)
    .order("created_at", { ascending: true });
  if (mapType) mapsQuery = mapsQuery.eq("map_type", mapType);
  if (pageStep) mapsQuery = mapsQuery.or(`page_step.is.null,page_step.eq.${pageStep}`);
  const { data: maps, error: mapsError } = await mapsQuery;
  if (mapsError) return jsonResponse({ error: mapsError.message }, 500);

  const { data: vocabData, error: vocabError } = await supabase.rpc("get_sop_field_tokens");
  if (vocabError) return jsonResponse({ error: `Token vocabulary unavailable: ${vocabError.message}` }, 500);
  const vocab = new Map<string, VocabEntry>(
    ((vocabData ?? []) as VocabEntry[]).map((v) => [v.token, v]),
  );

  const { data: provider } = await supabase
    .from("providers").select("*").eq("id", caseRow.provider_id).maybeSingle();

  const groupId = caseRow.group_id ?? (provider?.group_id as string | undefined) ?? null;
  const [groupRes, payerRes, msoRes] = await Promise.all([
    groupId
      ? supabase.from("provider_groups").select("*").eq("id", groupId).maybeSingle()
      : Promise.resolve({ data: null }),
    caseRow.payer_id
      ? supabase.from("payers").select("*").eq("id", caseRow.payer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    caseRow.mso_id
      ? supabase.from("msos").select("*").eq("id", caseRow.mso_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Facility: the case's facility, else the provider's primary assignment.
  let facility: Row = null;
  let assignment: Row = null;
  if (caseRow.facility_id) {
    const { data } = await supabase.from("facilities").select("*").eq("id", caseRow.facility_id).maybeSingle();
    facility = data;
  }
  if (caseRow.provider_id) {
    let aq = supabase
      .from("provider_facility_assignments").select("*")
      .eq("provider_id", caseRow.provider_id);
    aq = facility ? aq.eq("facility_id", (facility as Record<string, unknown>).id as string) : aq.eq("is_primary", true);
    const { data } = await aq.limit(1).maybeSingle();
    assignment = data;
    if (!facility && assignment) {
      const { data: f } = await supabase
        .from("facilities").select("*").eq("id", assignment.facility_id as string).maybeSingle();
      facility = f;
    }
  }

  const [contractRes, licenseRes, insuranceRes] = await Promise.all([
    groupId && caseRow.payer_id
      ? supabase.from("contracts").select("*")
          .eq("group_id", groupId).eq("payer_id", caseRow.payer_id).eq("state", caseRow.state)
          .limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    caseRow.provider_id
      ? supabase.from("state_licenses").select("*")
          .eq("provider_id", caseRow.provider_id).eq("state", caseRow.state)
          .order("expiration_date", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    groupId
      ? supabase.from("group_insurance_policies").select("*")
          .eq("group_id", groupId).eq("insurance_type", "professional_liability")
          .order("policy_end_date", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const entities: Record<string, Row> = {
    provider: provider ?? null,
    group: groupRes.data ?? null,
    facility,
    payer: payerRes.data ?? null,
    mso: msoRes.data ?? null,
    contract: contractRes.data ?? null,
    license: licenseRes.data ?? null,
    assignment,
    groupInsurance: insuranceRes.data ?? null,
  };

  const resolveToken = (rawToken: string): string => {
    const token = rawToken.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
    const entry = vocab.get(token);
    if (!entry) return "";
    const entity = entities[TABLE_TO_ENTITY[entry.table] ?? ""];
    let value = stringify(entity?.[entry.column]);
    // SOP field guide defaulting: provider contact details fall back to
    // facility phone and group credentialing email.
    if (!value && token === "provider.phone") value = stringify(entities.facility?.phone);
    if (!value && token === "provider.email") value = stringify(entities.group?.credentialing_email);
    return value;
  };

  const fields = (maps ?? []).map((map: FieldMap) => {
    let value: string | null = null;
    let resolution: "filled" | "partial" | "manual" | "empty";
    switch (map.source) {
      case "hardcoded":
        value = map.hardcoded_value ?? "";
        resolution = "filled";
        break;
      case "token": {
        value = applyTransform(resolveToken(map.token ?? ""), map.transform);
        resolution = value ? "filled" : "empty";
        break;
      }
      case "manual_partial": {
        value = applyTransform(resolveToken(map.token ?? ""), map.transform);
        resolution = "partial";
        break;
      }
      case "manual":
      default:
        resolution = "manual";
        break;
    }
    return {
      id: map.id,
      selector: map.selector,
      selectorFallbacks: map.selector_fallbacks,
      fieldType: map.field_type,
      mapType: map.map_type,
      pageStep: map.page_step,
      source: map.source,
      token: map.token,
      notes: map.notes,
      value,
      resolution,
    };
  });

  const providerName = provider
    ? [provider.first_name, provider.last_name].filter(Boolean).join(" ")
    : null;

  return jsonResponse({
    case: {
      id: caseRow.id,
      orgId: caseRow.org_id,
      providerId: caseRow.provider_id,
      groupId,
      providerName,
      payerName: (payerRes.data as Row)?.name ?? null,
      state: caseRow.state,
      portalKey,
    },
    fields,
    counts: {
      filled: fields.filter((f) => f.resolution === "filled").length,
      partial: fields.filter((f) => f.resolution === "partial").length,
      manual: fields.filter((f) => f.resolution === "manual").length,
      empty: fields.filter((f) => f.resolution === "empty").length,
    },
  });
});

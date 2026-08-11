// D6.4 / LISTPORTALS — browser listPortals now selects
// `payers(name, status, archived_at, merged_into_id)` and fails closed when
// the embed is missing (isListableRegistryPortal). Playwright harnesses are
// shape-only REST fakes and never synthesize PostgREST embeds on their own,
// so a global portal fixture without this helper is silently dropped and
// Form setup / portal pickers / funnel KPIs go empty.
//
// Call from every e2e GET handler that can return `portals` rows. Own-org
// rows would survive without the embed, but synthesizing for every row keeps
// the harness honest to the real select shape.

type Row = Record<string, unknown>;

/** Narrow payer facts PORTAL_API_COLUMNS asks for. */
function payerEmbedFacts(payer: Row | undefined): Row | null {
  if (!payer) return null;
  return {
    name: payer.name ?? null,
    status: payer.status ?? null,
    archived_at: payer.archived_at ?? null,
    merged_into_id: payer.merged_into_id ?? null,
  };
}

/**
 * When `select` asks for a `payers(...)` embed on a portals read, attach the
 * matching payer facts from `payers` keyed by `payer_id`. Leaves rows alone
 * when the select does not request the embed (other tables, narrow columns).
 */
export function withPortalPayerEmbed(
  table: string,
  select: string | null,
  rows: Row[],
  payers: Row[],
): Row[] {
  if (table !== "portals") return rows;
  if (!select || !select.includes("payers(")) return rows;
  return rows.map((row) => {
    // Respect an explicit fixture embed (tests that pin a dead payer).
    if ("payers" in row) return row;
    const payerId = row.payer_id;
    if (payerId == null || payerId === "") {
      return { ...row, payers: null };
    }
    const payer = payers.find((p) => p.id === payerId);
    return { ...row, payers: payerEmbedFacts(payer) };
  });
}

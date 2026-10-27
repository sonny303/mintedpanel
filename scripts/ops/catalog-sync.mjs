// Pure planning helpers for the prod -> staging catalog sync. No I/O here so the
// rules ("add what is missing, never overwrite, never delete") are unit-tested.

export const PROD_REF = "fkvuhfsqcmujywzgczmc";
export const STAGING_REF = "vmznysvietfaddakkegt";

/** Columns that point at auth.users; those users do not exist on the target. */
export const USER_COLUMNS = ["created_by", "published_by", "retired_by"];

/** Project ref from a Supabase URL, or null. */
export function projectRef(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(String(url ?? "").trim());
  return m ? m[1] : null;
}

/** Refuses anything but prod -> staging. Throws with the reason. */
export function assertDirection(sourceUrl, targetUrl) {
  if (projectRef(sourceUrl) !== PROD_REF) throw new Error("source must be the production project");
  if (projectRef(targetUrl) !== STAGING_REF) throw new Error("target must be the staging project");
}

export function stripUserColumns(row) {
  const out = { ...row };
  for (const c of USER_COLUMNS) delete out[c];
  return out;
}

/** Rows present in `source` whose key is absent from `target`. Never returns updates or deletes. */
export function planAdds(source, target, key = (r) => r.id) {
  const have = new Set(target.map(key));
  return source.filter((r) => !have.has(key(r)));
}

/** An org-owned row can only go where the owning org exists. */
export function splitByOrg(rows, targetOrgIds) {
  const ok = [];
  const skipped = [];
  for (const r of rows) {
    if (r.org_id == null || targetOrgIds.has(r.org_id)) ok.push(r);
    else skipped.push({ row: r, reason: "org not on target" });
  }
  return { ok, skipped };
}

/**
 * Forms need their payer and template on the target, and a storage file.
 * `have` carries the ids that exist (or will exist) on the target.
 */
export function splitForms(forms, have) {
  const ok = [];
  const skipped = [];
  for (const f of forms) {
    if (f.payer_id && !have.payers.has(f.payer_id))
      skipped.push({ row: f, reason: "payer not on target" });
    else if (f.template_id && !have.templates.has(f.template_id))
      skipped.push({ row: f, reason: "template not on target" });
    else ok.push(f);
  }
  return { ok, skipped };
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

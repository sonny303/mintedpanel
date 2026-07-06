// A portal_key is the stable identifier the extension sends with each fill /
// capture. When an admin adds a portal by hand we derive a sane default from
// the name: lowercase, spaces/punctuation → single hyphens, trimmed.
export function slugifyPortalKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

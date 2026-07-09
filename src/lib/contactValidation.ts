// Pure contact-field validation shared by the create-org flow (E0.1) and the
// party/contact surfaces (E0.2/E0.3). The server (create_organization RPC and
// RLS/services) is the enforcement authority; these give the user immediate,
// friendly feedback before submit.

// Format check mirrors the RPC's server-side regex closely enough for a
// pre-submit gate: one @, no spaces, a dot in the domain. Deliberately lenient
// (real deliverability is not knowable client-side).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// Common misspellings of popular email domains → the intended domain. Used only
// to surface a NON-blocking "did you mean" nudge (F0.1.2), never to block submit.
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "outlok.com": "outlook.com",
  "outook.com": "outlook.com",
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
};

// Returns a suggested corrected email when the domain looks like a common typo,
// else null. Case-insensitive on the domain; preserves the local part as typed.
export function commonEmailDomainTypo(value: string): string | null {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  const fixed = DOMAIN_TYPOS[domain];
  return fixed ? `${local}@${fixed}` : null;
}

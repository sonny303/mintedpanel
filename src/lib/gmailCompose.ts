// Gmail compose deep-link hand-off (P9, Epic 4 v1). Human-in-loop: opens
// Gmail's compose window (view=cm — a DRAFT, never a send) prefilled with the
// resolved draft-email recipients + subject/body; the human reviews and sends —
// the app NEVER sends on its own (consistent with "the extension never submits
// forms"). No Gmail API / OAuth in v1, and no BCC is ever emitted.
//
// If the URL-encoded body would push the compose URL past a safe length, we open
// compose with the recipients + subject only and signal the caller to copy the
// body to the clipboard instead (E1.7b TE-17: recipients are short — never strip
// them; only the body ever falls back so nothing is silently truncated).

const GMAIL_COMPOSE_BASE = "https://mail.google.com/mail/?view=cm&fs=1";

// Chrome tolerates far longer URLs, but Gmail's own compose handling gets
// unreliable with very long `body` params; fall back to clipboard past a
// conservative bound (total URL length, encoded).
export const GMAIL_URL_SAFE_MAX = 1900;

export interface GmailHandoff {
  /** The compose URL to open in a new tab. */
  url: string;
  /** True when the body was omitted from the URL — the caller should copy it to the clipboard and tell the user to paste. */
  bodyToClipboard: boolean;
}

// Gmail's compose deep-link takes comma-separated `to`/`cc` params. Recipients
// are the resolved addresses (literal, or a token's resolved value); unresolved
// ones are dropped upstream by the caller and surfaced as a fill-before-send gap
// in the UI — never silently included as blanks here.
export function planGmailHandoff(
  subject: string,
  body: string,
  to: string[] = [],
  cc: string[] = [],
): GmailHandoff {
  const params = [`su=${encodeURIComponent(subject)}`];
  const toJoined = to.filter((a) => a.trim()).join(",");
  const ccJoined = cc.filter((a) => a.trim()).join(",");
  if (toJoined) params.push(`to=${encodeURIComponent(toJoined)}`);
  if (ccJoined) params.push(`cc=${encodeURIComponent(ccJoined)}`);
  const head = `${GMAIL_COMPOSE_BASE}&${params.join("&")}`;
  const fullUrl = `${head}&body=${encodeURIComponent(body)}`;
  if (fullUrl.length <= GMAIL_URL_SAFE_MAX) {
    return { url: fullUrl, bodyToClipboard: false };
  }
  // Keep to/cc + subject in the URL; only the body falls back to the clipboard.
  return { url: head, bodyToClipboard: true };
}

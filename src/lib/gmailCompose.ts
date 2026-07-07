// Gmail compose deep-link hand-off (P9, Epic 4 v1). Human-in-loop: opens
// Gmail's compose window prefilled with the resolved draft-email subject/body;
// the human reviews and sends — the app NEVER sends on its own (consistent with
// "the extension never submits forms"). No Gmail API / OAuth in v1.
//
// If the URL-encoded body would push the compose URL past a safe length, we open
// compose with the subject only and signal the caller to copy the body to the
// clipboard instead (so nothing is silently truncated).

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

export function planGmailHandoff(subject: string, body: string): GmailHandoff {
  const su = encodeURIComponent(subject);
  const fullUrl = `${GMAIL_COMPOSE_BASE}&su=${su}&body=${encodeURIComponent(body)}`;
  if (fullUrl.length <= GMAIL_URL_SAFE_MAX) {
    return { url: fullUrl, bodyToClipboard: false };
  }
  return { url: `${GMAIL_COMPOSE_BASE}&su=${su}`, bodyToClipboard: true };
}

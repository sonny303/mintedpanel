import { describe, it, expect } from "vitest";
import { planGmailHandoff, GMAIL_URL_SAFE_MAX } from "./gmailCompose";

describe("planGmailHandoff", () => {
  it("builds a compose URL with encoded subject and body for a short email", () => {
    const { url, bodyToClipboard } = planGmailHandoff(
      "Credentialing follow-up",
      "Hi Dr. Smith,\nPlease confirm.",
    );
    expect(bodyToClipboard).toBe(false);
    expect(url).toContain("https://mail.google.com/mail/?view=cm&fs=1");
    expect(url).toContain("su=Credentialing%20follow-up");
    // newline encodes to %0A, space to %20
    expect(url).toContain("body=Hi%20Dr.%20Smith%2C%0APlease%20confirm.");
  });

  it("encodes reserved characters in the subject", () => {
    const { url } = planGmailHandoff("A&B = C?", "x");
    expect(url).toContain("su=A%26B%20%3D%20C%3F");
  });

  it("falls back to subject-only + clipboard when the body makes the URL too long", () => {
    const longBody = "x".repeat(GMAIL_URL_SAFE_MAX + 100);
    const { url, bodyToClipboard } = planGmailHandoff("Subject", longBody);
    expect(bodyToClipboard).toBe(true);
    expect(url).toContain("su=Subject");
    expect(url).not.toContain("body=");
    expect(url.length).toBeLessThanOrEqual(GMAIL_URL_SAFE_MAX);
  });

  it("keeps the body inline right up to the safe bound", () => {
    // A body that lands the full URL at/under the bound stays inline.
    const { bodyToClipboard, url } = planGmailHandoff("S", "y".repeat(100));
    expect(bodyToClipboard).toBe(false);
    expect(url).toContain("body=");
  });
});

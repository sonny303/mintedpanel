import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  // E1.7b F1.7b.5 (TE-17) — recipients thread into the compose URL as to/cc.
  it("adds comma-joined, encoded to/cc params", () => {
    const { url } = planGmailHandoff(
      "Subject",
      "Body",
      ["network_PhysicalHealth@optum.com", "jordan.rivera@example.com"],
      ["billing@example.com"],
    );
    expect(url).toContain("to=network_PhysicalHealth%40optum.com%2Cjordan.rivera%40example.com");
    expect(url).toContain("cc=billing%40example.com");
    expect(url).toContain("su=Subject");
    expect(url).toContain("body=Body");
  });

  it("omits to/cc params when there are no recipients (unchanged default)", () => {
    const { url } = planGmailHandoff("Subject", "Body");
    expect(url).not.toContain("to=");
    expect(url).not.toContain("cc=");
  });

  it("drops empty/whitespace recipient entries rather than emitting blanks", () => {
    const { url } = planGmailHandoff("S", "B", ["  ", "real@example.com"], ["   "]);
    expect(url).toContain("to=real%40example.com");
    expect(url).not.toContain("cc=");
  });

  it("keeps to/cc + subject in the URL and drops ONLY the body on the over-long fallback", () => {
    const longBody = "x".repeat(GMAIL_URL_SAFE_MAX + 100);
    const { url, bodyToClipboard } = planGmailHandoff(
      "Subject",
      longBody,
      ["payer@example.com"],
      ["cc@example.com"],
    );
    expect(bodyToClipboard).toBe(true);
    expect(url).toContain("to=payer%40example.com");
    expect(url).toContain("cc=cc%40example.com");
    expect(url).toContain("su=Subject");
    expect(url).not.toContain("body=");
  });

  it("never emits a bcc param, even when given recipients", () => {
    const { url } = planGmailHandoff("S", "B", ["a@x.com"], ["b@x.com"]);
    expect(url).not.toContain("bcc=");
  });
});

// E1.7b F1.7b.5 — the product DRAFTS, it never sends. Pinned at the code level:
// the only email surface is a Gmail COMPOSE deep link (view=cm) opened in a new
// tab for the human to review and send — no Gmail send API, no OAuth/mail
// credential handling, no BCC anywhere.
describe("no auto-send path exists (E1.7b F1.7b.5 / TE-17, TE-20)", () => {
  const emailSurfaces = ["src/lib/gmailCompose.ts", "src/components/cases/StepDetails.tsx"];

  function code(file: string): string {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    // Strip comments — prose may DESCRIBE "never sends"; the ban is on code.
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("opens a compose draft (view=cm), never a send URL", () => {
    const { url } = planGmailHandoff("S", "B", ["a@x.com"]);
    expect(url).toContain("view=cm");
    expect(url).not.toMatch(/[?&]send=/);
  });

  it("references no Gmail send API, OAuth, or bcc in the email surfaces", () => {
    for (const file of emailSurfaces) {
      const c = code(file);
      expect(c, `${file} must not call a mail send API`).not.toMatch(
        /messages\.send|users\.messages\.send|sendMessage|smtp|nodemailer|mailto:/i,
      );
      expect(c, `${file} must not handle OAuth/mail credentials`).not.toMatch(
        /oauth|access_token|refresh_token|client_secret/i,
      );
      expect(c, `${file} must never emit BCC`).not.toMatch(/bcc/i);
    }
  });
});

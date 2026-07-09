import { describe, expect, it } from "vitest";
import { renderCaptureEmail } from "./captureEmail";

const base = {
  orgName: "Rose City Rehab Collective",
  recipientName: "Candace Devereaux",
  captureUrl: "https://app.mintedpanel.test/capture/abc123",
  expiresAt: "2026-07-12T17:00:00Z",
  operatorContact: "sowmya.seed@example.test",
};

describe("renderCaptureEmail (E0.5 F0.5.4 / TE-5)", () => {
  it("states the org in the subject and body", () => {
    const { subject, body } = renderCaptureEmail(base);
    expect(subject).toContain("Rose City Rehab Collective");
    expect(body).toContain("Rose City Rehab Collective");
  });

  it("addresses the recipient by name", () => {
    expect(renderCaptureEmail(base).body).toContain("Candace Devereaux");
  });

  it("includes the capture URL", () => {
    expect(renderCaptureEmail(base).body).toContain(base.captureUrl);
  });

  it("states the expiry window", () => {
    const { body } = renderCaptureEmail(base);
    expect(body.toLowerCase()).toContain("expires");
    // Formatted, not the raw ISO string.
    expect(body).not.toContain("2026-07-12T17:00:00Z");
  });

  it("explicitly says no login/account is created", () => {
    expect(renderCaptureEmail(base).body).toMatch(/no account or password/i);
  });

  it("includes the operator-contact fallback", () => {
    expect(renderCaptureEmail(base).body).toContain("sowmya.seed@example.test");
  });
});

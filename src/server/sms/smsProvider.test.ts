import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  E164_PATTERN,
  disabledSmsProvider,
  isE164,
  resolveSmsProvider,
  type SmsMessage,
} from "./smsProvider";

const MESSAGE: SmsMessage = {
  orgId: "66666666-6666-4666-8666-666666666666",
  to: "+15555550123",
  body: "Reminder: your credentialing form is waiting.",
  consentId: "77777777-7777-4777-8777-777777777777",
  idempotencyKey: "step-1:provider-1",
};

describe("SMS provider seam", () => {
  it("resolves to the disabled provider whatever the environment says", () => {
    expect(resolveSmsProvider()).toBe(disabledSmsProvider);
    expect(resolveSmsProvider({ SMS_PROVIDER: "twilio", SMS_API_KEY: "x" })).toBe(
      disabledSmsProvider,
    );
  });

  it("refuses to send, as a result rather than a throw, and logs nothing", async () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    expect(disabledSmsProvider.canSend).toBe(false);
    await expect(disabledSmsProvider.send(MESSAGE)).resolves.toEqual({
      status: "refused",
      reason: "sms_disabled",
    });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("cannot be switched on by mutation", () => {
    expect(Object.isFrozen(disabledSmsProvider)).toBe(true);
  });

  it("checks E.164 the same way the sms_consents CHECK does", () => {
    const migration = readFileSync(
      "supabase/migrations/20261031130000_notification_sequences.sql",
      "utf8",
    );
    expect(migration).toContain(`phone_e164 ~ '${E164_PATTERN.source}'`);
    expect(isE164("+15555550123")).toBe(true);
    expect(isE164("+447911123456")).toBe(true);
    expect(isE164("5555550123")).toBe(false);
    expect(isE164("+05555550123")).toBe(false);
    expect(isE164("+1 555 555 0123")).toBe(false);
    expect(isE164("+1234567")).toBe(false);
  });
});

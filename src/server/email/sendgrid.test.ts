import { describe, expect, it, vi } from "vitest";
import { EmailError, buildMailPayload, sendEmail } from "./sendgrid.ts";
import type { EmailEnv } from "./env.ts";

const ENV: EmailEnv = {
  apiKey: "SG.test-key",
  fromEmail: "no-reply@mintedpanel.com",
  fromName: "Minted Panel",
  sandbox: false,
};

const INPUT = {
  to: "shelby@example.com",
  template: "test" as const,
  data: { practiceName: "Shelby Sports Rehab" },
  practiceName: "Shelby Sports Rehab",
  replyTo: { email: "office@ssr.example.com", name: "SSR Office" },
};

function okFetch(status = 202, messageId = "msg-123") {
  return vi.fn<typeof fetch>(
    async () => new Response(null, { status, headers: { "X-Message-Id": messageId } }),
  );
}

async function sendError(promise: Promise<unknown>): Promise<EmailError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EmailError);
    return err as EmailError;
  }
  throw new Error("expected sendEmail to throw");
}

function sentPayload(fetchMock: ReturnType<typeof okFetch>) {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("sendEmail", () => {
  it("refuses to send when the key or from-address is missing", async () => {
    for (const env of [
      { ...ENV, apiKey: undefined },
      { ...ENV, fromEmail: undefined },
    ]) {
      const fetchMock = okFetch();
      const err = await sendError(sendEmail(INPUT, { env, fetch: fetchMock }));
      expect(err.kind).toBe("misconfigured");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("posts to SendGrid and returns the message id", async () => {
    const fetchMock = okFetch();
    const result = await sendEmail(INPUT, { env: ENV, fetch: fetchMock });

    expect(result).toEqual({ status: 202, messageId: "msg-123", sandbox: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer SG.test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      personalizations: [{ to: [{ email: "shelby@example.com" }] }],
      from: { email: "no-reply@mintedpanel.com" },
      reply_to: { email: "office@ssr.example.com" },
    });
  });

  it("sends plain text before html, with every tracker off and only the template key as metadata", async () => {
    const fetchMock = okFetch();
    await sendEmail(INPUT, { env: ENV, fetch: fetchMock });
    const payload = sentPayload(fetchMock);

    expect(payload.content.map((c: { type: string }) => c.type)).toEqual([
      "text/plain",
      "text/html",
    ]);
    expect(payload.tracking_settings).toEqual({
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
      ganalytics: { enable: false },
    });
    expect(payload.categories).toEqual(["test"]);
    expect(payload.custom_args).toEqual({ template: "test" });
  });

  it("passes the sandbox flag through to SendGrid", async () => {
    for (const sandbox of [true, false]) {
      const fetchMock = okFetch();
      await sendEmail(INPUT, { env: { ...ENV, sandbox }, fetch: fetchMock });
      expect(sentPayload(fetchMock).mail_settings.sandbox_mode.enable).toBe(sandbox);
    }
  });

  it("returns sandbox status 200 as a success", async () => {
    const result = await sendEmail(INPUT, { env: { ...ENV, sandbox: true }, fetch: okFetch(200) });
    expect(result).toMatchObject({ status: 200, sandbox: true });
  });

  it("rejects malformed recipient and reply-to addresses before sending", async () => {
    const bad = [
      { ...INPUT, to: "a@b.com\r\nbcc:c@d.com" },
      { ...INPUT, to: "nope" },
      { ...INPUT, to: "" },
      { ...INPUT, replyTo: { email: "office@" } },
    ];
    for (const input of bad) {
      const fetchMock = okFetch();
      const err = await sendError(sendEmail(input, { env: ENV, fetch: fetchMock }));
      expect(err.kind).toBe("invalid_input");
      expect(err.message).not.toContain("bcc");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("never exposes SendGrid's response body when it rejects a send", async () => {
    const body = JSON.stringify({ errors: [{ message: "secret shelby@example.com" }] });
    const fetchMock = vi.fn(async () => new Response(body, { status: 400 }));
    const err = await sendError(sendEmail(INPUT, { env: ENV, fetch: fetchMock }));

    expect(err.kind).toBe("provider_rejected");
    expect(err.status).toBe(400);
    expect(String(err)).not.toContain("secret");
    expect(String(err)).not.toContain("shelby@example.com");
  });

  it("maps a failed request to a network error without the original message", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET https://api.sendgrid.com Bearer SG.test-key");
    });
    const err = await sendError(sendEmail(INPUT, { env: ENV, fetch: fetchMock }));

    expect(err.kind).toBe("network");
    expect(err.message).not.toContain("SG.test-key");
  });

  it("gives up on a hung request after the timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const err = await sendError(sendEmail(INPUT, { env: ENV, fetch: fetchMock, timeoutMs: 10 }));
    expect(err.kind).toBe("network");
  });
});

describe("buildMailPayload display names", () => {
  it("collapses a practice name to one safe line ending in 'via Minted Panel'", () => {
    const payload = buildMailPayload({ ...INPUT, practiceName: 'Ac"me\r\nBcc: x' }, ENV);
    const name: string = payload.from.name;

    expect(name).toBe("Acme Bcc: x via Minted Panel");
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("keeps the suffix when a long practice name is truncated", () => {
    const payload = buildMailPayload({ ...INPUT, practiceName: "A".repeat(200) }, ENV);
    expect(payload.from.name.endsWith(" via Minted Panel")).toBe(true);
    expect(payload.from.name.length).toBeLessThanOrEqual(64);
  });

  it("falls back to the configured sender name, cleaned the same way", () => {
    const env = { ...ENV, fromName: 'Minted\u0085 "Panel"\r\n' };
    const payload = buildMailPayload({ ...INPUT, practiceName: "  " }, env);
    expect(payload.from.name).toBe("Minted Panel");
  });

  it("never sends an empty sender name", () => {
    const payload = buildMailPayload({ ...INPUT, practiceName: "" }, { ...ENV, fromName: '"<>' });
    expect(payload.from.name).toBe("Minted Panel");
  });

  it("never splits an emoji when truncating", () => {
    const payload = buildMailPayload({ ...INPUT, practiceName: "A".repeat(46) + "\u{1F600}" }, ENV);
    expect(payload.from.name).toBe("A".repeat(46) + "\u{1F600} via Minted Panel");
  });

  it("cleans the reply-to name", () => {
    const payload = buildMailPayload(
      { ...INPUT, replyTo: { email: "office@ssr.example.com", name: "SSR <Office>\r\nX" } },
      ENV,
    );
    expect(payload.reply_to).toEqual({ email: "office@ssr.example.com", name: "SSR Office X" });
  });

  it("escapes template data in html and keeps the subject on one line", () => {
    const payload = buildMailPayload({ ...INPUT, data: { practiceName: "<script>\nx" } }, ENV);
    const html = payload.content[1].value;

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(payload.subject).not.toMatch(/[\r\n]/);
  });
});

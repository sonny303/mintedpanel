import { describe, expect, it } from "vitest";
import type { FollowUpDigestEmailData, FollowUpDigestRow } from "@/lib/followUpDigest";
import { NOTIFICATION_TEMPLATES } from "@/lib/notificationTemplates";
import { TEMPLATES } from "./templates.ts";

describe("provider_invitation", () => {
  const email = TEMPLATES.provider_invitation({
    practiceName: "Shelby <Sports> Rehab",
    firstName: 'An"ita',
    link: "https://staging.example.test/intake/abc_-123",
  });

  it("puts the link in both parts and escapes names in the html", () => {
    expect(email.text).toContain("https://staging.example.test/intake/abc_-123");
    expect(email.html).toContain('href="https://staging.example.test/intake/abc_-123"');
    expect(email.html).toContain("Shelby &lt;Sports&gt; Rehab");
    expect(email.html).toContain("An&quot;ita");
    expect(email.html).not.toContain("<Sports>");
  });

  it("lists the have-ready items and sends no placeholder copy", () => {
    expect(email.subject).toBe("Welcome to Shelby <Sports> Rehab: your credentialing form");
    expect(email.text).toContain("- Your PECOS login (username and password)");
    expect(email.text + email.html).not.toMatch(/\[|placeholder/i);
  });
});

describe("intake_code", () => {
  it("shows the code and its 10-minute expiry, with no link", () => {
    const email = TEMPLATES.intake_code({ practiceName: "Shelby", code: "012345" });
    expect(email.subject).toBe("Your sign-in code for Shelby");
    expect(email.subject).not.toContain("012345");
    expect(email.text).toContain("012345");
    expect(email.text).toContain("10 minutes");
    expect(email.html).not.toContain("href");
  });
});

// MINT-108: the daily follow-up digest, one coordinator's own rows.
describe("followup_digest_daily", () => {
  const row = (overrides: Partial<FollowUpDigestRow> = {}): FollowUpDigestRow => ({
    caseNumber: 1071,
    caseLink: "https://app.example.test/cases/5f0c8a1e-0000-4000-8000-000000000001",
    providerName: "Jane Smith",
    payerName: "Aetna",
    dueDate: "2026-10-28",
    status: "overdue",
    ...overrides,
  });
  const base: FollowUpDigestEmailData = {
    practiceName: "Shelby Rehab",
    recipientFirstName: "Anita",
    digestDate: "2026-10-31",
    workQueueLink: "https://app.example.test/work",
    followUps: {
      rows: [row(), row({ caseNumber: 1080, status: "due_today", dueDate: "2026-10-31" })],
      more: 0,
      overdue: 1,
      dueToday: 1,
    },
  };

  it("lists each row with its case link, provider, payer, due date and status", () => {
    const email = TEMPLATES.followup_digest_daily(base);
    expect(email.subject).toBe("Your follow-ups for Oct 31, 2026: 1 overdue, 1 due today");
    expect(email.html).toContain(
      '<a href="https://app.example.test/cases/5f0c8a1e-0000-4000-8000-000000000001">C-1071</a>',
    );
    expect(email.html).toContain(
      "<td>Jane Smith</td><td>Aetna</td><td>Oct 28, 2026</td><td>Overdue</td>",
    );
    expect(email.html).toContain("<td>Oct 31, 2026</td><td>Due today</td>");
    expect(email.html).toContain("<p>Hi Anita,</p>");
    expect(email.html).toContain("<h3>Your follow-ups</h3><p>1 overdue, 1 due today.</p>");
    expect(email.html).toContain('<a href="https://app.example.test/work">Open Work</a>');
  });

  it("has a plain-text part with the same rows and links", () => {
    const { text } = TEMPLATES.followup_digest_daily(base);
    expect(text).toContain("Hi Anita,");
    expect(text).toContain("YOUR FOLLOW-UPS (1 overdue, 1 due today)");
    expect(text).toContain(
      "- C-1071 · Jane Smith · Aetna · due Oct 28, 2026 · Overdue\n  https://app.example.test/cases/5f0c8a1e-0000-4000-8000-000000000001",
    );
    expect(text).toContain("- C-1080 · Jane Smith · Aetna · due Oct 31, 2026 · Due today\n");
    expect(text).toContain("Open Work: https://app.example.test/work");
    expect(text).toContain("Shelby Rehab via Minted Panel");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("has no at-risk line, no Unassigned section and no team table (Sowmya, Oct 30)", () => {
    const { html, text } = TEMPLATES.followup_digest_daily(base);
    for (const part of [html, text]) {
      expect(part).not.toMatch(/at risk|on record|submitted \d+ days? ago/i);
      expect(part).not.toMatch(/unassigned/i);
      expect(part).not.toMatch(/\bteam\b|coordinator/i);
    }
    expect(html).not.toContain("<h3>Unassigned</h3>");
    expect(html).not.toContain("<h3>Team</h3>");
  });

  it("HTML-escapes every name and link, and keeps the text part on one line per name", () => {
    const hostile: FollowUpDigestEmailData = {
      ...base,
      practiceName: 'Shelby <b>"Rehab"</b>',
      recipientFirstName: "<img src=x onerror=alert(1)>",
      workQueueLink: 'https://app.example.test/work?a="b"&c=<d>',
      followUps: {
        ...base.followUps,
        rows: [
          row({
            providerName: "<script>alert('p')</script>",
            payerName: "Payer & Sons <Health>",
            caseLink: 'https://app.example.test/cases/x"><script>',
          }),
          row({ providerName: "Line\r\nBreak" }),
        ],
      },
    };
    const email = TEMPLATES.followup_digest_daily(hostile);
    for (const raw of ["<script>", "<img", "<b>", "<Health>", '"><script>', "<d>"]) {
      expect(email.html).not.toContain(raw);
    }
    expect(email.html).toContain("&lt;script&gt;alert(&#39;p&#39;)&lt;/script&gt;");
    expect(email.html).toContain("Payer &amp; Sons &lt;Health&gt;");
    expect(email.html).toContain("Hi &lt;img src=x onerror=alert(1)&gt;,");
    expect(email.html).toContain('href="https://app.example.test/cases/x&quot;&gt;&lt;script&gt;"');
    expect(email.html).toContain("Shelby &lt;b&gt;&quot;Rehab&quot;&lt;/b&gt; via Minted Panel");
    expect(email.text).toContain("Line Break");
  });

  it("says how many more are in Work when the list is capped, and greets without a name", () => {
    const email = TEMPLATES.followup_digest_daily({
      ...base,
      recipientFirstName: null,
      followUps: { rows: [row()], more: 3, overdue: 4, dueToday: 0 },
    });
    expect(email.subject).toBe("Your follow-ups for Oct 31, 2026: 4 overdue, 0 due today");
    expect(email.html).toContain("<p>Hi,</p>");
    expect(email.html).toContain("<p>And 3 more follow-ups in Work.</p>");
    expect(email.text).toContain("YOUR FOLLOW-UPS (4 overdue, 0 due today)");
    expect(email.text).toContain("And 3 more follow-ups in Work.");
  });

  it("HTML-escapes a date it cannot read instead of printing it raw", () => {
    const { html } = TEMPLATES.followup_digest_daily({
      ...base,
      digestDate: "<b>soon</b>",
      followUps: { ...base.followUps, rows: [row({ dueDate: '<img src=x onerror="1">' })] },
    });
    expect(html).not.toContain("<b>soon</b>");
    expect(html).not.toContain("<img");
    expect(html).toContain("due on &lt;b&gt;soon&lt;/b&gt;,");
    expect(html).toContain("<td>&lt;img src=x onerror=&quot;1&quot;&gt;</td>");
  });

  it("keeps provider and payer names out of the subject", () => {
    const { subject } = TEMPLATES.followup_digest_daily(base);
    expect(subject).not.toContain("Jane Smith");
    expect(subject).not.toContain("Aetna");
    expect(subject).not.toContain("C-1071");
  });

  it("is registered under every follow-up digest key the catalog offers", () => {
    const digestKeys = NOTIFICATION_TEMPLATES.filter((t) => t.purpose === "followup_digest").map(
      (t) => t.key,
    );
    expect(digestKeys).toEqual(["followup_digest_daily"]);
    for (const key of digestKeys) expect(Object.hasOwn(TEMPLATES, key)).toBe(true);
  });
});

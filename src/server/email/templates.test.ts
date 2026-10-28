import { describe, expect, it } from "vitest";
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

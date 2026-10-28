// The closed registry of emails Minted Panel sends. A caller names a template
// and supplies its typed data; it can never pass a free-form subject or body.
// sendgrid.ts consumes only the rendered { subject, text, html }, so moving
// the wording out of git later changes this file and nothing else.

export interface TemplateDataMap {
  test: { practiceName: string };
  provider_invitation: { practiceName: string; firstName: string; link: string };
  intake_code: { practiceName: string; code: string };
}

// Canvas board 2. The canvas's reassurance line is placeholder copy (Q3), so
// it is left out rather than sent to a real inbox.
const HAVE_READY = [
  "Your NPI",
  "Your state license number and expiration date",
  "Your CAQH ID",
  "Your CAQH ProView login (username and password)",
  "Your PECOS login (username and password)",
  "Your mobile number and home address",
  "Your CV and a copy of your state license",
];

export type TemplateKey = keyof TemplateDataMap;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Names inside the text/plain part: one line, no control characters.
/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
/* eslint-enable no-control-regex */

function plainInline(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const TEMPLATES: { [K in TemplateKey]: (data: TemplateDataMap[K]) => RenderedEmail } = {
  test: ({ practiceName }) => ({
    subject: `Test email from ${practiceName}`,
    text: `This is a test email from ${plainInline(practiceName)} via Minted Panel.\n\nIf you received it, sending works.`,
    html: `<p>This is a test email from <strong>${escapeHtml(practiceName)}</strong> via Minted Panel.</p><p>If you received it, sending works.</p>`,
  }),
  provider_invitation: ({ practiceName, firstName, link }) => {
    const intro =
      "Welcome aboard. Before you can see patients under our payer contracts, we need your credentialing details. You can do it in one sitting, or save and finish later.";
    const codeLine = "We'll send a 6-digit code to this address after you tap the button.";
    return {
      subject: `Welcome to ${practiceName}: your credentialing form`,
      text: [
        `Hi ${plainInline(firstName)},`,
        intro,
        "Make sure you have these on hand before you start:",
        HAVE_READY.map((item) => `- ${item}`).join("\n"),
        `Get started: ${link}`,
        codeLine,
        "Questions? Just reply to this email.",
        `Thanks,\n${plainInline(practiceName)}`,
      ].join("\n\n"),
      html: [
        `<p>Hi ${escapeHtml(firstName)},</p>`,
        `<p>${intro}</p>`,
        "<p>Make sure you have these on hand before you start:</p>",
        `<ul>${HAVE_READY.map((item) => `<li>${item}</li>`).join("")}</ul>`,
        `<p><a href="${escapeHtml(link)}">Get started</a></p>`,
        `<p>${codeLine}</p>`,
        "<p>Questions? Just reply to this email.</p>",
        `<p>Thanks,<br>${escapeHtml(practiceName)}</p>`,
      ].join(""),
    };
  },
  intake_code: ({ practiceName, code }) => ({
    // The code stays out of the subject, so lock-screen previews don't show it.
    subject: `Your sign-in code for ${practiceName}`,
    text: `Your code is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for a code, you can ignore this email.`,
    html: `<p>Your code is <strong>${escapeHtml(code)}</strong>. It expires in 10 minutes.</p><p>If you didn't ask for a code, you can ignore this email.</p>`,
  }),
};

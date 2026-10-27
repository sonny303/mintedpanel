// The closed registry of emails Minted Panel sends. A caller names a template
// and supplies its typed data; it can never pass a free-form subject or body.
// sendgrid.ts consumes only the rendered { subject, text, html }, so moving
// the wording out of git later changes this file and nothing else.

export interface TemplateDataMap {
  test: { practiceName: string };
}

export type TemplateKey = keyof TemplateDataMap;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
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
    text: `This is a test email from ${practiceName} via Minted Panel.\n\nIf you received it, sending works.`,
    html: `<p>This is a test email from <strong>${escapeHtml(practiceName)}</strong> via Minted Panel.</p><p>If you received it, sending works.</p>`,
  }),
};

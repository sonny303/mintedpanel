// The closed registry of emails Minted Panel sends. A caller names a template
// and supplies its typed data; it can never pass a free-form subject or body.
// sendgrid.ts consumes only the rendered { subject, text, html }, so moving
// the wording out of git later changes this file and nothing else.
//
// A type-only import is erased before Node runs the email CLI, so it keeps
// this module's relative-`.ts`-only rule.
import type {
  FollowUpDigestEmailData,
  FollowUpDigestRow,
  FollowUpDigestSection,
} from "../../lib/followUpDigest.ts";

export interface TemplateDataMap {
  test: { practiceName: string };
  provider_invitation: { practiceName: string; firstName: string; link: string };
  intake_code: { practiceName: string; code: string };
  // MINT-108: the daily coordinator follow-up digest. The key is the
  // catalog's (src/lib/notificationTemplates.ts); the data is built by
  // planFollowUpDigests (src/lib/followUpDigest.ts).
  followup_digest_daily: FollowUpDigestEmailData;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 31, 2026" (the app's fmtDate spelling) for a YYYY-MM-DD date, read as a
// calendar date so no time zone can move it. Anything else comes back as it
// was, HTML-escaped, so the result is safe in either part.
function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const month = MONTHS[m - 1];
  return month && Number.isInteger(y) && Number.isInteger(d)
    ? `${month} ${d}, ${y}`
    : escapeHtml(iso);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sectionSummary(section: FollowUpDigestSection): string {
  return `${section.overdue} overdue, ${section.dueToday} due today`;
}

// The status alone. An at-risk line ("submitted N days ago") waits for
// MINT-111, which gives payers a decision time from their closed cases.
function statusLabel(row: FollowUpDigestRow): string {
  return row.status === "overdue" ? "Overdue" : "Due today";
}

function rowText(row: FollowUpDigestRow): string {
  const parts = [
    `C-${row.caseNumber}`,
    plainInline(row.providerName),
    plainInline(row.payerName),
    `due ${formatDay(row.dueDate)}`,
    statusLabel(row),
  ];
  return `- ${parts.join(" · ")}\n  ${row.caseLink}`;
}

function rowHtml(row: FollowUpDigestRow): string {
  return [
    "<tr>",
    `<td><a href="${escapeHtml(row.caseLink)}">C-${row.caseNumber}</a></td>`,
    `<td>${escapeHtml(row.providerName)}</td>`,
    `<td>${escapeHtml(row.payerName)}</td>`,
    `<td>${formatDay(row.dueDate)}</td>`,
    `<td>${statusLabel(row)}</td>`,
    "</tr>",
  ].join("");
}

const ROW_HEADER =
  '<tr><th align="left">Case</th><th align="left">Provider</th><th align="left">Payer</th><th align="left">Follow-up due</th><th align="left">Status</th></tr>';

function moreLine(section: FollowUpDigestSection): string | null {
  return section.more > 0
    ? `And ${plural(section.more, "more follow-up", "more follow-ups")} in Work.`
    : null;
}

// One coordinator's own follow-ups (MINT-108). Nobody else gets a copy: the
// digest has no cc list, and unassigned follow-ups go to no one.
function followUpDigest(data: FollowUpDigestEmailData): RenderedEmail {
  const day = formatDay(data.digestDate);
  const section = data.followUps;
  const more = moreLine(section);
  const name = data.recipientFirstName;
  const practice = data.practiceName.trim();
  // `day` is already HTML-safe (formatDay), so the intro is not escaped again.
  const intro = `Here are your follow-ups due on ${day}, and the ones that are overdue.`;
  const footer =
    "You get this email because your organization turned on the daily follow-up digest.";
  return {
    subject: `Your follow-ups for ${day}: ${sectionSummary(section)}`,
    text: [
      name ? `Hi ${plainInline(name)},` : "Hi,",
      intro,
      [
        `YOUR FOLLOW-UPS (${sectionSummary(section)})`,
        ...section.rows.map(rowText),
        ...(more ? [more] : []),
      ].join("\n"),
      `Open Work: ${data.workQueueLink}`,
      footer,
      ...(practice ? [`${plainInline(practice)} via Minted Panel`] : []),
    ].join("\n\n"),
    html: [
      `<p>${name ? `Hi ${escapeHtml(name)},` : "Hi,"}</p>`,
      `<p>${intro}</p>`,
      "<h3>Your follow-ups</h3>",
      `<p>${escapeHtml(sectionSummary(section))}.</p>`,
      `<table cellpadding="4" cellspacing="0">${ROW_HEADER}${section.rows.map(rowHtml).join("")}</table>`,
      ...(more ? [`<p>${escapeHtml(more)}</p>`] : []),
      `<p><a href="${escapeHtml(data.workQueueLink)}">Open Work</a></p>`,
      `<p>${escapeHtml(footer)}</p>`,
      ...(practice ? [`<p>${escapeHtml(practice)} via Minted Panel</p>`] : []),
    ].join(""),
  };
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
  followup_digest_daily: followUpDigest,
};

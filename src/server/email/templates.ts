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
// calendar date so no time zone can move it.
function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const month = MONTHS[m - 1];
  return month && Number.isInteger(y) && Number.isInteger(d) ? `${month} ${d}, ${y}` : iso;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sectionSummary(section: FollowUpDigestSection): string {
  const parts = [`${section.overdue} overdue`, `${section.dueToday} due today`];
  if (section.atRisk > 0) parts.push(`${section.atRisk} at risk`);
  return parts.join(", ");
}

function statusLabel(row: FollowUpDigestRow): string {
  return row.status === "overdue" ? "Overdue" : "Due today";
}

function atRiskText(row: FollowUpDigestRow): string | null {
  if (!row.atRisk) return null;
  const { daysSinceSubmission, avgDecisionDays } = row.atRisk;
  return `At risk: ${plural(daysSinceSubmission, "day", "days")} since submission; this payer usually decides in ${plural(avgDecisionDays, "day", "days")}`;
}

function rowText(row: FollowUpDigestRow): string {
  const parts = [
    `C-${row.caseNumber}`,
    plainInline(row.providerName),
    plainInline(row.payerName),
    `due ${formatDay(row.dueDate)}`,
    statusLabel(row),
  ];
  const risk = atRiskText(row);
  if (risk) parts.push(risk);
  return `- ${parts.join(" · ")}\n  ${row.caseLink}`;
}

function rowHtml(row: FollowUpDigestRow): string {
  const risk = atRiskText(row);
  return [
    "<tr>",
    `<td><a href="${escapeHtml(row.caseLink)}">C-${row.caseNumber}</a></td>`,
    `<td>${escapeHtml(row.providerName)}</td>`,
    `<td>${escapeHtml(row.payerName)}</td>`,
    `<td>${formatDay(row.dueDate)}</td>`,
    `<td>${statusLabel(row)}${risk ? `<br>${escapeHtml(risk)}` : ""}</td>`,
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

interface DigestBlock {
  text: string;
  html: string;
}

function rowsBlock(
  title: string,
  intro: string | null,
  section: FollowUpDigestSection,
): DigestBlock {
  const more = moreLine(section);
  return {
    text: [
      `${title.toUpperCase()} (${sectionSummary(section)})`,
      ...(intro ? [intro] : []),
      ...section.rows.map(rowText),
      ...(more ? [more] : []),
    ].join("\n"),
    html: [
      `<h3>${escapeHtml(title)}</h3>`,
      `<p>${escapeHtml(sectionSummary(section))}.${intro ? ` ${escapeHtml(intro)}` : ""}</p>`,
      `<table cellpadding="4" cellspacing="0">${ROW_HEADER}${section.rows.map(rowHtml).join("")}</table>`,
      ...(more ? [`<p>${escapeHtml(more)}</p>`] : []),
    ].join(""),
  };
}

function followUpDigest(data: FollowUpDigestEmailData): RenderedEmail {
  const day = formatDay(data.digestDate);
  const blocks: DigestBlock[] = [];
  if (data.own.overdue + data.own.dueToday > 0) {
    blocks.push(rowsBlock("Your follow-ups", null, data.own));
  }
  if (data.unassigned.overdue + data.unassigned.dueToday > 0) {
    blocks.push(
      rowsBlock(
        "Unassigned",
        "Cases with no coordinator, or whose coordinator is no longer a member.",
        data.unassigned,
      ),
    );
  }
  if (data.team.length > 0) {
    blocks.push({
      text: [
        "TEAM",
        ...data.team.map(
          (row) =>
            `- ${plainInline(row.coordinatorName)}: ${row.overdue} overdue, ${row.dueToday} due today, ${row.atRisk} at risk`,
        ),
      ].join("\n"),
      html: [
        "<h3>Team</h3>",
        '<table cellpadding="4" cellspacing="0">',
        '<tr><th align="left">Coordinator</th><th align="left">Overdue</th><th align="left">Due today</th><th align="left">At risk</th></tr>',
        ...data.team.map(
          (row) =>
            `<tr><td>${escapeHtml(row.coordinatorName)}</td><td>${row.overdue}</td><td>${row.dueToday}</td><td>${row.atRisk}</td></tr>`,
        ),
        "</table>",
      ].join(""),
    });
  }

  const name = data.recipientFirstName;
  const practice = data.practiceName.trim();
  const intro = `Here are the follow-ups due on ${day}, and the ones that are overdue.`;
  const footer =
    "You get this email because your organization turned on the daily follow-up digest.";
  const ownTotal = data.own.overdue + data.own.dueToday;
  return {
    subject:
      ownTotal > 0
        ? `Your follow-ups for ${day}: ${data.own.overdue} overdue, ${data.own.dueToday} due today`
        : `Follow-up digest for ${day}`,
    text: [
      name ? `Hi ${plainInline(name)},` : "Hi,",
      intro,
      ...blocks.map((block) => block.text),
      `Open Work: ${data.workQueueLink}`,
      footer,
      ...(practice ? [`${plainInline(practice)} via Minted Panel`] : []),
    ].join("\n\n"),
    html: [
      `<p>${name ? `Hi ${escapeHtml(name)},` : "Hi,"}</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      ...blocks.map((block) => block.html),
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

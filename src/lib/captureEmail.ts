// Capture-link email template (redesign E0.5, enabler TE-5).
//
// BD-2 default: Stage 0 has NO send infrastructure — this pure function produces
// the copy-able subject + body the operator sends manually. If real transactional
// sending is chosen later, this same output is the payload (no rework). Pure and
// unit-tested on content so the F0.5.4 requirements can't silently drift:
// states the org, addresses the recipient by name, explains intent + the expiry
// window, says plainly that NO login will be created, and gives an operator-
// contact fallback.
import { fmtDateTime } from "@/lib/format";

export interface CaptureEmailInput {
  orgName: string;
  recipientName: string;
  captureUrl: string;
  /** ISO timestamp the link expires (issue + 72h). */
  expiresAt: string;
  /** Where the recipient can reach the operator if the link doesn't work. */
  operatorContact: string;
}

export interface CaptureEmail {
  subject: string;
  body: string;
}

export function renderCaptureEmail(input: CaptureEmailInput): CaptureEmail {
  const { orgName, recipientName, captureUrl, expiresAt, operatorContact } = input;
  const subject = `Action needed: confirm ${orgName}'s details`;
  const body = [
    `Hi ${recipientName},`,
    "",
    `We're setting up ${orgName} with Minted Panel and need you to confirm a few ` +
      `organization details. Please use your secure link below:`,
    "",
    captureUrl,
    "",
    `This link is unique to you and expires on ${fmtDateTime(expiresAt)} (or once ` +
      `you complete the form, whichever comes first).`,
    "",
    `No account or password will be created — the link takes you straight to a short form.`,
    "",
    `If the link has expired or doesn't work, just reply to this email or contact ${operatorContact} ` +
      `and we'll send you a new one.`,
    "",
    "Thank you,",
    "The Minted Panel team",
  ].join("\n");
  return { subject, body };
}

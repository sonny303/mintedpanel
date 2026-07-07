import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  channelForTouchType,
  isValidOutcomeForChannel,
  outcomeLabel,
  OUTCOMES_BY_CHANNEL,
  REFERENCE_NUMBER_OUTCOME,
  touchTypeForChannel,
  type Channel,
} from "./touchOutcomes";

// The locked Story 3 taxonomy (label lists per channel). If product edits the
// taxonomy in touchOutcomes.ts, update this table in the same change.
const EXPECTED: Record<Channel, string[]> = {
  email: ["Sent", "Reply received", "Info requested", "Approved", "Denied", "No response yet"],
  portal: [
    "Submitted",
    "Draft saved",
    "Under review",
    "Info requested",
    "Approved",
    "Denied",
    "Submission error",
  ],
  phone: [
    "Spoke with rep",
    "Left voicemail",
    "No answer",
    "Callback scheduled",
    "Got reference number",
    "Directed to portal or email",
  ],
  fax: ["Sent", "Confirmed received", "Failed", "No confirmation"],
  mail: ["Sent", "Delivered", "Returned", "No response"],
};

describe("touchOutcomes taxonomy", () => {
  it("matches the locked per-channel label lists", () => {
    for (const channel of Object.keys(EXPECTED) as Channel[]) {
      expect(OUTCOMES_BY_CHANNEL[channel].map((o) => o.label)).toEqual(EXPECTED[channel]);
    }
  });

  it("maps Phone to the 'call' touch_type and back", () => {
    expect(touchTypeForChannel("phone")).toBe("call");
    expect(channelForTouchType("call")).toBe("phone");
    for (const { channel, touchType } of CHANNELS) {
      expect(touchTypeForChannel(channel)).toBe(touchType);
      expect(channelForTouchType(touchType)).toBe(channel);
    }
  });

  it("exposes 'Got reference number' only on the Phone channel", () => {
    expect(isValidOutcomeForChannel("phone", REFERENCE_NUMBER_OUTCOME)).toBe(true);
    for (const channel of ["email", "portal", "fax", "mail"] as Channel[]) {
      expect(isValidOutcomeForChannel(channel, REFERENCE_NUMBER_OUTCOME)).toBe(false);
    }
  });

  it("rejects an outcome that does not belong to a channel", () => {
    // "Submitted" is a Portal outcome, never a Phone one.
    expect(isValidOutcomeForChannel("portal", "submitted")).toBe(true);
    expect(isValidOutcomeForChannel("phone", "submitted")).toBe(false);
  });

  it("labels known codes and falls back to the raw code", () => {
    expect(outcomeLabel("got_reference_number")).toBe("Got reference number");
    expect(outcomeLabel("submitted")).toBe("Submitted");
    // legacy code still labelled
    expect(outcomeLabel("left_voicemail")).toBe("Left voicemail");
    expect(outcomeLabel("some_future_code")).toBe("some_future_code");
    expect(outcomeLabel(null)).toBe("");
  });
});

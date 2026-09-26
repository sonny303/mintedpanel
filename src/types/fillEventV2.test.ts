import { describe, expect, it } from "vitest";
import { isFillEventV2Metadata, type FillEventV2FieldOutcome } from "./fillEventV2";

const MAP_ID = "11111111-2222-4333-8444-555555555555";
const TARGET_KEY = "t_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FRAME_KEY = "f_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STEP_KEY = "s_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function field(overrides: Partial<FillEventV2FieldOutcome> = {}): FillEventV2FieldOutcome {
  return {
    mapId: MAP_ID,
    targetKey: TARGET_KEY,
    frameKey: FRAME_KEY,
    stepKey: STEP_KEY,
    attempted: true,
    outcome: "verified",
    reasonCode: null,
    ...overrides,
  };
}

function metadata(fieldOutcomes: FillEventV2FieldOutcome[]) {
  return {
    schemaVersion: 2,
    fieldsAttempted: fieldOutcomes.filter((item) => item.attempted).length,
    fieldsVerified: fieldOutcomes.filter((item) => item.outcome === "verified").length,
    fieldsRejected: fieldOutcomes.filter((item) => item.outcome === "write_rejected").length,
    fieldOutcomes,
  };
}

describe("fill event V2 metadata contract", () => {
  it("accepts a metadata-only verified result with reconciled counts", () => {
    expect(isFillEventV2Metadata(metadata([field()]))).toBe(true);
  });

  it("accepts an unverified setter attempt without claiming verification", () => {
    expect(
      isFillEventV2Metadata(
        metadata([field({ outcome: "unverified", reasonCode: "readback_unavailable" })]),
      ),
    ).toBe(true);
  });

  it("accepts only fully qualified not-found evidence", () => {
    expect(
      isFillEventV2Metadata(
        metadata([
          field({
            attempted: false,
            outcome: "not_found",
            reasonCode: "target_missing",
            notFoundEvidence: {
              stepKnown: true,
              frameAccessible: true,
              pageSettled: true,
              searchComplete: true,
              targetAbsent: true,
            },
          }),
        ]),
      ),
    ).toBe(true);
  });

  it("rejects a not-found claim without map identity and complete evidence", () => {
    expect(
      isFillEventV2Metadata(
        metadata([
          field({
            mapId: null,
            attempted: false,
            outcome: "not_found",
            reasonCode: "target_missing",
            notFoundEvidence: {
              stepKnown: true,
              frameAccessible: true,
              pageSettled: true,
              searchComplete: true,
              targetAbsent: false,
            } as never,
          }),
        ]),
      ),
    ).toBe(false);
  });

  it("rejects inflated counters, unknown versions, and unbounded keys", () => {
    const valid = metadata([field()]);
    expect(isFillEventV2Metadata({ ...valid, fieldsVerified: 2 })).toBe(false);
    expect(isFillEventV2Metadata({ ...valid, schemaVersion: 99 })).toBe(false);
    expect(isFillEventV2Metadata(metadata([field({ targetKey: "t_member-name" })]))).toBe(false);
  });

  it("rejects duplicate map-target-frame identities and value-bearing keys", () => {
    expect(isFillEventV2Metadata(metadata([field(), field()]))).toBe(false);
    expect(
      isFillEventV2Metadata({
        ...metadata([field()]),
        actualValue: "synthetic-secret",
      }),
    ).toBe(false);
  });

  it("rejects duplicate identities when UUID and opaque-key casing differs", () => {
    const first = field();
    const casingVariant = field({
      mapId: MAP_ID.toUpperCase(),
      targetKey: TARGET_KEY.toUpperCase(),
      frameKey: FRAME_KEY.toUpperCase(),
    });
    expect(isFillEventV2Metadata(metadata([first, casingVariant]))).toBe(false);
  });

  it("requires map identity for verified outcomes and permits preflight format rejection", () => {
    expect(isFillEventV2Metadata(metadata([field({ mapId: null })]))).toBe(false);
    expect(
      isFillEventV2Metadata(
        metadata([
          field({
            attempted: false,
            outcome: "needs_value",
            reasonCode: "invalid_format",
          }),
        ]),
      ),
    ).toBe(true);
  });
});

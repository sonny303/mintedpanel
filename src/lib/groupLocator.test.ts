import { describe, expect, it } from "vitest";
import {
  GROUP_AMBIGUOUS_TIN_REASON,
  matchGroupLocator,
  type GroupMatchCandidate,
} from "./groupLocator";

const LLC: GroupMatchCandidate = {
  id: "llc",
  name: "BEST Physical Therapy, LLC",
  tin: "001234567",
  npiType2: "1999999994",
};
const DBA: GroupMatchCandidate = {
  id: "dba",
  name: "BEST Physical Therapy, LLC (dba BEST Health Wellness Performance)",
  tin: "00-1234567",
  npiType2: "1999999992",
};
const OTHER: GroupMatchCandidate = {
  id: "other",
  name: "BEST Physical Therapy and Wellness Inc",
  tin: "007654321",
  npiType2: "1999999993",
};
const GROUPS = [LLC, DBA, OTHER];

describe("matchGroupLocator", () => {
  it("uses an exact name before TIN", () => {
    const result = matchGroupLocator(
      { name: "BEST Physical Therapy, LLC", tin: "000000000", npiType2: null },
      GROUPS,
    );
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.group.id).toBe("llc");
      expect(result.note).toMatch(/TIN in the file differs/);
    }
  });

  it("falls through to a unique TIN when the name misses", () => {
    const result = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "00-7654321", npiType2: null },
      GROUPS,
    );
    expect(result).toMatchObject({ status: "matched", group: { id: "other" }, note: null });
  });

  it("breaks a shared TIN with the group's Type 2 NPI", () => {
    const llc = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "00-1234567", npiType2: "1999999994" },
      GROUPS,
    );
    const dba = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "001234567", npiType2: "1999-999-992" },
      GROUPS,
    );
    expect(llc).toMatchObject({ status: "matched", group: { id: "llc" } });
    expect(dba).toMatchObject({ status: "matched", group: { id: "dba" } });
  });

  it("refuses to guess when a shared TIN has no group_npi or the NPI misses", () => {
    const open = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "001234567", npiType2: null },
      GROUPS,
    );
    expect(open).toEqual({
      status: "ambiguous",
      column: "group_npi",
      reason: GROUP_AMBIGUOUS_TIN_REASON,
    });
    const miss = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "001234567", npiType2: "1111111111" },
      GROUPS,
    );
    expect(miss.status).toBe("none");
    if (miss.status === "none") expect(miss.column).toBe("group_npi");
  });

  it("rejects a contradictory group_npi on an otherwise unique TIN", () => {
    const result = matchGroupLocator(
      { name: "B.E.S.T. Physical Therapy", tin: "00-7654321", npiType2: "1999999994" },
      GROUPS,
    );
    expect(result.status).toBe("none");
    if (result.status === "none") expect(result.column).toBe("group_npi");
  });

  it("keeps the not-found note when nothing matches", () => {
    const result = matchGroupLocator(
      { name: "No Such Group", tin: "000000000", npiType2: null },
      GROUPS,
    );
    expect(result.status).toBe("none");
    if (result.status === "none")
      expect(result.reason).toContain('Group "No Such Group" not found');
  });
});

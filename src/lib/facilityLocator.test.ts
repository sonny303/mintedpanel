import { describe, expect, it } from "vitest";
import {
  FACILITY_AMBIGUOUS_REASON,
  FACILITY_UNKNOWN_REASON,
  matchFacilityLocator,
  type FacilityLocatorRecord,
} from "./facilityLocator";

function facility(
  id: string,
  name: string,
  street: string,
  city: string,
  state: string,
  zip: string,
  suite: string | null = null,
): FacilityLocatorRecord {
  return { id, name, street, suite, city, state, zip };
}

const BEST: FacilityLocatorRecord[] = [
  facility(
    "hargrove",
    "BEST Physical Therapy - Hargrove",
    "101 Sample Road",
    "Raleigh",
    "NC",
    "27616",
    "Suite 100",
  ),
  facility(
    "connemara",
    "BEST Physical Therapy - Connemara",
    "102 Sample Drive",
    "Cary",
    "NC",
    "27519",
    "Suite 110",
  ),
  facility(
    "towerview",
    "BEST Physical Therapy - Towerview",
    "103 Sample Court",
    "Cary",
    "NC",
    "27513",
  ),
  facility(
    "knightdale",
    "BEST Physical Therapy - Knightdale",
    "104 Sample Court",
    "Knightdale",
    "NC",
    "27545",
    "Suite A",
  ),
  facility(
    "leesville",
    "BEST Physical Therapy - Leesville Rd",
    "105 Sample Rd",
    "Raleigh",
    "NC",
    "27613",
    "STE 129",
  ),
  facility(
    "clayton",
    "BEST Physical Therapy - Clayton",
    "11694 Sample Highway W",
    "Clayton",
    "NC",
    "27520",
  ),
  facility(
    "raeford",
    "BEST Physical Therapy - Raeford",
    "107 Sample Road",
    "Raeford",
    "NC",
    "28376",
  ),
  facility(
    "wilmington",
    "BEST Physical Therapy - Wilmington",
    "108 N Sample Road",
    "Wilmington",
    "NC",
    "28405",
  ),
  facility(
    "convention",
    "BEST Physical Therapy - Convention",
    "109 Sample Dr",
    "Cary",
    "NC",
    "27511",
  ),
  facility(
    "garner",
    "BEST Physical Therapy - Garner",
    "110 Sample Drive East",
    "Garner",
    "NC",
    "27529",
  ),
  facility(
    "fayetteville",
    "BEST Physical Therapy - Fayetteville",
    "111 Sample Dr",
    "Fayetteville",
    "NC",
    "28304",
  ),
  facility("cary", "BEST Physical Therapy - Cary", "112 Sample Dr", "Cary", "NC", "27519"),
  facility(
    "durham",
    "BEST Physical Therapy - Durham",
    "113 W Sample St",
    "Durham",
    "NC",
    "27713",
    "#271",
  ),
  facility(
    "greenville",
    "BEST Physical Therapy - Greenville",
    "114 Sample Drive",
    "Greenville",
    "SC",
    "29607",
  ),
  facility(
    "madison",
    "BEST Physical Therapy - Madison",
    "115 Sample Rd",
    "Madison",
    "WI",
    "53704",
    "Suite 101",
  ),
  facility(
    "fitchburg",
    "BEST Physical Therapy - Fitchburg",
    "116 Sample Rd",
    "Fitchburg",
    "WI",
    "53719",
  ),
  facility(
    "longmont",
    "BEST Physical Therapy - Longmont",
    "117 Sample St",
    "Longmont",
    "CO",
    "80501",
    "#200",
  ),
  facility(
    "springs",
    "BEST Physical Therapy - Colorado Springs",
    "118 Sample Dr",
    "Colorado Springs",
    "CO",
    "80923",
  ),
  facility(
    "cypress",
    "BEST Physical Therapy - Cypress",
    "119 Sample Rd",
    "Cypress",
    "TX",
    "77429",
  ),
  facility("katy", "BEST Physical Therapy - Katy", "120 Sample Rd", "Katy", "TX", "77494"),
  facility(
    "beaverton",
    "BEST Physical Therapy - Beaverton",
    "121 SW Sample St",
    "Beaverton",
    "OR",
    "97005",
  ),
  facility(
    "caldwell",
    "BEST Physical Therapy - VS Caldwell",
    "122 Sample Way",
    "Caldwell",
    "ID",
    "83605",
  ),
];

const ROSTER: Array<[string, string]> = [
  ["101 Sample Road, Suite 100, Raleigh, NC 27616", "hargrove"],
  ["102 Sample Drive, Suite 110, Cary, NC 27519", "connemara"],
  ["103 Sample Court, Cary, NC 27513", "towerview"],
  ["104 Sample Court, Suite A, Knightdale, NC 27545", "knightdale"],
  ["105 Sample Rd STE 129, Raleigh, NC 27613", "leesville"],
  ["11694 Sample Highway W, Clayton NC, 27520", "clayton"],
  ["107 Sample Road, Raeford, NC 28376", "raeford"],
  ["108 N Sample Road, Wilmington, NC 28405", "wilmington"],
  ["109 Sample Dr, Cary, NC 27511", "convention"],
  ["110 Sample Drive East, Garner NC 27529", "garner"],
  ["111 Sample Dr, Fayetteville, NC 28304", "fayetteville"],
  ["112 Sample Dr, Cary, NC 27519", "cary"],
  ["113 W Sample St #271, Durham, NC 27713", "durham"],
  ["114 Sample Drive, Greenville, SC 29607", "greenville"],
  ["115 Sample Rd, Suite 101, Madison, WI 53704", "madison"],
  ["116 Sample Rd, Fitchburg, WI 53719", "fitchburg"],
  ["117 Sample St #200, Longmont, CO 80501", "longmont"],
  ["118 Sample Dr, Colorado Springs, CO 80923", "springs"],
  ["119 Sample Rd, Cypress, TX 77429", "cypress"],
  ["120 Sample Rd, Katy, TX 77494", "katy"],
  ["121 SW Sample St, Beaverton, OR 97005", "beaverton"],
  ["122 Sample Way, Caldwell, ID 83605", "caldwell"],
];

describe("matchFacilityLocator", () => {
  it("resolves every BEST roster address to one facility", () => {
    for (const [cell, id] of ROSTER) {
      expect(matchFacilityLocator(cell, BEST), cell).toEqual({ status: "matched", facilityId: id });
    }
  });

  it("matches an exact name, including case, ahead of any address parse", () => {
    expect(matchFacilityLocator("best physical therapy - hargrove", BEST)).toEqual({
      status: "matched",
      facilityId: "hargrove",
    });
  });

  it("expands street suffixes and still matches when the suite is omitted on a unique street", () => {
    expect(matchFacilityLocator("101 Sample Rd, Raleigh, NC 27616", BEST)).toEqual({
      status: "matched",
      facilityId: "hargrove",
    });
  });

  it("rejects a partial name and an unknown street in a known ZIP", () => {
    expect(matchFacilityLocator("Hargrove", BEST)).toEqual({
      status: "none",
      reason: FACILITY_UNKNOWN_REASON,
    });
    expect(matchFacilityLocator("100 Main Street, Raleigh, NC 27616", BEST)).toEqual({
      status: "none",
      reason: FACILITY_UNKNOWN_REASON,
    });
  });

  it("does not cross-match a street that is a prefix of another", () => {
    const pair = [
      facility("short", "Short", "100 Main St", "Raleigh", "NC", "27616"),
      facility("long", "Long", "100 Main St Annex", "Raleigh", "NC", "27616"),
    ];
    expect(matchFacilityLocator("100 Main St, Raleigh, NC 27616", pair)).toEqual({
      status: "matched",
      facilityId: "short",
    });
    expect(matchFacilityLocator("100 Main Street Annex, Raleigh, NC 27616", pair)).toEqual({
      status: "matched",
      facilityId: "long",
    });
  });

  it("uses the suite unit to split two clinics on the same street and ZIP", () => {
    const pair = [
      facility("a", "A", "100 Main St", "Raleigh", "NC", "27616", "Suite 100"),
      facility("b", "B", "100 Main St", "Raleigh", "NC", "27616", "Suite 200"),
    ];
    expect(matchFacilityLocator("100 Main St, Suite 100, Raleigh, NC 27616", pair)).toEqual({
      status: "matched",
      facilityId: "a",
    });
    expect(matchFacilityLocator("100 Main Street, Ste 200, Raleigh, NC 27616", pair)).toEqual({
      status: "matched",
      facilityId: "b",
    });
    expect(matchFacilityLocator("100 Main St, Raleigh, NC 27616", pair)).toEqual({
      status: "ambiguous",
      reason: FACILITY_AMBIGUOUS_REASON,
    });
  });

  it("does not treat the street number as the suite unit", () => {
    const pair = [
      facility("a", "A", "100 Main St", "Raleigh", "NC", "27616", "Suite 100"),
      facility("b", "B", "100 Main St", "Raleigh", "NC", "27616", "Suite 200"),
    ];
    expect(matchFacilityLocator("100 Main St, Raleigh, NC 27616", pair).status).toBe("ambiguous");
  });

  it("uses the trailing ZIP when the street number is also five digits", () => {
    const pair = [
      facility("a", "A", "11694 Main St", "Clayton", "NC", "27520", "Suite A"),
      facility("b", "B", "11694 Main St", "Clayton", "NC", "27520", "Suite B"),
    ];
    expect(matchFacilityLocator("11694 Main St, Suite A, Clayton, NC 27520", pair)).toEqual({
      status: "matched",
      facilityId: "a",
    });
    expect(matchFacilityLocator("11694 Main Street #B, Clayton NC 27520", pair)).toEqual({
      status: "matched",
      facilityId: "b",
    });
  });

  it("returns empty for a blank cell and ambiguous when two names collide", () => {
    expect(matchFacilityLocator("  ", BEST)).toEqual({ status: "empty" });
    const twins = [
      facility("a", "Main Clinic", "1 First St", "Raleigh", "NC", "27601"),
      facility("b", "Main Clinic", "2 Second St", "Raleigh", "NC", "27602"),
    ];
    expect(matchFacilityLocator("Main Clinic", twins).status).toBe("ambiguous");
  });
});

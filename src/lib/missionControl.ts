// Mission Control (the internal, cross-tenant platform administration surface)
// route vocabulary. Pure: the closed set of sections behind the layout's
// breadcrumb and section navigation, and the path test the root shell uses to
// let a platform admin with no organization through to these pages.
//
// This list is the single source the header reads. Home is the only section
// today; a later milestone adds its entry (and its path to the union below)
// in the same change that adds its route, so the list never names a page that
// does not exist. The header shows the section strip only from two entries.

export const MISSION_CONTROL_PATH = "/mission-control";

export type MissionControlSectionPath = "/mission-control";

export interface MissionControlSection {
  to: MissionControlSectionPath;
  /** Section navigation and breadcrumb label. */
  label: string;
  /** Page header title. */
  title: string;
  description: string;
}

export const MISSION_CONTROL_SECTIONS: readonly MissionControlSection[] = [
  {
    to: "/mission-control",
    label: "Home",
    title: "Mission Control",
    description: "Counts across every organization on Minted Panel.",
  },
];

export function isMissionControlPath(pathname: string): boolean {
  return pathname === MISSION_CONTROL_PATH || pathname.startsWith(`${MISSION_CONTROL_PATH}/`);
}

/** The section a Mission Control pathname belongs to; the first section (Home)
 * for the index and for anything unrecognized under the prefix. A nested page
 * stays under its section. */
export function missionControlSection(
  pathname: string,
  sections: readonly MissionControlSection[] = MISSION_CONTROL_SECTIONS,
): MissionControlSection {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const home = sections[0];
  return (
    sections.find(
      (section) => section !== home && (path === section.to || path.startsWith(`${section.to}/`)),
    ) ?? home
  );
}

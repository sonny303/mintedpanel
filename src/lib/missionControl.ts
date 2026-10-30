// Mission Control (the internal, cross-tenant platform administration surface)
// route vocabulary. Pure: the closed set of sections behind the layout's
// sub-navigation and breadcrumb, and the path test the root shell uses to let
// a platform admin with no organization through to these pages.

export const MISSION_CONTROL_PATH = "/mission-control";

export type MissionControlSectionPath =
  | "/mission-control"
  | "/mission-control/organizations"
  | "/mission-control/users"
  | "/mission-control/audit"
  | "/mission-control/cashboard";

export interface MissionControlSection {
  to: MissionControlSectionPath;
  /** Sub-navigation and breadcrumb label. */
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
  {
    to: "/mission-control/organizations",
    label: "Organizations",
    title: "Organizations",
    description: "Every organization on Minted Panel, with its members and groups.",
  },
  {
    to: "/mission-control/users",
    label: "Users",
    title: "Users",
    description: "Everyone who can sign in, and which organizations they can reach.",
  },
  {
    to: "/mission-control/audit",
    label: "Audit",
    title: "Audit",
    description: "A record of every change made from Mission Control.",
  },
  {
    to: "/mission-control/cashboard",
    label: "Cashboard",
    title: "Cashboard",
    description: "Shortcuts for common support fixes, by provider NPI or organization.",
  },
];

export function isMissionControlPath(pathname: string): boolean {
  return pathname === MISSION_CONTROL_PATH || pathname.startsWith(`${MISSION_CONTROL_PATH}/`);
}

/** The section a Mission Control pathname belongs to; Home for the index and
 * for anything unrecognized under the prefix. */
export function missionControlSection(pathname: string): MissionControlSection {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const home = MISSION_CONTROL_SECTIONS[0];
  return (
    MISSION_CONTROL_SECTIONS.find(
      (section) => section !== home && (path === section.to || path.startsWith(`${section.to}/`)),
    ) ?? home
  );
}

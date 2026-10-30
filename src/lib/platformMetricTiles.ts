// Mission Control Home: the six tiles derived from the platform_metrics()
// document. Pure, so the arithmetic (providers in pipeline = onboarding +
// awaiting verification) and the wording are pinned by a test, not by the
// component. Counts only — nothing here identifies a provider or a patient.
import type { PlatformMetrics } from "@/types";

export interface PlatformMetricTile {
  key: string;
  label: string;
  value: string;
  detail: string;
}

const defaultFormat = (n: number) => n.toLocaleString();

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function platformMetricTiles(
  metrics: PlatformMetrics,
  format: (n: number) => string = defaultFormat,
): PlatformMetricTile[] {
  const { organizations, users, providers, cases, pendingInvites } = metrics;
  const inPipeline = providers.onboarding + providers.pendingVerification;
  return [
    {
      key: "organizations",
      label: "Organizations",
      value: format(organizations.total),
      detail: `${format(organizations.active)} active · ${format(organizations.prospect)} prospect · ${format(organizations.inactive)} inactive`,
    },
    {
      key: "users",
      label: "Users",
      value: format(users.total),
      detail: `${format(users.platformAdmins)} ${plural(users.platformAdmins, "platform admin", "platform admins")}`,
    },
    {
      key: "providers-in-pipeline",
      label: "Providers in pipeline",
      value: format(inPipeline),
      detail: `Onboarding or awaiting verification, of ${format(providers.total)} ${plural(providers.total, "provider", "providers")}`,
    },
    {
      key: "pending-verifications",
      label: "Pending verifications",
      value: format(providers.pendingVerification),
      detail: `${plural(providers.pendingVerification, "Provider", "Providers")} awaiting verification`,
    },
    {
      key: "open-cases",
      label: "Open cases",
      value: format(cases.open),
      detail: `of ${format(cases.total)} ${plural(cases.total, "case", "cases")} in total`,
    },
    {
      key: "pending-invites",
      label: "Pending invites",
      value: format(pendingInvites),
      detail: `${plural(pendingInvites, "Invite", "Invites")} not yet accepted`,
    },
  ];
}

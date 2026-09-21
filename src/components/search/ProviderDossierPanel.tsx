// Inspector for one provider's footprint across the caller's orgs.
//
// Stock Dialog is the shell (the palette already owns it). This panel is the
// right-hand pane: name, orgs, groups, facilities, licenses, and copy actions.
// It does not switch the active org. "Manage in …" is the action that does.
import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { useProviderDossier } from "@/hooks/useProviderDossier";
import { fmtDate } from "@/lib/format";
import {
  dossierHeader,
  formatGroupTinsForCopy,
  formatLicensesForCopy,
  type DossierAffiliation,
  type DossierConflictField,
  type DossierLicense,
} from "@/lib/providerDossier";

interface ProviderDossierPanelProps {
  npi: string;
  anchorProviderId: string;
  onOpenInOrg: (affiliation: DossierAffiliation) => void;
  onClose: () => void;
}

const CONFLICT_LABEL: Record<DossierConflictField, string> = {
  expiration: "expiration",
  status: "status",
  verified: "verification",
};

export function ProviderDossierPanel({
  npi,
  anchorProviderId,
  onOpenInOrg,
  onClose,
}: ProviderDossierPanelProps) {
  const { dossier, isFetching, isError, isReady } = useProviderDossier(npi);
  const header = dossier ? dossierHeader(dossier, anchorProviderId) : null;
  const licenseCopy = dossier ? formatLicensesForCopy(dossier.licenses) : "";
  const tinCopy = dossier ? formatGroupTinsForCopy(dossier.groups) : "";

  return (
    <aside
      aria-label="Provider footprint"
      className="flex max-h-[70vh] flex-col border-t border-border md:border-l md:border-t-0"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[12px] text-[color:var(--mp-ink-faint)]">Footprint</p>
          <h2 className="truncate text-[15px] font-medium text-foreground">
            {header?.name ?? "Provider"}
            {header?.credentials ? (
              <span className="ml-2 text-[12px] font-normal text-[color:var(--mp-ink-faint)]">
                {header.credentials}
              </span>
            ) : null}
          </h2>
          <p className="font-mono text-[12px] text-foreground">{npi}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {!isReady ? (
          <p className="text-[13px] text-[color:var(--mp-ink-faint)]">
            Sign in to an organization to load this footprint.
          </p>
        ) : isError ? (
          <p className="text-[13px] text-[color:var(--mp-ink-faint)]">
            Could not reach Minted Panel. Try again.
          </p>
        ) : isFetching && !dossier ? (
          <p className="text-[13px] text-[color:var(--mp-ink-faint)]">Loading footprint…</p>
        ) : dossier && dossier.affiliations.length === 0 ? (
          <p className="text-[13px] text-[color:var(--mp-ink-faint)]">
            No provider with this NPI is in an organization you belong to.
          </p>
        ) : dossier && header ? (
          <>
            {header.otherNames.length > 0 ? (
              <p className="text-[12px] text-[color:var(--mp-ink-faint)]">
                This NPI is also recorded as {header.otherNames.join(", ")}.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {licenseCopy ? <CopyButton value={licenseCopy} label="all licenses" /> : null}
              {tinCopy ? <CopyButton value={tinCopy} label="group TINs" /> : null}
            </div>

            <Section title="Organizations">
              <ul className="space-y-2">
                {dossier.affiliations.map((affiliation) => (
                  <li
                    key={affiliation.providerId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                      <Building2 className="h-4 w-4 shrink-0 text-[color:var(--mp-ink-faint)]" />
                      <span className="truncate">
                        {affiliation.orgName || "Unknown organization"}
                      </span>
                      {affiliation.status === "terminated" ? (
                        <StatusPill status="neutral" label="Terminated" />
                      ) : null}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenInOrg(affiliation)}
                    >
                      Manage in {affiliation.orgName || "org"}
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={`Groups (${dossier.groups.length})`}>
              {dossier.groups.length === 0 ? (
                <Empty>No group assignments in your organizations.</Empty>
              ) : (
                <ul className="space-y-2">
                  {dossier.groups.map((group) => (
                    <li key={group.assignmentId} className="text-[13px]">
                      <span className="flex flex-wrap items-center gap-2 text-foreground">
                        <span className="font-medium">{group.name}</span>
                        {group.isPrimary ? <StatusPill status="teal" label="Primary" /> : null}
                        {group.sharedTin ? <StatusPill status="amber" label="Shared TIN" /> : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[color:var(--mp-ink-faint)]">
                        {[
                          group.npiType2 ? `Group NPI ${group.npiType2}` : null,
                          group.tin ? `TIN ${group.tin}` : "No TIN",
                          group.orgName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Facilities (${dossier.facilities.length})`}>
              {dossier.facilities.length === 0 ? (
                <Empty>No facility assignments in your organizations.</Empty>
              ) : (
                <ul className="space-y-2">
                  {dossier.facilities.map((facility) => (
                    <li key={facility.assignmentId} className="text-[13px]">
                      <span className="flex flex-wrap items-center gap-2 text-foreground">
                        <MapPin className="h-4 w-4 text-[color:var(--mp-ink-faint)]" />
                        <span className="font-medium">{facility.name}</span>
                        {facility.isPrimary ? <StatusPill status="teal" label="Primary" /> : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[color:var(--mp-ink-faint)]">
                        {[
                          [facility.city, facility.state].filter(Boolean).join(", ") || null,
                          facility.orgName,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Licenses (${dossier.licenses.length})`}>
              {dossier.licenses.length === 0 ? (
                <Empty>No state licenses in your organizations.</Empty>
              ) : (
                <ul className="space-y-3">
                  {dossier.licenses.map((license) => (
                    <LicenseRow key={licenseKey(license)} license={license} />
                  ))}
                </ul>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function licenseKey(license: DossierLicense): string {
  return `${license.state}|${license.licenseNumber ?? ""}|${license.licenseType ?? ""}|${license.sources[0]?.licenseId ?? ""}`;
}

function LicenseRow({ license }: { license: DossierLicense }) {
  const conflict =
    license.conflictFields.length > 0
      ? `Differs: ${license.conflictFields.map((field) => CONFLICT_LABEL[field]).join(", ")}`
      : null;
  return (
    <li className="text-[13px]">
      <span className="flex flex-wrap items-center gap-2 text-foreground">
        <span className="font-medium">{license.state}</span>
        <span className="font-mono text-[12px]">{license.licenseNumber ?? "No number"}</span>
        {license.licenseType ? (
          <span className="text-[12px] text-[color:var(--mp-ink-faint)]">
            {license.licenseType}
          </span>
        ) : null}
        {license.status ? <StatusPill status="neutral" label={license.status} /> : null}
        {conflict ? <StatusPill status="amber" label="Conflicts" /> : null}
      </span>
      <span className="mt-0.5 block text-[12px] text-[color:var(--mp-ink-faint)]">
        {license.expirationDate ? `Expires ${fmtDate(license.expirationDate)}` : "No expiration"}
        {license.sources.length > 1
          ? ` · ${license.sources.map((source) => source.orgName).join(", ")}`
          : ` · ${license.sources[0]?.orgName ?? ""}`}
      </span>
      {conflict ? (
        <ul className="mt-1 space-y-0.5 text-[12px] text-[color:var(--mp-ink-faint)]">
          {license.sources.map((source) => (
            <li key={source.licenseId}>
              {source.orgName}:{" "}
              {source.expirationDate ? fmtDate(source.expirationDate) : "no expiration"}
              {source.status ? ` · ${source.status}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-medium text-[color:var(--mp-ink-faint)]">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-[color:var(--mp-ink-faint)]">{children}</p>;
}

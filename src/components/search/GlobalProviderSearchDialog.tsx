// Command palette for the cross-org provider lookup (Approach A).
//
// Stock shadcn Dialog + a bare input; no new dependency. Logged in
// DESIGN-DEBT.md — the design system has no spec for a command palette yet.
//
// Mounted from the app shell. Typing searches every org the caller belongs
// to; copying an NPI stays in the current org; opening a record is what
// switches org.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, PanelRight, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { ProviderDossierPanel } from "@/components/search/ProviderDossierPanel";
import { useAuthStore } from "@/lib/auth-store";
import { MIN_SEARCH_LENGTH } from "@/lib/globalSearch";
import { isType1Npi } from "@/lib/providerDossier";
import { useGlobalProviderSearch, type GlobalProviderHit } from "@/hooks/useGlobalProviderSearch";

interface GlobalProviderSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dev harness only. The shell palette stays the shallow lookup. */
  enableDossier?: boolean;
}

interface InspectedProvider {
  npi: string;
  providerId: string;
}

export function GlobalProviderSearchDialog({
  open,
  onOpenChange,
  enableDossier = false,
}: GlobalProviderSearchDialogProps) {
  const navigate = useNavigate();
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const [rawTerm, setRawTerm] = useState("");
  const [cursor, setCursor] = useState(0);
  const [inspected, setInspected] = useState<InspectedProvider | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const { hits, isFetching, isError, isSearchable, orgCount } = useGlobalProviderSearch(rawTerm);

  useEffect(() => {
    if (!open) {
      setRawTerm("");
      setCursor(0);
      setInspected(null);
    }
  }, [open]);

  // A new result set invalidates the old highlight position.
  useEffect(() => {
    setCursor(0);
  }, [hits]);

  // Opening a record is the one action that changes org context, and it is
  // explicit: the lookup itself never moves the user out of their active org.
  const openHit = useCallback(
    (hit: GlobalProviderHit) => {
      onOpenChange(false);
      if (hit.orgId !== activeOrgId) setActiveOrg(hit.orgId);
      navigate({ to: "/providers/$id", params: { id: hit.providerId } });
    },
    [activeOrgId, navigate, onOpenChange, setActiveOrg],
  );

  // Space stays in the input so "first last" still searches. Shift+Space is
  // the inspect chord: it does not insert a character and it does not switch org.
  const inspectHit = useCallback((hit: GlobalProviderHit) => {
    if (!isType1Npi(hit.npi)) return;
    setInspected({ npi: hit.npi, providerId: hit.providerId });
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Shift+Space inspects the highlighted row. Prevent the space from landing
    // in the query, and ignore the chord once the term is too short to search:
    // the previous rows are off screen and must not open.
    if (enableDossier && event.key === " " && event.shiftKey) {
      event.preventDefault();
      if (!isSearchable) return;
      const hit = hits[cursor];
      if (hit) inspectHit(hit);
      return;
    }
    if (!isSearchable || hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[cursor];
      if (hit) openHit(hit);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`translate-y-0 gap-0 overflow-hidden p-0 ${
          inspected ? "top-[10%] max-w-5xl" : "top-[16%] max-w-xl"
        }`}
      >
        <DialogTitle className="sr-only">Find a provider across your organizations</DialogTitle>
        <div className={inspected ? "grid md:grid-cols-2" : undefined}>
          <div>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-[color:var(--mp-ink-faint)]" />
              <input
                autoFocus
                value={rawTerm}
                onChange={(e) => setRawTerm(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Provider name or NPI"
                placeholder="Provider name or NPI…"
                className="h-12 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-[color:var(--mp-ink-faint)]"
              />
              {isFetching ? (
                <span className="text-[12px] text-[color:var(--mp-ink-faint)]">Searching…</span>
              ) : null}
            </div>

            <div ref={listRef} className="max-h-96 overflow-y-auto p-2">
              {!isSearchable ? (
                <EmptyRow>
                  {`Type at least ${MIN_SEARCH_LENGTH} characters. Searches ${orgCount} organization${orgCount === 1 ? "" : "s"} you belong to.`}
                </EmptyRow>
              ) : isError ? (
                <EmptyRow>Could not reach Minted Panel. Try again.</EmptyRow>
              ) : hits.length === 0 ? (
                <EmptyRow>{isFetching ? "Searching…" : "No matching providers."}</EmptyRow>
              ) : (
                hits.map((hit, index) => (
                  <ResultRow
                    key={`${hit.orgId}-${hit.providerId}`}
                    hit={hit}
                    highlighted={index === cursor}
                    showInspect={enableDossier}
                    onOpen={() => openHit(hit)}
                    onInspect={() => inspectHit(hit)}
                    onHover={() => setCursor(index)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-[color:var(--mp-ink-faint)]">
              <span>
                {enableDossier
                  ? "Shift+Space opens the footprint · Enter opens the record"
                  : "Enter opens the record in its organization"}
              </span>
              <span>
                {enableDossier ? "Footprint loads on inspect" : "Name, NPI and organization only"}
              </span>
            </div>
          </div>
          {inspected ? (
            <ProviderDossierPanel
              npi={inspected.npi}
              anchorProviderId={inspected.providerId}
              onOpenInOrg={(affiliation) =>
                openHit({
                  providerId: affiliation.providerId,
                  orgId: affiliation.orgId,
                  orgName: affiliation.orgName,
                  name: affiliation.name,
                  firstName: affiliation.firstName,
                  lastName: affiliation.lastName,
                  credentials: affiliation.credentials,
                  npi: inspected.npi,
                  status: affiliation.status,
                })
              }
              onClose={() => setInspected(null)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-[13px] text-[color:var(--mp-ink-faint)]">
      {children}
    </div>
  );
}

interface ResultRowProps {
  hit: GlobalProviderHit;
  highlighted: boolean;
  showInspect: boolean;
  onOpen: () => void;
  onInspect: () => void;
  onHover: () => void;
}

function ResultRow({ hit, highlighted, showInspect, onOpen, onInspect, onHover }: ResultRowProps) {
  return (
    <div
      onMouseEnter={onHover}
      className={`flex items-center gap-3 rounded-[var(--mp-radius-sm)] px-3 py-2 ${
        highlighted ? "bg-muted" : ""
      }`}
    >
      <User className="h-4 w-4 shrink-0 text-[color:var(--mp-ink-faint)]" />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <span className="truncate">{hit.name}</span>
          {hit.credentials ? (
            <span className="text-[12px] font-normal text-[color:var(--mp-ink-faint)]">
              {hit.credentials}
            </span>
          ) : null}
          {hit.status === "terminated" ? <StatusPill status="neutral" label="Terminated" /> : null}
        </span>
        <span className="flex items-center gap-1 text-[12px] text-[color:var(--mp-ink-faint)]">
          <Building2 className="h-3.5 w-3.5" />
          <span className="truncate">{hit.orgName || "Unknown organization"}</span>
        </span>
      </button>
      {showInspect ? (
        <button
          type="button"
          onClick={onInspect}
          disabled={!isType1Npi(hit.npi)}
          aria-label={`Inspect footprint for ${hit.name} in ${hit.orgName || "this organization"}`}
          title={isType1Npi(hit.npi) ? "Inspect footprint" : "A 10-digit NPI is required"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-[color:var(--mp-ink-faint)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      ) : null}
      {hit.npi ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[12px] text-foreground">{hit.npi}</span>
          <CopyButton value={hit.npi} label={`NPI for ${hit.name}`} />
        </div>
      ) : (
        <span className="shrink-0 text-[12px] text-[color:var(--mp-ink-faint)]">No NPI</span>
      )}
    </div>
  );
}

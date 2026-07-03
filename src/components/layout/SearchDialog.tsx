// Shell search (M1): matches provider names and case names (provider · payer)
// via client-side filtering over the existing list hooks. Cap 4 providers +
// 5 cases, Enter opens the top result, plain empty state. No new queries.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, User, FileStack } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { usePayers } from "@/hooks/useAdmin";

type SearchResult =
  | { kind: "provider"; id: string; label: string; sub: string | null }
  | { kind: "case"; id: string; label: string; sub: string | null };

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const navigate = useNavigate();
  const providersQ = useProviders();
  const casesQ = useCases();
  const payersQ = usePayers();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { providerResults, caseResults } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return { providerResults: [] as SearchResult[], caseResults: [] as SearchResult[] };
    }

    const providerName = new Map(
      (providersQ.data ?? []).map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
    );
    const payerName = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));

    const providerResults: SearchResult[] = (providersQ.data ?? [])
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((p) => ({
        kind: "provider",
        id: p.id,
        label: `${p.firstName} ${p.lastName}`.trim(),
        sub: p.credentials,
      }));

    const caseResults: SearchResult[] = (casesQ.data ?? [])
      .map((c) => ({
        kind: "case" as const,
        id: c.id,
        label: `${providerName.get(c.providerId) ?? "Unknown"} · ${payerName.get(c.payerId) ?? "Unknown"}`,
        sub: c.state,
      }))
      .filter((r) => r.label.toLowerCase().includes(needle))
      .slice(0, 5);

    return { providerResults, caseResults };
  }, [query, providersQ.data, casesQ.data, payersQ.data]);

  const topResult = providerResults[0] ?? caseResults[0] ?? null;
  const hasQuery = query.trim().length > 0;
  const hasResults = providerResults.length > 0 || caseResults.length > 0;

  function openResult(result: SearchResult) {
    onOpenChange(false);
    if (result.kind === "provider") {
      navigate({ to: "/providers/$id", params: { id: result.id } });
    } else {
      navigate({ to: "/cases/$id", params: { id: result.id } });
    }
  }

  function renderRow(result: SearchResult, isTop: boolean) {
    const Icon = result.kind === "provider" ? User : FileStack;
    return (
      <button
        key={`${result.kind}-${result.id}`}
        type="button"
        onClick={() => openResult(result)}
        className={`w-full flex items-center gap-3 rounded-[var(--mp-radius-sm)] px-3 py-2 text-left text-[13px] hover:bg-muted ${
          isTop ? "bg-muted" : ""
        }`}
      >
        <Icon className="w-4 h-4 text-[color:var(--mp-ink-faint)]" />
        <span className="flex-1 truncate font-medium text-foreground">{result.label}</span>
        {result.sub ? (
          <span className="text-[12px] text-[color:var(--mp-ink-faint)]">{result.sub}</span>
        ) : null}
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 p-0 gap-0 max-w-lg overflow-hidden">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="w-4 h-4 text-[color:var(--mp-ink-faint)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && topResult) {
                e.preventDefault();
                openResult(topResult);
              }
            }}
            placeholder="Search providers and cases…"
            className="h-12 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-[color:var(--mp-ink-faint)]"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {!hasQuery ? (
            <div className="px-3 py-6 text-center text-[13px] text-[color:var(--mp-ink-faint)]">
              Type to search providers and cases.
            </div>
          ) : !hasResults ? (
            <div className="px-3 py-6 text-center text-[13px] text-[color:var(--mp-ink-faint)]">
              No matches.
            </div>
          ) : (
            <>
              {providerResults.length > 0 ? (
                <div className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                    Providers
                  </div>
                  {providerResults.map((r) => renderRow(r, r === topResult))}
                </div>
              ) : null}
              {caseResults.length > 0 ? (
                <div>
                  <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                    Cases
                  </div>
                  {caseResults.map((r) => renderRow(r, r === topResult))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Mapping review (Surface 2): train a new payer form one field per card.
// High-confidence fields batch into one confirm screen; the rest go card by
// card with Approve / Edit / Manual (keys A / E / M, U to undo). No timers.
//
// The deck is seeded once from a single load and driven from local reducer
// state so persisting a decision never re-splits the deck under the user; the
// field-map / portal / fix-it caches are invalidated on finish and on exit.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore, useActiveOrgId } from "@/lib/auth-store";
import { currentUserId } from "@/lib/audit";
import { useCanWrite } from "@/lib/permissions";
import { queryKeys } from "@/hooks/queryKeys";
import { usePortals, usePortalFieldMaps } from "@/hooks/usePortals";
import {
  useFieldDictionary,
  useTokenCatalog,
  useApproveField,
  useManualField,
  useReproposeField,
  useBatchApprove,
  useFinishTraining,
} from "@/hooks/useMappingReview";
import { splitBatch, type Confidence, type TrainingCard } from "@/lib/mappingConfidence";
import { bumpGoodCatches } from "@/lib/goodCatches";
import type { Portal, PortalFieldMap } from "@/types";
import type { TokenCatalogEntry } from "@/services/tokenCatalog";

export const Route = createFileRoute("/portals/$portalKey/train")({
  beforeLoad: () => {
    const { memberships, activeOrgId } = useAuthStore.getState();
    const role = memberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
    if (role === "billing") throw redirect({ to: "/admin/portals", replace: true });
  },
  component: TrainPage,
});

// ---------------------------------------------------------------------------
// Session reducer — immutable seed (batch/cards/total) + mutable progress.
// ---------------------------------------------------------------------------
interface Previous {
  token: string | null;
  source: PortalFieldMap["source"];
}
interface Session {
  batch: TrainingCard[];
  cards: TrainingCard[];
  total: number;
  preManual: number;
  decidedBase: number;
  phase: "batch" | "cards" | "done";
  cardIndex: number;
  decidedCards: number;
  batchConfirmed: boolean;
  manualCount: number;
  learnedCount: number;
  decisionsCount: number;
  goodCatches: number;
  lastAction: {
    previous: Previous;
    deltas: { learned: number; manual: number; override: number };
  } | null;
}

type Action =
  | { type: "SEED"; payload: Session }
  | { type: "CONFIRM_BATCH"; learned: number }
  | { type: "REVIEW_ONE_BY_ONE" }
  | {
      type: "DECIDE";
      kind: "approve" | "manual";
      learned: boolean;
      override: boolean;
      previous: Previous;
    }
  | { type: "UNDO" };

function reducer(state: Session | null, action: Action): Session | null {
  if (action.type === "SEED") return action.payload;
  if (!state) return state;
  switch (action.type) {
    case "CONFIRM_BATCH":
      return {
        ...state,
        batchConfirmed: true,
        decisionsCount: state.decisionsCount + 1,
        learnedCount: state.learnedCount + action.learned,
        phase: state.cards.length > 0 ? "cards" : "done",
      };
    case "REVIEW_ONE_BY_ONE":
      return {
        ...state,
        cards: [...state.batch, ...state.cards],
        batch: [],
        phase: "cards",
      };
    case "DECIDE": {
      const nextIndex = state.cardIndex + 1;
      return {
        ...state,
        cardIndex: nextIndex,
        decidedCards: state.decidedCards + 1,
        decisionsCount: state.decisionsCount + 1,
        learnedCount: state.learnedCount + (action.learned ? 1 : 0),
        manualCount: state.manualCount + (action.kind === "manual" ? 1 : 0),
        goodCatches: state.goodCatches + (action.override ? 1 : 0),
        lastAction: {
          previous: action.previous,
          deltas: {
            learned: action.learned ? 1 : 0,
            manual: action.kind === "manual" ? 1 : 0,
            override: action.override ? 1 : 0,
          },
        },
        phase: nextIndex >= state.cards.length ? "done" : "cards",
      };
    }
    case "UNDO": {
      if (!state.lastAction) return state;
      const { deltas } = state.lastAction;
      return {
        ...state,
        cardIndex: Math.max(0, state.cardIndex - 1),
        decidedCards: Math.max(0, state.decidedCards - 1),
        decisionsCount: Math.max(0, state.decisionsCount - 1),
        learnedCount: state.learnedCount - deltas.learned,
        manualCount: state.manualCount - deltas.manual,
        goodCatches: state.goodCatches - deltas.override,
        phase: "cards",
        lastAction: null,
      };
    }
    default:
      return state;
  }
}

function decidedCount(s: Session): number {
  return s.decidedBase + (s.batchConfirmed ? s.batch.length : 0) + s.decidedCards;
}

// ---------------------------------------------------------------------------
function TrainPage() {
  const { portalKey } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const canWrite = useCanWrite();

  const portalsQ = usePortals();
  const mapsQ = usePortalFieldMaps(portalKey);
  const dictQ = useFieldDictionary();
  const catalogQ = useTokenCatalog();

  const [session, dispatch] = useReducer(reducer, null);

  const portal: Portal | null = useMemo(
    () => (portalsQ.data ?? []).find((p) => p.portalKey === portalKey) ?? null,
    [portalsQ.data, portalKey],
  );

  // Seed once, when the field maps + dictionary have loaded.
  const seeded = session !== null;
  useEffect(() => {
    if (seeded) return;
    if (!mapsQ.data || !dictQ.data) return;
    const maps = mapsQ.data;
    const orgProposed = maps.filter((m) => m.status === "proposed" && m.orgId !== null);
    const approved = maps.filter((m) => m.status === "approved");
    const { batch, cards } = splitBatch(orgProposed, dictQ.data);
    const decidedBase = approved.length;
    const preManual = approved.filter(
      (m) => m.source === "manual" || m.source === "manual_partial",
    ).length;
    dispatch({
      type: "SEED",
      payload: {
        batch,
        cards,
        total: decidedBase + batch.length + cards.length,
        preManual,
        decidedBase,
        phase: batch.length > 0 ? "batch" : cards.length > 0 ? "cards" : "done",
        cardIndex: 0,
        decidedCards: 0,
        batchConfirmed: false,
        manualCount: 0,
        learnedCount: 0,
        decisionsCount: 0,
        goodCatches: 0,
        lastAction: null,
      },
    });
  }, [seeded, mapsQ.data, dictQ.data]);

  // Refresh the downstream caches when leaving (finish or navigate away).
  function invalidateDownstream() {
    // The Fix-it queue is derived from these caches (no "fixit" query exists),
    // so invalidating its sources is what refreshes the deck downstream.
    qc.invalidateQueries({ queryKey: queryKeys.portalFieldMaps(orgId, portalKey) });
    qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.fieldDictionary(orgId) });
    qc.invalidateQueries({ queryKey: queryKeys.lastFills(orgId) });
  }
  const invalidateRef = useRef(invalidateDownstream);
  invalidateRef.current = invalidateDownstream;
  useEffect(() => () => invalidateRef.current(), []);

  function exit() {
    invalidateDownstream();
    navigate({ to: "/admin/portals" });
  }

  if (!canWrite) {
    return (
      <div className="py-16">
        <EmptyState message="Training is available to specialists and admins." />
      </div>
    );
  }

  const loading =
    portalsQ.isLoading || mapsQ.isLoading || dictQ.isLoading || catalogQ.isLoading || !seeded;
  if (loading) return <TrainSkeleton />;

  if (mapsQ.isError || dictQ.isError || catalogQ.isError) {
    return (
      <div className="py-16">
        <EmptyState
          message="Couldn't load this form. Retry, or refresh the page."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                mapsQ.refetch();
                dictQ.refetch();
                catalogQ.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!portal) {
    return (
      <div className="py-16">
        <EmptyState
          message="Portal not found"
          action={
            <Button variant="outline" size="sm" onClick={exit}>
              Back to Portals
            </Button>
          }
        />
      </div>
    );
  }

  const s = session as Session;
  const formName = portal.name;

  // Fully trained: no proposed rows to decide and nothing was done this visit.
  if (s.phase === "done" && s.decisionsCount === 0 && s.batch.length === 0 && s.cards.length === 0) {
    return (
      <div className="mx-auto max-w-[720px] py-6">
        <TrainHeader formName={formName} onExit={exit} decided={s.total} total={s.total} />
        <div className="mt-8">
          <EmptyState
            message="This form is fully trained"
            description="New fields appear here when the extension captures a changed form."
            action={
              <Button variant="outline" size="sm" onClick={exit}>
                Back to Portals
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] py-6">
      <TrainHeader
        formName={formName}
        onExit={exit}
        decided={decidedCount(s)}
        total={s.total}
        capturedNote={portal.formUrl}
      />
      {s.phase === "batch" ? (
        <BatchScreen
          session={s}
          portalKey={portalKey}
          onConfirmed={(learned) => dispatch({ type: "CONFIRM_BATCH", learned })}
          onReviewOneByOne={() => dispatch({ type: "REVIEW_ONE_BY_ONE" })}
        />
      ) : null}
      {s.phase === "cards" ? (
        <CardScreen
          key={s.cardIndex}
          session={s}
          orgId={orgId}
          dispatch={dispatch}
          catalog={catalogQ.data ?? []}
        />
      ) : null}
      {s.phase === "done" ? (
        <DoneScreen session={s} portal={portal} onExit={exit} onFixNext={() => {
          invalidateDownstream();
          navigate({ to: "/fix-it" });
        }} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TrainHeader({
  formName,
  onExit,
  decided,
  total,
  capturedNote,
}: {
  formName: string;
  onExit: () => void;
  decided: number;
  total: number;
  capturedNote?: string | null;
}) {
  const pct = total > 0 ? Math.round((decided / total) * 100) : 0;
  let host = "";
  try {
    host = capturedNote ? new URL(capturedNote).hostname : "";
  } catch {
    host = "";
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1 text-[12.5px] text-[color:var(--mp-ink-secondary)] hover:text-[color:var(--mp-ink)]"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Portals
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight text-[color:var(--mp-ink)]">
          Train: {formName}
        </h1>
        <button
          onClick={onExit}
          className="text-[13px] font-medium text-[color:var(--mp-ink-secondary)] hover:text-[color:var(--mp-ink)]"
        >
          Save &amp; exit
        </button>
      </div>
      <div
        className="h-1 rounded-full bg-[color:var(--mp-muted)] overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-[color:var(--mp-primary)] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-[color:var(--mp-ink-faint)] mt-2 tabular-nums">
        <span>
          {decided} of {total} decided
        </span>
        <span>{host}</span>
      </div>
    </div>
  );
}

function sectionOf(row: PortalFieldMap): string {
  return row.formSection ?? row.pageStep ?? "Fields";
}

// ---------------------------------------------------------------------------
function BatchScreen({
  session,
  portalKey,
  onConfirmed,
  onReviewOneByOne,
}: {
  session: Session;
  portalKey: string;
  onConfirmed: (learned: number) => void;
  onReviewOneByOne: () => void;
}) {
  const batchMut = useBatchApprove();
  const [pending, setPending] = useState(false);
  const n = session.batch.length;

  const grouped = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, TrainingCard[]>();
    for (const c of session.batch) {
      const sec = sectionOf(c.row);
      if (!bySection.has(sec)) {
        bySection.set(sec, []);
        order.push(sec);
      }
      bySection.get(sec)!.push(c);
    }
    return order.map((sec) => [sec, bySection.get(sec)!] as const);
  }, [session.batch]);

  // Show a preview of the first few rows across the first sections.
  const preview: [string, TrainingCard[]][] = [];
  let shown = 0;
  for (const [sec, rows] of grouped) {
    if (shown >= 5) break;
    const take = rows.slice(0, Math.max(1, 5 - shown));
    preview.push([sec, take]);
    shown += take.length;
  }
  const remaining = n - shown;

  async function confirmAll() {
    setPending(true);
    try {
      const res = await batchMut.mutateAsync({
        items: session.batch.map((c) => ({
          id: c.row.id,
          token: c.suggestedToken as string,
          fieldLabel: c.row.fieldLabel,
        })),
        portalKey,
      });
      onConfirmed(res.learned);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't confirm the batch — retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-[16px] font-semibold text-[color:var(--mp-ink)]">
          {n} field{n === 1 ? "" : "s"} matched with high confidence
        </h2>
        <p className="text-[12.5px] text-[color:var(--mp-ink-secondary)] mt-1">
          Exact label matches and your confirmed dictionary rules. Confirm them together — every row
          stays editable later in Portals.
        </p>
      </div>
      {preview.map(([sec, rows]) => (
        <div key={sec}>
          <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
            {sec}
          </div>
          {rows.map((c) => (
            <div
              key={c.row.id}
              className="flex items-center gap-3 px-5 py-2 border-b border-mp-border last:border-b-0"
            >
              <span className="flex-1 text-[13px] font-medium text-[color:var(--mp-ink)]">
                {c.row.fieldLabel ?? c.row.selector}
                {c.provenance === "dictionary" ? (
                  <span className="text-[11.5px] font-normal text-[color:var(--mp-ink-faint)] ml-1.5">
                    dictionary rule
                  </span>
                ) : null}
              </span>
              <TokenChip token={c.suggestedToken} />
              <ConfidenceBadge confidence="high" />
            </div>
          ))}
        </div>
      ))}
      {remaining > 0 ? (
        <div className="px-5 py-2 text-[12px] text-[color:var(--mp-ink-faint)]">
          … {remaining} more row{remaining === 1 ? "" : "s"}, grouped by form section
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-t border-mp-border px-5 py-4">
        <Button
          onClick={confirmAll}
          disabled={pending}
          className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
        >
          Confirm all {n}
        </Button>
        <Button variant="outline" className="h-9" onClick={onReviewOneByOne} disabled={pending}>
          Review one by one
        </Button>
        {session.cards.length > 0 ? (
          <span className="text-[11.5px] text-[color:var(--mp-ink-faint)] ml-auto">
            Then {session.cards.length} field{session.cards.length === 1 ? "" : "s"}, one card at a
            time
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CardScreen({
  session,
  orgId,
  dispatch,
  catalog,
}: {
  session: Session;
  orgId: string;
  dispatch: React.Dispatch<Action>;
  catalog: TokenCatalogEntry[];
}) {
  const card = session.cards[session.cardIndex];
  const approveMut = useApproveField();
  const manualMut = useManualField();
  const reproposeMut = useReproposeField();
  const [pickerOpen, setPickerOpen] = useState(card ? card.suggestedToken == null : false);
  const [busy, setBusy] = useState(false);

  const label = card?.row.fieldLabel ?? card?.row.selector ?? "";

  async function approveToken(token: string, override: boolean) {
    if (!card || busy) return;
    setBusy(true);
    try {
      const res = await approveMut.mutateAsync({ id: card.row.id, token, fieldLabel: card.row.fieldLabel });
      if (override) bumpGoodCatches(orgId, currentUserId() ?? "anon", 1);
      dispatch({
        type: "DECIDE",
        kind: "approve",
        learned: res.learned,
        override,
        previous: { token: card.row.token, source: card.row.source },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that decision — retry.");
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  }

  async function markManual() {
    if (!card || busy) return;
    setBusy(true);
    try {
      await manualMut.mutateAsync({ id: card.row.id, fieldLabel: card.row.fieldLabel });
      dispatch({
        type: "DECIDE",
        kind: "manual",
        learned: false,
        override: false,
        previous: { token: card.row.token, source: card.row.source },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that decision — retry.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!session.lastAction || busy) return;
    const prevIdx = session.cardIndex - 1;
    const prevCard = session.cards[prevIdx];
    if (!prevCard) return;
    setBusy(true);
    try {
      await reproposeMut.mutateAsync({ id: prevCard.row.id, previous: session.lastAction.previous });
      dispatch({ type: "UNDO" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't undo — retry.");
    } finally {
      setBusy(false);
    }
  }

  // Global keys A / E / M / U while the picker is closed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pickerOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "a" && card?.suggestedToken) {
        e.preventDefault();
        approveToken(card.suggestedToken, false);
      } else if (k === "e") {
        e.preventDefault();
        setPickerOpen(true);
      } else if (k === "m") {
        e.preventDefault();
        markManual();
      } else if (k === "u" && session.lastAction) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, card, session.lastAction, busy]);

  if (!card) return null;

  return (
    <div className="mt-6 rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-7 py-6">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
        {sectionOf(card.row)}
      </div>
      <h2 className="text-[21px] font-semibold tracking-tight text-[color:var(--mp-ink)] mt-2.5 mb-1">
        &ldquo;{label}&rdquo;
      </h2>
      <div className="text-[12px] text-[color:var(--mp-ink-faint)]">
        {card.row.fieldType}
        {card.provenance === "none" ? " · no suggestion — pick a token or mark manual" : ""}
      </div>

      {pickerOpen ? (
        <TokenPicker
          catalog={catalog}
          initialToken={card.suggestedToken}
          canCancel={card.suggestedToken != null}
          busy={busy}
          onCancel={() => setPickerOpen(card.suggestedToken == null ? true : false)}
          onManual={markManual}
          onPick={(token) => approveToken(token, card.suggestedToken != null && token !== card.suggestedToken)}
        />
      ) : (
        <>
          <div className="flex items-center gap-2.5 mt-5 bg-[color:var(--mp-muted)]/60 border border-mp-border rounded-[var(--mp-radius-md)] px-3.5 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
              Suggested
            </span>
            {card.suggestedToken ? <TokenChip token={card.suggestedToken} /> : (
              <span className="text-[12.5px] text-[color:var(--mp-ink-faint)]">No suggestion</span>
            )}
            <ConfidenceBadge confidence={card.confidence} />
            <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)]">
              {provenanceText(card)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5 mt-5">
            {card.suggestedToken ? (
              <Button
                onClick={() => approveToken(card.suggestedToken as string, false)}
                disabled={busy}
                className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
              >
                Approve <KeyCap k="A" light />
              </Button>
            ) : null}
            <Button variant="outline" className="h-9" onClick={() => setPickerOpen(true)} disabled={busy}>
              Edit <KeyCap k="E" />
            </Button>
            <Button variant="outline" className="h-9" onClick={markManual} disabled={busy}>
              Manual <KeyCap k="M" />
            </Button>
          </div>
          <div className="text-[11.5px] text-[color:var(--mp-ink-faint)] mt-3">
            Manual = you'll fill this one by hand each time — right for e-signatures and uploads.
          </div>
          {session.lastAction ? (
            <button
              onClick={undo}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[12px] text-[color:var(--mp-ink-secondary)] hover:text-[color:var(--mp-ink)] mt-3.5"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo last decision <KeyCap k="U" />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function provenanceText(card: TrainingCard): string {
  if (card.provenance === "dictionary") return "dictionary rule";
  if (card.provenance === "label") return "label similarity · no dictionary rule yet";
  return "no match — your call";
}

// ---------------------------------------------------------------------------
function TokenPicker({
  catalog,
  initialToken,
  canCancel,
  busy,
  onPick,
  onManual,
  onCancel,
}: {
  catalog: TokenCatalogEntry[];
  initialToken: string | null;
  canCancel: boolean;
  busy: boolean;
  onPick: (token: string) => void;
  onManual: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = catalog.filter((e) => {
      if (!q) return true;
      return (
        e.token.toLowerCase().includes(q) ||
        humanizeToken(e.token).toLowerCase().includes(q) ||
        `${e.table}.${e.column}`.toLowerCase().includes(q)
      );
    });
    return rows.slice(0, 60);
  }, [catalog, query]);

  useEffect(() => {
    setSel((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const byFamily = new Map<string, { entry: TokenCatalogEntry; index: number }[]>();
    filtered.forEach((entry, index) => {
      const fam = entry.token.split(".")[0];
      if (!byFamily.has(fam)) {
        byFamily.set(fam, []);
        order.push(fam);
      }
      byFamily.get(fam)!.push({ entry, index });
    });
    return order.map((fam) => [fam, byFamily.get(fam)!] as const);
  }, [filtered]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[sel];
      if (chosen) onPick(chosen.token);
    } else if (e.key === "Escape" && canCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="mt-5 border border-mp-border rounded-[var(--mp-radius-md)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-mp-border px-3.5 py-2.5">
        <Search className="w-3.5 h-3.5 text-[color:var(--mp-ink-faint)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search tokens…"
          className="flex-1 bg-transparent text-[13px] text-[color:var(--mp-ink)] outline-none placeholder:text-[color:var(--mp-ink-faint)]"
        />
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-[12.5px] text-[color:var(--mp-ink-faint)]">
            No tokens match — nothing to map? Mark the field manual.
          </div>
        ) : (
          grouped.map(([fam, entries]) => (
            <div key={fam}>
              <div className="px-3.5 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                {familyLabel(fam)}
              </div>
              {entries.map(({ entry, index }) => (
                <button
                  key={entry.token}
                  onMouseEnter={() => setSel(index)}
                  onClick={() => onPick(entry.token)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left ${
                    index === sel ? "bg-[color:var(--mp-primary-tint)]" : ""
                  }`}
                >
                  <TokenChip token={entry.token} muted={entry.token !== initialToken} />
                  <span className="text-[12px] text-[color:var(--mp-ink-secondary)]">
                    {humanizeToken(entry.token)}
                  </span>
                  <span className="ml-auto text-[11.5px] font-mono text-[color:var(--mp-ink-faint)]">
                    {entry.table}.{entry.column}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-3.5 border-t border-mp-border px-3.5 py-2 text-[11px] text-[color:var(--mp-ink-faint)]">
        <span>↑↓ navigate</span>
        <span>Enter select</span>
        {canCancel ? <span>Esc cancel</span> : null}
        <div className="ml-auto flex items-center gap-3">
          <span>{catalog.length} tokens · closed catalog</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2"
            onClick={onManual}
            disabled={busy}
          >
            Mark manual
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DoneScreen({
  session,
  portal,
  onExit,
  onFixNext,
}: {
  session: Session;
  portal: Portal;
  onExit: () => void;
  onFixNext: () => void;
}) {
  const finishMut = useFinishTraining();
  const ranRef = useRef(false);
  const totalManual = session.preManual + session.manualCount;
  const autoFills = Math.max(0, session.total - totalManual);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    finishMut.mutate(portal.id, {
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't mark the form verified."),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-6 rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-8 py-9 text-center">
      <div className="w-[52px] h-[52px] mx-auto mb-4 rounded-full border-2 border-[color:var(--mp-ok)] text-[color:var(--mp-ok)] flex items-center justify-center">
        <Check className="w-6 h-6" />
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight text-[color:var(--mp-ink)]">
        This form is ready.
      </h2>
      <p className="text-[13px] text-[color:var(--mp-ink-secondary)] mt-1.5">
        {portal.name} is now trained and marked <b>Verified</b>.
      </p>

      <div className="flex justify-center mt-6 border border-mp-border rounded-[var(--mp-radius-md)] overflow-hidden">
        <Stat value={`${autoFills}`} sub={`of ${session.total}`} label="auto-fills" />
        <Stat value={`${session.decisionsCount}`} label="your decisions" divider />
        <Stat value={`${session.learnedCount}`} label="labels learned" divider />
      </div>
      {totalManual > 0 ? (
        <p className="text-[11.5px] text-[color:var(--mp-ink-faint)] mt-3">
          {totalManual} field{totalManual === 1 ? "" : "s"} stay manual (e-signatures, uploads, one-off
          values).
        </p>
      ) : null}

      <div className="flex gap-2.5 justify-center mt-6">
        <Button variant="outline" className="h-9" onClick={onExit}>
          Back to Portals
        </Button>
        <Button
          className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
          onClick={onFixNext}
        >
          Fix next card in queue
        </Button>
      </div>
    </div>
  );
}

function Stat({
  value,
  sub,
  label,
  divider,
}: {
  value: string;
  sub?: string;
  label: string;
  divider?: boolean;
}) {
  return (
    <div className={`flex-1 px-4 py-3.5 ${divider ? "border-l border-mp-border" : ""}`}>
      <div className="text-[20px] font-semibold tracking-tight text-[color:var(--mp-ink)] tabular-nums">
        {value}
        {sub ? <span className="text-[13px] font-normal text-[color:var(--mp-ink-faint)]"> {sub}</span> : null}
      </div>
      <div className="text-[11.5px] text-[color:var(--mp-ink-secondary)] mt-0.5">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
function TokenChip({ token, muted }: { token: string | null; muted?: boolean }) {
  if (!token) return null;
  return (
    <span
      className={`inline-flex items-center rounded-[var(--mp-radius-sm)] border px-2 py-0.5 text-[12px] font-mono ${
        muted
          ? "border-mp-border bg-[color:var(--mp-muted)] text-[color:var(--mp-ink-secondary)]"
          : "border-[#C8DBD4] bg-[color:var(--mp-primary-tint)] text-[color:var(--mp-primary)]"
      }`}
    >
      {token}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const map: Record<Confidence, string> = {
    high: "bg-[#ECFDF5] text-[#059669]",
    medium: "bg-[#FEF3C7] text-[#D97706]",
    low: "bg-[#F5F5F4] text-[#78716C]",
  };
  const label = confidence[0].toUpperCase() + confidence.slice(1);
  return (
    <span
      className={`text-[10.5px] font-semibold uppercase tracking-wide rounded-[4px] px-1.5 py-0.5 ${map[confidence]}`}
    >
      {label}
    </span>
  );
}

function KeyCap({ k, light }: { k: string; light?: boolean }) {
  return (
    <span
      className={`ml-1.5 inline-block rounded-[4px] border px-1.5 py-0.5 text-[10.5px] leading-none ${
        light
          ? "border-white/35 bg-white/15 text-white"
          : "border-mp-border bg-[color:var(--mp-muted)] text-[color:var(--mp-ink-secondary)]"
      }`}
    >
      {k}
    </span>
  );
}

function TrainSkeleton() {
  return (
    <div className="mx-auto max-w-[720px] py-6 space-y-4">
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-1 w-full" />
      <Skeleton className="h-64 w-full rounded-[var(--mp-radius-lg)]" />
    </div>
  );
}

// token -> "Family · field" helpers for the picker
function humanizeToken(token: string): string {
  const field = token.split(".").slice(1).join(".");
  return field
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const FAMILY_LABELS: Record<string, string> = {
  provider: "Provider",
  group: "Group",
  facility: "Facility",
  mso: "MSO",
  group_insurance: "Group Insurance",
  license: "License",
  payer: "Payer",
  contract: "Contract",
  assignment: "Assignment",
  user: "User",
};

function familyLabel(family: string): string {
  return FAMILY_LABELS[family] ?? family.charAt(0).toUpperCase() + family.slice(1);
}

// Fix-it queue (Surface 1): a deck of 30-second decisions that improve fill
// coverage, ordered by soonest blocked fill — never by ease. Four card types
// (provider gap / dictionary confirm / train form / broken mapping). No timers, no speed
// mechanics; corrections are celebrated as good catches, never penalized.
import { useEffect, useMemo, useReducer, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Check, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore, useActiveOrgId } from "@/lib/auth-store";
import { currentUserId } from "@/lib/audit";
import { useCanWrite } from "@/lib/permissions";
import {
  useFixitQueue,
  useSaveProviderField,
  useSkipToFollowUp,
  useDecideDictionary,
  useSendBrokenToTraining,
} from "@/hooks/useFixit";
import { FIXIT_FIELDS } from "@/lib/fixitFields";
import { getGoodCatches, bumpGoodCatches } from "@/lib/goodCatches";
import { fmtDate } from "@/lib/format";
import type { FixitCard } from "@/lib/fixitQueue";
import type { ProviderInput } from "@/services/providers";

export const Route = createFileRoute("/fix-it")({
  beforeLoad: () => {
    const { memberships, activeOrgId } = useAuthStore.getState();
    const role = memberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
    if (role === "billing") throw redirect({ to: "/home", replace: true });
  },
  component: FixItPage,
});

interface Session {
  deck: FixitCard[];
  index: number;
  cleared: number;
  followUps: { title: string; dueDate: string | null }[];
  coverageWins: { providerName: string; payerName: string; portalName: string; total: number }[];
  sessionGoodCatches: number;
}

type Action =
  | { type: "SEED"; deck: FixitCard[] }
  | {
      type: "SAVE_GAP";
      win?: { providerName: string; payerName: string; portalName: string; total: number };
    }
  | { type: "SKIP_GAP"; followUp: { title: string; dueDate: string | null } }
  | { type: "DICT_YES" }
  | { type: "DICT_NO" }
  | { type: "TRAIN_LATER" }
  | { type: "BROKEN_SENT" };

function reducer(state: Session | null, action: Action): Session | null {
  if (action.type === "SEED") {
    return {
      deck: action.deck,
      index: 0,
      cleared: 0,
      followUps: [],
      coverageWins: [],
      sessionGoodCatches: 0,
    };
  }
  if (!state) return state;
  const advance = { ...state, index: state.index + 1 };
  switch (action.type) {
    case "SAVE_GAP":
      return {
        ...advance,
        cleared: state.cleared + 1,
        coverageWins: action.win ? [...state.coverageWins, action.win] : state.coverageWins,
      };
    case "SKIP_GAP":
      return {
        ...advance,
        cleared: state.cleared + 1,
        followUps: [...state.followUps, action.followUp],
      };
    case "DICT_YES":
      return { ...advance, cleared: state.cleared + 1 };
    case "DICT_NO":
      return {
        ...advance,
        cleared: state.cleared + 1,
        sessionGoodCatches: state.sessionGoodCatches + 1,
      };
    case "TRAIN_LATER":
      return advance;
    case "BROKEN_SENT":
      return { ...advance, cleared: state.cleared + 1 };
    default:
      return state;
  }
}

function FixItPage() {
  const navigate = useNavigate();
  const orgId = useActiveOrgId() ?? "no-org";
  const canWrite = useCanWrite();
  const { cards, isLoading, isError, refetch } = useFixitQueue();
  const [session, dispatch] = useReducer(reducer, null);
  const [weeklyCatches, setWeeklyCatches] = useState(0);

  useEffect(() => {
    setWeeklyCatches(getGoodCatches(orgId, currentUserId() ?? "anon"));
  }, [orgId]);

  // Seed the deck once, when the queue first builds.
  const seeded = session !== null;
  useEffect(() => {
    if (seeded || isLoading || isError) return;
    dispatch({ type: "SEED", deck: cards });
  }, [seeded, isLoading, isError, cards]);

  if (!canWrite) {
    return (
      <div className="py-16">
        <EmptyState message="The Fix-it queue is available to specialists and admins." />
      </div>
    );
  }

  const catchChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C8DBD4] bg-[color:var(--mp-primary-tint)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--mp-primary)]">
      <CheckCircle2 className="w-3.5 h-3.5" /> {weeklyCatches} good catch
      {weeklyCatches === 1 ? "" : "es"} this week
    </span>
  );

  if (isLoading || !seeded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Fix-it queue"
          description="Each card is one decision. Clearing it improves tomorrow's fills."
        />
        <div className="mx-auto max-w-[600px]">
          <Skeleton className="h-64 w-full rounded-[var(--mp-radius-lg)]" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fix-it queue" />
        <div className="mx-auto max-w-[600px]">
          <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-8">
            <EmptyState
              message="Couldn't load the queue. Retry, or refresh the page."
              action={
                <Button variant="outline" size="sm" onClick={refetch}>
                  Retry
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const s = session as Session;
  const done = s.index >= s.deck.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fix-it queue"
        description="Each card is one decision. Clearing it improves tomorrow's fills."
        actions={catchChip}
      />
      <div className="mx-auto max-w-[600px]">
        {s.deck.length === 0 ? (
          <QueueClear catchChip={catchChip} />
        ) : done ? (
          <SessionSummary
            session={s}
            onHome={() => navigate({ to: "/home" })}
            onDone={() => navigate({ to: "/home" })}
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 text-[12px] text-[color:var(--mp-ink-secondary)]">
              <span>
                <b className="font-semibold text-[color:var(--mp-ink)] tabular-nums">
                  Card {s.index + 1} of {s.deck.length}
                </b>{" "}
                · ordered by soonest blocked fill
              </span>
              <span className="text-[color:var(--mp-ink-faint)]">Skip never loses work</span>
            </div>
            <ActiveCard
              key={s.deck[s.index].id}
              card={s.deck[s.index]}
              dispatch={dispatch}
              onGoodCatch={() =>
                setWeeklyCatches(bumpGoodCatches(orgId, currentUserId() ?? "anon", 1))
              }
              onTrain={(portalKey) =>
                navigate({ to: "/portals/$portalKey/train", params: { portalKey } })
              }
            />
            <div className="mt-2.5 mx-2.5 h-2.5 rounded-b-[var(--mp-radius-lg)] border border-t-0 border-mp-border bg-mp-card" />
            <div className="mt-1 mx-5 h-2.5 rounded-b-[var(--mp-radius-lg)] border border-t-0 border-mp-border bg-mp-card opacity-60" />
          </>
        )}
      </div>
    </div>
  );
}

function ActiveCard({
  card,
  dispatch,
  onGoodCatch,
  onTrain,
}: {
  card: FixitCard;
  dispatch: React.Dispatch<Action>;
  onGoodCatch: () => void;
  onTrain: (portalKey: string) => void;
}) {
  if (card.kind === "provider_gap") return <GapCard card={card} dispatch={dispatch} />;
  if (card.kind === "dictionary_confirm")
    return <DictionaryCard card={card} dispatch={dispatch} onGoodCatch={onGoodCatch} />;
  if (card.kind === "broken_mapping")
    return <BrokenMappingCard card={card} dispatch={dispatch} onTrain={onTrain} />;
  return <TrainCard card={card} dispatch={dispatch} onTrain={onTrain} />;
}

function CardShell({
  chip,
  chipTone,
  impact,
  impactDated,
  title,
  why,
  children,
  footer,
}: {
  chip: string;
  chipTone: "data" | "dict" | "form" | "broken";
  impact: string;
  impactDated: boolean;
  title: string;
  why: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  const toneClass = {
    data: "bg-[#EFF6FF] text-[#2563EB]",
    dict: "bg-[color:var(--mp-primary-tint)] text-[color:var(--mp-primary)]",
    form: "bg-[#FEF3C7] text-[#92400E]",
    broken: "bg-[#FEE2E2] text-[#B91C1C]",
  }[chipTone];
  return (
    <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[10.5px] font-semibold uppercase tracking-wider rounded-[4px] px-1.5 py-1 ${toneClass}`}
        >
          {chip}
        </span>
        <span
          className={`text-[12.5px] font-medium ${
            impactDated ? "text-[color:var(--mp-warn)]" : "text-[color:var(--mp-ink-secondary)]"
          }`}
        >
          {impact}
        </span>
      </div>
      <h2 className="text-[18px] font-semibold tracking-tight leading-snug text-[color:var(--mp-ink)] mt-3">
        {title}
      </h2>
      <p className="text-[13px] text-[color:var(--mp-ink-secondary)] mt-1.5">{why}</p>
      {children ? <div className="mt-4">{children}</div> : null}
      <div className="flex flex-wrap items-center gap-2.5 mt-4">{footer}</div>
    </div>
  );
}

function GapCard({ card, dispatch }: { card: FixitCard; dispatch: React.Dispatch<Action> }) {
  const gap = card.gap!;
  const def = FIXIT_FIELDS[gap.token];
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saveMut = useSaveProviderField();
  const skipMut = useSkipToFollowUp();
  const firstName = gap.providerName.split(" ")[0];

  const cov = gap.coverage;
  const filledPct = cov.total > 0 ? (cov.filled / cov.total) * 100 : 0;
  const gainPct = cov.total > 0 ? (cov.gain / cov.total) * 100 : 0;
  const reachesFull = cov.filled + cov.gain >= cov.total && cov.total > 0;

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(`Enter a ${def?.label ?? "value"} or skip for now.`);
      return;
    }
    const invalid = def?.validate?.(trimmed) ?? null;
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      const patch = { [def!.column]: trimmed } as Partial<ProviderInput>;
      await saveMut.mutateAsync({ providerId: gap.providerId, patch });
      toast.success(
        `Saved — ${firstName} is now ${Math.min(cov.filled + cov.gain, cov.total)}/${cov.total} for ${gap.payerName}`,
      );
      dispatch({
        type: "SAVE_GAP",
        win: reachesFull
          ? {
              providerName: gap.providerName,
              payerName: gap.payerName,
              portalName: gap.portalName,
              total: cov.total,
            }
          : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — retry.");
    }
  }

  async function skip() {
    try {
      await skipMut.mutateAsync({
        caseId: gap.caseId,
        providerId: gap.providerId,
        title: `Collect ${gap.fieldLabel} for ${firstName}`,
        dueDate: card.sortDate,
      });
      toast.success("Follow-up task created");
      dispatch({
        type: "SKIP_GAP",
        followUp: { title: `Collect ${gap.fieldLabel} for ${firstName}`, dueDate: card.sortDate },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the task — retry.");
    }
  }

  const busy = saveMut.isPending || skipMut.isPending;

  return (
    <CardShell
      chip="Provider data"
      chipTone="data"
      impact={
        card.sortDate
          ? `Blocks ${gap.payerName} · fill due ${fmtDate(card.sortDate)}`
          : `Blocks ${gap.payerName}`
      }
      impactDated={Boolean(card.sortDate)}
      title={`${gap.providerName} is missing ${aOrAn(gap.fieldLabel)}.`}
      why={`The ${gap.portalName} fill for ${gap.payerName} stops short without it.${
        gap.moreCount > 0
          ? ` +${gap.moreCount} more fill${gap.moreCount === 1 ? "" : "s"} blocked.`
          : ""
      }`}
      footer={
        <>
          <Button
            onClick={save}
            disabled={busy}
            className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
          >
            Save
          </Button>
          <Button variant="outline" className="h-9" onClick={skip} disabled={busy}>
            Skip for now
          </Button>
          <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)] text-right max-w-[240px]">
            Skip creates a follow-up task on the {gap.payerName} case
            {card.sortDate ? `, due ${fmtDate(card.sortDate)}` : ""}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex justify-between items-baseline text-[12px] text-[color:var(--mp-ink-secondary)] mb-1.5">
            <span>
              Auto-fill coverage — {firstName} · {gap.portalName}
            </span>
            <b className="font-semibold text-[color:var(--mp-ink)] tabular-nums">
              {cov.filled} / {cov.total}
            </b>
          </div>
          <div className="h-1.5 rounded-full bg-[color:var(--mp-muted)] overflow-hidden flex">
            <div
              className="h-full bg-[color:var(--mp-primary)]"
              style={{ width: `${filledPct}%` }}
            />
            <div className="h-full bg-[#7fc79f]" style={{ width: `${gainPct}%` }} />
          </div>
          {cov.gain > 0 ? (
            <div className="text-[11.5px] text-[color:var(--mp-ink-faint)] mt-1.5">
              Green fills today · light green unlocks when this card is saved (+{cov.gain} field
              {cov.gain === 1 ? "" : "s"})
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="fixit-input"
            className="text-[12px] font-medium text-[color:var(--mp-ink)]"
          >
            {def?.label ?? gap.fieldLabel}
          </label>
          <Input
            id="fixit-input"
            type={def?.inputType === "date" ? "date" : "text"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder={def?.placeholder}
            className="h-9 max-w-[280px]"
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <span className="text-[12px] text-[#B91C1C]">{error}</span>
          ) : def?.hint ? (
            <span className="text-[11.5px] text-[color:var(--mp-ink-faint)]">{def.hint}</span>
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}

function DictionaryCard({
  card,
  dispatch,
  onGoodCatch,
}: {
  card: FixitCard;
  dispatch: React.Dispatch<Action>;
  onGoodCatch: () => void;
}) {
  const d = card.dictionary!;
  const decideMut = useDecideDictionary();
  const busy = decideMut.isPending;

  async function decide(status: "confirmed" | "rejected") {
    try {
      await decideMut.mutateAsync({ id: d.entryId, status });
      if (status === "rejected") {
        onGoodCatch();
        dispatch({ type: "DICT_NO" });
      } else {
        dispatch({ type: "DICT_YES" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — retry.");
    }
  }

  return (
    <CardShell
      chip="Dictionary"
      chipTone="dict"
      impact="Affects every future form"
      impactDated={false}
      title={`Always map "${d.label}" to ${d.token}?`}
      why={`Seen on ${d.seenCount} forms. Each time you mapped it to the same token.`}
      footer={
        <>
          <Button
            onClick={() => decide("confirmed")}
            disabled={busy}
            className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
          >
            Yes, always
          </Button>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => decide("rejected")}
            disabled={busy}
          >
            No, keep asking
          </Button>
          <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)] text-right max-w-[240px]">
            &ldquo;No&rdquo; is a good catch — it keeps a wrong guess out of every future form
          </span>
        </>
      }
    >
      <div className="flex items-center gap-2.5 bg-[color:var(--mp-muted)]/60 border border-mp-border rounded-[var(--mp-radius-md)] px-3.5 py-2.5">
        <span className="text-[13px] font-medium text-[color:var(--mp-ink)]">
          &ldquo;{d.label}&rdquo;
        </span>
        <span className="text-[color:var(--mp-ink-faint)]">→</span>
        <span className="inline-flex items-center rounded-[var(--mp-radius-sm)] border border-[#C8DBD4] bg-[color:var(--mp-primary-tint)] px-2 py-0.5 text-[12px] font-mono text-[color:var(--mp-primary)]">
          {d.token}
        </span>
        <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)]">
          {d.seenCount} of {d.seenCount} mappings agree
        </span>
      </div>
    </CardShell>
  );
}

function TrainCard({
  card,
  dispatch,
  onTrain,
}: {
  card: FixitCard;
  dispatch: React.Dispatch<Action>;
  onTrain: (portalKey: string) => void;
}) {
  const t = card.train!;
  const matchedPct = t.total > 0 ? (t.matched / t.total) * 100 : 0;
  return (
    <CardShell
      chip="New form"
      chipTone="form"
      impact={card.sortDate ? `Fills start ${fmtDate(card.sortDate)}` : "Cases start soon"}
      impactDated={false}
      title={`${t.portalName} has fields to train.`}
      why={`${t.total - t.matched} field${t.total - t.matched === 1 ? "" : "s"} need your call; ${t.matched} matched automatically.`}
      footer={
        <>
          <Button
            onClick={() => onTrain(t.portalKey)}
            className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
          >
            Train this form
          </Button>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => dispatch({ type: "TRAIN_LATER" })}
          >
            Later
          </Button>
          <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)]">
            opens mapping review
          </span>
        </>
      }
    >
      <div>
        <div className="flex justify-between items-baseline text-[12px] text-[color:var(--mp-ink-secondary)] mb-1.5">
          <span>Pre-matched by dictionary + exact labels</span>
          <b className="font-semibold text-[color:var(--mp-ink)] tabular-nums">
            {t.matched} / {t.total}
          </b>
        </div>
        <div className="h-1.5 rounded-full bg-[color:var(--mp-muted)] overflow-hidden">
          <div
            className="h-full bg-[color:var(--mp-primary)]"
            style={{ width: `${matchedPct}%` }}
          />
        </div>
      </div>
    </CardShell>
  );
}

function BrokenMappingCard({
  card,
  dispatch,
  onTrain,
}: {
  card: FixitCard;
  dispatch: React.Dispatch<Action>;
  onTrain: (portalKey: string) => void;
}) {
  const b = card.broken!;
  const sendMut = useSendBrokenToTraining();
  const shown = b.labels.slice(0, 5);
  const overflow = b.count - shown.length;

  async function sendToTraining() {
    try {
      await sendMut.mutateAsync(b.orgRows);
      toast.success(
        `${b.orgRows.length} field${b.orgRows.length === 1 ? "" : "s"} sent back to training`,
      );
      dispatch({ type: "BROKEN_SENT" });
      onTrain(b.portalKey);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the mappings — retry.");
    }
  }

  return (
    <CardShell
      chip="Form drift"
      chipTone="broken"
      impact={card.sortDate ? `Fills due ${fmtDate(card.sortDate)}` : "Reported by the last fill"}
      impactDated={Boolean(card.sortDate)}
      title={`${b.count} trained field${b.count === 1 ? "" : "s"} didn't match the live ${b.portalName} form.`}
      why={
        b.orgRows.length > 0
          ? `The last fill couldn't find ${b.count === 1 ? "this field" : "these fields"} on the page — the form likely changed. Sending them back to training re-opens the decision so a re-capture can refresh the selectors.`
          : `The last fill couldn't find ${b.count === 1 ? "this field" : "these fields"} on the page. ${b.globalCount === 1 ? "This mapping is" : "These mappings are"} managed centrally by Minted Panel — re-capture the form with the extension to propose fresh selectors for your org.`
      }
      footer={
        <>
          {b.orgRows.length > 0 ? (
            <Button
              onClick={sendToTraining}
              disabled={sendMut.isPending}
              className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
            >
              Send to training
            </Button>
          ) : (
            <Button
              onClick={() => {
                dispatch({ type: "BROKEN_SENT" });
                onTrain(b.portalKey);
              }}
              className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
            >
              Review in training
            </Button>
          )}
          <Button
            variant="outline"
            className="h-9"
            onClick={() => dispatch({ type: "TRAIN_LATER" })}
            disabled={sendMut.isPending}
          >
            Later
          </Button>
          <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)] text-right max-w-[240px]">
            {b.orgRows.length > 0 && b.globalCount > 0
              ? `${b.globalCount} of these are managed centrally and stay read-only`
              : "opens mapping review"}
          </span>
        </>
      }
    >
      <ul className="space-y-1">
        {shown.map((label, i) => (
          <li
            key={`${label}-${i}`}
            className="flex items-center gap-2 text-[13px] text-[color:var(--mp-ink)]"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] shrink-0" />
            <span className="truncate">{label}</span>
            <span className="ml-auto text-[11.5px] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
              not found on page
            </span>
          </li>
        ))}
        {overflow > 0 ? (
          <li className="text-[11.5px] text-[color:var(--mp-ink-faint)]">
            +{overflow} more field{overflow === 1 ? "" : "s"}
          </li>
        ) : null}
      </ul>
    </CardShell>
  );
}

function SessionSummary({
  session,
  onHome,
  onDone,
}: {
  session: Session;
  onHome: () => void;
  onDone: () => void;
}) {
  const lines: React.ReactNode[] = [];
  for (const w of session.coverageWins) {
    lines.push(
      <>
        <b>
          {w.providerName} is now 100% for {w.payerName}
        </b>{" "}
        — {w.total} of {w.total} fields auto-fill on {w.portalName}.
      </>,
    );
  }
  if (session.followUps.length > 0) {
    const f = session.followUps[0];
    lines.push(
      <>
        <b>
          {session.followUps.length} follow-up task{session.followUps.length === 1 ? "" : "s"}{" "}
          created
        </b>{" "}
        — &ldquo;{f.title}&rdquo;{f.dueDate ? `, due ${fmtDate(f.dueDate)}` : ""}.
      </>,
    );
  }
  if (session.sessionGoodCatches > 0) {
    lines.push(
      <>
        <b>
          {session.sessionGoodCatches} good catch{session.sessionGoodCatches === 1 ? "" : "es"}
        </b>{" "}
        — a wrong guess won&rsquo;t be made on future forms.
      </>,
    );
  }

  return (
    <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-8 py-9 text-center">
      <div className="w-[52px] h-[52px] mx-auto mb-3.5 rounded-full border-2 border-[color:var(--mp-ok)] text-[color:var(--mp-ok)] flex items-center justify-center">
        <Check className="w-6 h-6" />
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight text-[color:var(--mp-ink)]">
        {session.cleared} card{session.cleared === 1 ? "" : "s"} cleared.
      </h2>
      {lines.length > 0 ? (
        <div className="mx-auto max-w-[430px] text-left flex flex-col gap-2.5 mt-5">
          {lines.map((line, i) => (
            <div
              key={i}
              className="flex gap-2.5 text-[13px] text-[color:var(--mp-ink)] items-baseline"
            >
              <span className="flex-none w-1.5 h-1.5 rounded-full bg-[color:var(--mp-ok)] translate-y-[-2px]" />
              <div className="text-[color:var(--mp-ink-secondary)]">{line}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2.5 justify-center mt-6">
        <Button variant="outline" className="h-9" onClick={onHome}>
          Back to Home
        </Button>
        <Button
          className="bg-[color:var(--mp-primary)] hover:bg-[color:var(--mp-primary-hover)] text-white h-9"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function QueueClear({ catchChip }: { catchChip: React.ReactNode }) {
  return (
    <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-9">
      <EmptyState
        message="Queue is clear"
        description="Nothing blocks the next fills. New cards appear when the extension meets a field it can't fill or a form it doesn't know."
        action={catchChip}
      />
    </div>
  );
}

function aOrAn(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

// Storybook-style demo of the six M1 triage primitives, in both densities.
// Behind an env flag: visible in dev, or when VITE_DEV_PRIMITIVES=1 is set
// (add that var to the Vercel project to verify on a preview).
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SummaryChips } from "@/components/triage/SummaryChips";
import { GroupedList, type GroupedListDensity } from "@/components/triage/GroupedList";
import { StatusPill } from "@/components/triage/StatusPill";
import { ActionBadge, type ActionBadgeTone } from "@/components/triage/ActionBadge";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { RowCta } from "@/components/triage/RowCta";

const enabled = import.meta.env.DEV || import.meta.env.VITE_DEV_PRIMITIVES === "1";

export const Route = createFileRoute("/dev/primitives")({
  beforeLoad: () => {
    if (!enabled) throw notFound();
  },
  component: PrimitivesPage,
});

// Demo-only hues, standing in for status_configs.color until M2 wiring.
const DEMO_BLUE = "#2563eb";
const DEMO_TEAL = "#0891b2";
const DEMO_GRAY = "#9ca3af";
const DEMO_GREEN = "#059669";

const TONES: ActionBadgeTone[] = ["ok", "info", "warn", "danger", "pending", "neutral"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-5">
      <h2 className="mb-4 text-[var(--mp-text-sm)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function demoRow(provider: string, payer: string, pill: React.ReactNode, cta: string) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="truncate text-[var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
          {provider}
        </div>
        <div className="truncate text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
          {payer}
        </div>
      </div>
      {pill}
      <span className="tabular-nums text-[var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)] w-10 text-right">
        34d
      </span>
      <RowCta label={cta} onClick={() => {}} />
    </div>
  );
}

function PrimitivesPage() {
  const [selectedChip, setSelectedChip] = useState<string | null>("all");
  const [density, setDensity] = useState<GroupedListDensity>("comfortable");

  const groups = [
    {
      id: "g1",
      title: "Sunrise Medical Group",
      count: 3,
      progress: { value: 2, max: 3 },
      rows: [
        demoRow(
          "Dr. Sonny Ali",
          "Aetna · TX",
          <StatusPill label="In Progress" color={DEMO_BLUE} suffix="awaiting CAQH docs" />,
          "Request docs",
        ),
        demoRow(
          "Dr. Mira Chen",
          "UHC · TX",
          <StatusPill label="Submitted" color={DEMO_TEAL} />,
          "Follow up",
        ),
        demoRow(
          "Dr. Ada Okafor",
          "Cigna · OK",
          <StatusPill label="Denied" color={DEMO_GRAY} suffix="appeal window 12d" />,
          "Start appeal",
        ),
      ],
    },
    {
      id: "g2",
      title: "Lakeview Health Partners",
      count: 2,
      progress: { value: 1, max: 2 },
      rows: [
        demoRow(
          "Dr. Leah Park",
          "BCBS · NM",
          <StatusPill label="In-Network" color={DEMO_GREEN} />,
          "View case",
        ),
        demoRow(
          "Dr. Omar Reyes",
          "Aetna · NM",
          <StatusPill label="Not Started" color={DEMO_GRAY} suffix="pre-credentialing" />,
          "Open checklist",
        ),
      ],
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader
        title="Triage primitives"
        description="M1 component demo — dev only, not linked from nav."
        actions={
          <div className="flex items-center gap-1 rounded-[var(--mp-radius-sm)] border border-mp-border bg-mp-card p-0.5">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDensity(d)}
                className={`rounded-[4px] px-2.5 py-1 text-[var(--mp-text-xs)] font-medium capitalize transition-colors ${
                  density === d
                    ? "bg-mp-primary text-white"
                    : "text-[color:var(--mp-ink-secondary)] hover:bg-mp-muted"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        }
      />

      <Section title="SummaryChips">
        <SummaryChips
          chips={[
            { id: "all", label: "All open", n: 24 },
            { id: "action", label: "Needs action", n: 7, warn: true },
            { id: "waiting", label: "Waiting on payer", n: 11 },
            { id: "stalled", label: "Stalled", n: 4, warn: true },
            { id: "closed", label: "Closed 30d", n: 9 },
          ]}
          selected={selectedChip}
          onSelect={setSelectedChip}
        />
      </Section>

      <Section title="StatusPill">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill label="Not Started" color={DEMO_GRAY} />
          <StatusPill label="In Progress" color={DEMO_BLUE} />
          <StatusPill label="In Progress" color={DEMO_BLUE} suffix="45d silent" />
          <StatusPill label="Submitted" color={DEMO_TEAL} />
          <StatusPill label="In-Network" color={DEMO_GREEN} />
          <StatusPill label="Denied" color={DEMO_GRAY} suffix="appeal" />
        </div>
      </Section>

      <Section title="ActionBadge">
        <div className="flex flex-wrap items-center gap-3">
          {TONES.map((tone) => (
            <ActionBadge key={tone} tone={tone} text={tone === "warn" ? "Stalled" : tone} />
          ))}
          <ActionBadge tone="danger" text="Blocked · CAQH docs" />
        </div>
      </Section>

      <Section title="ProgressBar">
        <div className="max-w-xs space-y-3">
          <ProgressBar value={1} max={4} />
          <ProgressBar value={2} max={3} />
          <ProgressBar value={5} max={5} />
        </div>
      </Section>

      <Section title="RowCta">
        <div className="flex flex-wrap items-center gap-3">
          <RowCta label="Start appeal" onClick={() => {}} />
          <RowCta label="Escalate" onClick={() => {}} />
          <RowCta label="Request docs" onClick={() => {}} />
        </div>
      </Section>

      <Section title={`GroupedList — ${density}`}>
        <GroupedList groups={groups} density={density} />
      </Section>
    </div>
  );
}

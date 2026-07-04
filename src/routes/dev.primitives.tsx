// Storybook-style demo of the triage primitives. Behind an env flag: visible
// in dev, or when VITE_DEV_PRIMITIVES=1 is set (add that var to the Vercel
// project to verify on a preview).
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterCards } from "@/components/triage/FilterCards";
import { GroupedList } from "@/components/triage/GroupedList";
import { CaseTable, type CaseTableRow } from "@/components/triage/CaseTable";
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

// Demo-only hues, standing in for status_configs.color.
const DEMO_BLUE = "#2563eb";
const DEMO_TEAL = "#0891b2";
const DEMO_GRAY = "#9ca3af";
const DEMO_GREEN = "#059669";
const DEMO_RED = "#dc2626";

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

function demoRow(
  id: string,
  payer: string,
  status: CaseTableRow["status"],
  contract: CaseTableRow["contract"],
  days: number,
  cta: string | null,
  alert = false,
): CaseTableRow {
  return {
    id,
    lead: (
      <span className="text-[var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
        {payer}
      </span>
    ),
    status,
    contract,
    lastTouch: "2d ago",
    days,
    daysStrong: alert,
    action: cta ? { label: cta, onClick: () => {} } : null,
    alert,
    onOpen: () => {},
  };
}

function PrimitivesPage() {
  const [selectedCard, setSelectedCard] = useState("all");

  const groups = [
    {
      id: "g1",
      header: (
        <div className="flex flex-1 min-w-0 items-center gap-3">
          <span className="truncate text-[var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
            Sunrise Medical Group
          </span>
          <span className="hidden sm:flex items-center gap-2 ml-auto">
            <span className="w-20">
              <ProgressBar value={2} max={3} />
            </span>
            <span className="tabular-nums whitespace-nowrap text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              2 of 3 in-network
            </span>
          </span>
          <ActionBadge tone="danger" text="1 needs action" />
        </div>
      ),
      children: (
        <CaseTable
          leadLabel="Payer"
          rows={[
            demoRow(
              "r1",
              "Cigna",
              { label: "Denied", color: DEMO_RED, suffix: "appeal filed" },
              null,
              21,
              "Start appeal",
              true,
            ),
            demoRow(
              "r2",
              "Aetna",
              { label: "In Progress", color: DEMO_BLUE },
              { label: "In-Network", color: DEMO_GREEN },
              6,
              "Request docs",
            ),
            demoRow(
              "r3",
              "UHC",
              { label: "Submitted", color: DEMO_TEAL },
              { label: "Not Started", color: DEMO_GRAY },
              11,
              null,
            ),
          ]}
        />
      ),
    },
    {
      id: "g2",
      header: (
        <div className="flex flex-1 min-w-0 items-center gap-3">
          <span className="truncate text-[var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
            Lakeview Health Partners
          </span>
          <span className="ml-auto" />
        </div>
      ),
      children: (
        <CaseTable
          leadLabel="Payer"
          rows={[
            demoRow(
              "r4",
              "BCBS",
              { label: "In-Network", color: DEMO_GREEN },
              { label: "In-Network", color: DEMO_GREEN },
              3,
              "View case",
            ),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader
        title="Triage primitives"
        description="Component demo — dev only, not linked from nav."
      />

      <Section title="FilterCards">
        <FilterCards
          cards={[
            { id: "all", label: "All open cases", n: 42 },
            { id: "needs", label: "Needs your action", n: 3 },
            { id: "inprog", label: "In progress", n: 29 },
            { id: "awaiting", label: "Awaiting effective date", n: 6 },
          ]}
          selected={selectedCard}
          onSelect={setSelectedCard}
        />
      </Section>

      <Section title="StatusPill">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill label="Not Started" color={DEMO_GRAY} />
          <StatusPill label="In Progress" color={DEMO_BLUE} />
          <StatusPill label="In Progress" color={DEMO_BLUE} suffix="45d silent" />
          <StatusPill label="Submitted" color={DEMO_TEAL} />
          <StatusPill label="In-Network" color={DEMO_GREEN} />
          <StatusPill label="Denied" color={DEMO_RED} suffix="appeal filed" />
        </div>
      </Section>

      <Section title="ActionBadge">
        <div className="flex flex-wrap items-center gap-3">
          {TONES.map((tone) => (
            <ActionBadge key={tone} tone={tone} text={tone === "warn" ? "Stalled" : tone} />
          ))}
          <ActionBadge tone="warn" text="Blocked · docs" />
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
          <RowCta
            label="Chase the payer rep about the stalled recredentialing packet again"
            onClick={() => {}}
          />
        </div>
      </Section>

      <Section title="GroupedList + CaseTable">
        <GroupedList groups={groups} />
      </Section>
    </div>
  );
}

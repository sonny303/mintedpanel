// Read-only rendering of a template's task definitions: the wizard's Review
// step AND the version-history viewer both render through this, so "what a
// version says" always looks exactly like the Review preview (E1.7b F1.7b.2).
// Tokens render as chips; online_form steps chip their portal link state; the
// E1.7b step fields (turnaround/cadence/artifacts) render as metadata lines.
import { EmptyState } from "@/components/EmptyState";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, SOPEmailRecipient, SOPTaskDefinition } from "@/types";

const STEP_TYPE_LABELS: Record<string, string> = {
  online_form: "Online form",
  draft_email: "Draft email",
  pdf: "PDF",
  fax: "Fax",
  phone: "Phone",
  mail: "Mail",
};

// E1.7b F1.7b.5 (TE-15) — Review-step chips for a draft-email step's authored
// recipients, so the author sees To/CC before publishing. A literal shows the
// address; a token shows its {{token}} form (authoring view — unresolved here).
function recipientLabel(r: SOPEmailRecipient): string {
  return r.source === "literal" ? r.address : `{{${r.token}}}`;
}

function RecipientChipLine({
  label,
  recipients,
}: {
  label: string;
  recipients: SOPEmailRecipient[];
}) {
  if (recipients.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">{label}:</span>
      {recipients.map((r, i) => (
        <span
          key={i}
          className={
            r.source === "token"
              ? "inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 font-mono text-[11px]"
              : "inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 text-[11px]"
          }
        >
          {recipientLabel(r)}
        </span>
      ))}
    </div>
  );
}

export function TemplatePreviewTasks({
  tasks,
  portals,
}: {
  tasks: SOPTaskDefinition[];
  portals: Portal[];
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#E8E5E0] p-6">
        <EmptyState
          message="No tasks defined"
          description="This template will generate no tasks."
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {tasks.map((t, i) => (
        <div key={i} className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{t.title || "Untitled task"}</p>
            <span className="text-xs text-muted-foreground">Day +{t.dueOffsetDays ?? 0}</span>
          </div>
          {t.description ? (
            <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
          ) : null}
          <ol className="space-y-2 mt-3">
            {(t.steps ?? []).map((s, j) => {
              const fields = s.dataFields ?? [];
              const stepType = s.stepType ?? "online_form";
              const portalKey = normalizePortalKey(s.portalKey);
              const portal = portalKey
                ? portals.find((p) => normalizePortalKey(p.portalKey) === portalKey)
                : null;
              const cadence: string[] = [];
              if (typeof s.expectedTurnaroundDays === "number") {
                cadence.push(`~${s.expectedTurnaroundDays} day turnaround`);
              }
              if (typeof s.followUpEveryDays === "number") {
                cadence.push(`follow up every ${s.followUpEveryDays} days`);
              }
              const artifacts = s.requiredArtifacts ?? [];
              return (
                <li key={j} className="rounded-md border border-[#E8E5E0] p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-foreground">{s.label || `Step ${j + 1}`}</p>
                    {stepType !== "online_form" ? (
                      <span className="shrink-0 inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {STEP_TYPE_LABELS[stepType] ?? stepType}
                      </span>
                    ) : null}
                  </div>
                  {stepType === "online_form" ? (
                    portal ? (
                      <span className="mt-1 inline-flex items-center rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[11px] text-[#059669]">
                        Portal: {portal.name}
                      </span>
                    ) : (
                      <span className="mt-1 inline-flex items-center rounded-full border border-[#FDE68A] bg-[#FEF3C7] px-2 py-0.5 text-[11px] text-[#92400E]">
                        Not linked for fill
                      </span>
                    )
                  ) : null}
                  {stepType === "draft_email" && s.emailTemplate ? (
                    <>
                      <RecipientChipLine label="To" recipients={s.emailTemplate.to ?? []} />
                      <RecipientChipLine label="Cc" recipients={s.emailTemplate.cc ?? []} />
                    </>
                  ) : null}
                  {s.detail ? <p className="text-muted-foreground mt-0.5">{s.detail}</p> : null}
                  {cadence.length > 0 ? (
                    <p className="text-muted-foreground mt-0.5">{cadence.join(" · ")}</p>
                  ) : null}
                  {artifacts.length > 0 ? (
                    <p className="text-muted-foreground mt-0.5">
                      Artifacts: {artifacts.join(", ")}
                    </p>
                  ) : null}
                  {fields.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {fields.map((f, k) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{f.label || f.token}</span>
                          <span className="inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 font-mono text-[11px]">
                            {`{{${f.token}}}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

// Live preview / token reference side panel for the SOP template editor.
import type { SOPTaskDefinition } from '@/types';

interface DataField {
  label: string;
  token: string;
}

interface TokenHelpPanelProps {
  previewTasks: SOPTaskDefinition[];
  sampleValues: Record<string, string>;
}

export function TokenHelpPanel({ previewTasks, sampleValues }: TokenHelpPanelProps) {
  return (
    <aside className="lg:sticky lg:top-6 self-start">
      <div className="rounded-md border border-[#E8E5E0] bg-card">
        <div className="px-4 h-10 flex items-center border-b border-[#E8E5E0]">
          <h2 className="text-sm font-semibold">Live preview</h2>
        </div>
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {previewTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add tasks to see how this template renders.
            </p>
          ) : (
            previewTasks.map((t, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{t.title || 'Untitled task'}</p>
                  <span className="text-xs text-muted-foreground">
                    Day +{t.dueOffsetDays ?? 0}
                  </span>
                </div>
                {t.description ? (
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                ) : null}
                <ol className="space-y-2 mt-2">
                  {(t.steps ?? []).map((s, j) => {
                    const fields =
                      (s as { dataFields?: DataField[] }).dataFields ?? [];
                    return (
                      <li
                        key={j}
                        className="rounded-md border border-[#E8E5E0] p-2 text-xs"
                      >
                        <p className="text-foreground">{s.label || `Step ${j + 1}`}</p>
                        {fields.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            {fields.map((f, k) => (
                              <div
                                key={k}
                                className="flex items-center justify-between gap-2"
                              >
                                <span className="text-muted-foreground">
                                  {f.label || f.token}
                                </span>
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
            ))
          )}
        </div>
        <div className="px-4 py-3 border-t border-[#E8E5E0] text-xs text-muted-foreground">
          Sample value example —{' '}
          <span className="font-mono">{sampleValues['provider.firstName']}</span>{' '}
          <span className="font-mono">{sampleValues['provider.lastName']}</span>,
          NPI <span className="font-mono">{sampleValues['provider.npi']}</span>.
        </div>
      </div>
    </aside>
  );
}

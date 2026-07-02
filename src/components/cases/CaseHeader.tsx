// Case detail header: provider name, submeta, and both status pills
// (credentialing + group contract) with a Change button. The forwarding ID
// lives in the Case Facts card, not here.
import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { StatusPill, hexToStatusColor } from '@/components/StatusPill';
import type { CaseDetail, StatusConfig } from '@/types';

export function CaseHeader({
  c,
  credStatus,
  contractStatus,
  canEdit,
  onOpenStatus,
}: {
  c: CaseDetail;
  credStatus: StatusConfig | null | undefined;
  contractStatus: StatusConfig | null | undefined;
  canEdit: boolean;
  onOpenStatus: () => void;
}) {
  const providerName = c.provider
    ? `${c.provider.firstName} ${c.provider.lastName}${c.provider.credentials ? `, ${c.provider.credentials}` : ''}`
    : 'Unknown provider';

  return (
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2 flex-wrap">
          {c.provider ? (
            <Link
              to="/providers/$id"
              params={{ id: c.provider.id }}
              className="hover:underline"
            >
              {providerName}
            </Link>
          ) : providerName}
          <Badge variant="secondary" className="font-normal text-[10px] uppercase tracking-wide">
            Initial Credentialing
          </Badge>
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          {c.payer?.name ?? '—'}
          <span className="text-border">·</span>
          {c.state}
          {c.specialty ? (<><span className="text-border">·</span>{c.specialty}</>) : null}
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Credentialing
          </span>
          <div className="flex items-center gap-2">
            {credStatus ? (
              <StatusPill status={hexToStatusColor(credStatus.color)} label={credStatus.label} />
            ) : (
              <StatusPill status="gray" label="—" />
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={onOpenStatus}
              >
                Change
              </Button>
            )}
          </div>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Group Contract
          </span>
          <div className="flex items-center gap-2">
            {contractStatus ? (
              <StatusPill status={hexToStatusColor(contractStatus.color)} label={contractStatus.label} />
            ) : (
              <StatusPill status="gray" label="No contract" />
            )}
            <Link
              to="/reports"
              search={{ tab: 'contracts' } as never}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              View contract
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

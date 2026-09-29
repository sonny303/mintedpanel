import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingChangeFeed } from "@/components/reporting/BillingChangeFeed";
import { BillingClearanceLookup } from "@/components/reporting/BillingClearanceLookup";
import { useBillingReadiness, type BillingReadinessData } from "@/hooks/useBillingReadiness";

export function BillingReadinessReport() {
  const readiness = useBillingReadiness();
  const key = `${readiness.orgId ?? "no-org"}:${readiness.userId ?? "no-session"}`;

  return <BillingReadinessWorkspace key={key} readiness={readiness} />;
}

function BillingReadinessWorkspace({ readiness }: { readiness: BillingReadinessData }) {
  const [tab, setTab] = useState("lookup");

  if (!readiness.orgId) {
    return (
      <EmptyState
        message="Select an organization to assess billing readiness."
        description="This report uses only the active organization's credentialing records."
      />
    );
  }

  if (!readiness.userId) {
    return <EmptyState message="Sign in to assess billing readiness." />;
  }

  const readUnavailable = readiness.isError;
  const waitingForCurrentRead = !readiness.data && !readUnavailable;

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted-foreground">
        This assessment summarizes recorded enrollment prerequisites. It does not establish
        claim-level eligibility, retro authorization, or payment.
      </p>

      {readUnavailable ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-[13px] text-foreground"
        >
          <span>
            Current organization reads did not complete. No readiness result or digest is available
            until the source data loads successfully.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void readiness.refresh()}
          >
            Retry
          </Button>
        </div>
      ) : waitingForCurrentRead ? (
        <div
          role="status"
          className="space-y-2"
          aria-label="Loading current billing readiness data"
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
          <span className="sr-only">Loading current organization data…</span>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Billing readiness views">
          <TabsTrigger value="lookup">Clearance Lookup</TabsTrigger>
          <TabsTrigger value="feed">Change Feed</TabsTrigger>
        </TabsList>
        <TabsContent value="lookup" forceMount className="data-[state=inactive]:hidden">
          <BillingClearanceLookup data={readiness.data} />
        </TabsContent>
        <TabsContent value="feed" forceMount className="data-[state=inactive]:hidden">
          <BillingChangeFeed readiness={readiness} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Reports at /reports — thin tab switcher with URL-driven active tab.
// Individual tab implementations live in src/components/reports/*.
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContractsTab } from '@/components/reports/ContractsTab';
import { MatrixTab } from '@/components/reports/MatrixTab';
import { SummaryTab } from '@/components/reports/SummaryTab';
import { RosterTab } from '@/components/reports/RosterTab';

interface ReportsSearch {
  tab?: 'summary' | 'contracts' | 'matrix' | 'roster';
}

export const Route = createFileRoute('/reports')({
  validateSearch: (s: Record<string, unknown>): ReportsSearch => {
    const tab = s.tab;
    if (
      tab === 'contracts' ||
      tab === 'matrix' ||
      tab === 'summary' ||
      tab === 'roster'
    )
      return { tab };
    return {};
  },
  component: ReportsPage,
});

function ReportsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const initialTab = search.tab ?? 'contracts';

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      <Tabs
        value={initialTab}
        onValueChange={(v) =>
          navigate({ search: { tab: v as ReportsSearch['tab'] }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="matrix">Enrollment Matrix</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="pt-4">
          <SummaryTab />
        </TabsContent>
        <TabsContent value="contracts" className="pt-4">
          <ContractsTab />
        </TabsContent>
        <TabsContent value="matrix" className="pt-4">
          <MatrixTab />
        </TabsContent>
        <TabsContent value="roster" className="pt-4">
          <RosterTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

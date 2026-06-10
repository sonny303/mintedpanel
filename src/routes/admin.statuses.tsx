import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/admin/statuses')({
  component: Page,
});

function Page() {
  return <PageHeader title="Statuses" />;
}

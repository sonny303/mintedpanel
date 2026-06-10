import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/admin/payers')({
  component: Page,
});

function Page() {
  return <PageHeader title="Payers" />;
}

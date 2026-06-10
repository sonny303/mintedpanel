import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/admin/mso-routing')({
  component: Page,
});

function Page() {
  return <PageHeader title="MSO Routing" />;
}

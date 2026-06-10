import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/admin/settings')({
  component: Page,
});

function Page() {
  return <PageHeader title="Settings" />;
}

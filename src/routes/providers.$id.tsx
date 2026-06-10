import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/providers/$id')({
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <PageHeader title={`Provider ${id}`} />;
}

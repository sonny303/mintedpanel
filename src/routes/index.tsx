// Dashboard page displaying overview of key operational metrics.
// This page serves as the landing dashboard after user login.
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';

export const Route = createFileRoute('/')({
  component: Page,
});

function Page() {
  return <PageHeader title="Dashboard" />;
}

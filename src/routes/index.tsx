// Dashboard page displaying overview of key operational metrics.
import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { getProviders } from '@/services/providers';

export const Route = createFileRoute('/')({
  component: Page,
});

function Page() {
  useEffect(() => {
    getProviders()
      .then((data) => {
        console.log('Providers logged on dashboard:', data);
      })
      .catch((error) => {
        console.error('Error fetching providers on dashboard:', error);
      });
  }, []);

  return <PageHeader title="Dashboard" />;
}

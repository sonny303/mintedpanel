import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ProviderRosterForm } from "@/components/onboarding/ProviderRosterForm";
import { useProvider, useProviderGroupAssignments } from "@/hooks/useProviders";
import { useProviderGroups, useStateLicensesByProvider } from "@/hooks/useLookups";
import { useAuthStore } from "@/lib/auth-store";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function MountedRoster() {
  const [open, setOpen] = useState(true);
  const provider = useProvider("prov-ob");
  const groups = useProviderGroups();
  const licenses = useStateLicensesByProvider("prov-ob");
  const assignments = useProviderGroupAssignments();
  return (
    <>
      <button onClick={() => setOpen(true)}>Open roster editor</button>
      <button
        onClick={() => {
          void Promise.all([provider.refetch(), licenses.refetch(), assignments.refetch()]);
        }}
      >
        Refresh fixture queries
      </button>
      {open && provider.data && groups.data ? (
        <ProviderRosterForm
          provider={provider.data}
          groups={groups.data}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <Toaster />
    </>
  );
}

await useAuthStore.getState().init();
const container = document.getElementById("p03-roster");
if (!container) throw new Error("P03 roster fixture root is missing");
createRoot(container).render(
  <QueryClientProvider client={client}>
    <MountedRoster />
  </QueryClientProvider>,
);

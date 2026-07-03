// M1 nav adds "Users" to ADMIN. Thin route over the existing MembersPanel;
// the Settings → Team tab keeps working until M6 cleanup.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { MembersPanel } from "@/components/settings/MembersPanel";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Users" description="Manage who has access to this organization." />
      <MembersPanel />
    </div>
  );
}

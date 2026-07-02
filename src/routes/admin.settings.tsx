// Admin → Settings: two tabs. Organization (name, provider groups,
// facilities/insurance) and Team (memberships). Panels live in
// src/components/settings/*.
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrgPanel } from '@/components/settings/OrgPanel';
import { GroupsPanel } from '@/components/settings/GroupsPanel';
import { FacilitiesPanel } from '@/components/settings/FacilitiesPanel';
import { MembersPanel } from '@/components/settings/MembersPanel';

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Group & Locations"
        description="Provider groups, facilities, insurance, and team."
      />
      <Tabs defaultValue="organization" className="w-full">
        <TabsList className="bg-[#FAFAF9] border border-[#E8E5E0] rounded-md">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>
        <TabsContent value="organization" className="mt-6 space-y-6">
          <OrgPanel />
          <GroupsPanel />
          <FacilitiesPanel />
        </TabsContent>
        <TabsContent value="team" className="mt-6">
          <MembersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// E6.2 F6.2.1 — the group hub's layout: resolves the group and renders the
// simple route-derived breadcrumb (`Groups › {Group} › {Area}`) above every
// nested page. Every crumb navigates; the current segment is text with
// aria-current. No breadcrumb framework — the area label derives from the
// pathname (the epic's "simple route-derived" call).
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useProviderGroups } from "@/hooks/useLookups";

export const Route = createFileRoute("/groups/$groupId")({
  component: GroupLayout,
});

function areaLabel(pathname: string): string | null {
  if (pathname.endsWith("/facilities")) return "Facilities";
  if (pathname.endsWith("/payer-network")) return "Payer Network";
  return null;
}

function GroupLayout() {
  const { groupId } = Route.useParams();
  const groupsQ = useProviderGroups();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
  const area = areaLabel(pathname);

  if (groupsQ.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!group) {
    return (
      <div className="max-w-3xl">
        <EmptyState
          message="Group not found"
          description="This group doesn't exist in the active organization."
        />
        <Link to="/groups" className="text-[13px] font-medium text-[#1B4D3E] underline">
          Back to Groups
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px]">
        <Link to="/groups" className="text-muted-foreground hover:text-foreground">
          Groups
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {area ? (
          <>
            <Link
              to="/groups/$groupId"
              params={{ groupId }}
              className="text-muted-foreground hover:text-foreground"
            >
              {group.name}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span aria-current="page" className="font-medium text-foreground">
              {area}
            </span>
          </>
        ) : (
          <span aria-current="page" className="font-medium text-foreground">
            {group.name}
          </span>
        )}
      </nav>
      <Outlet />
    </div>
  );
}

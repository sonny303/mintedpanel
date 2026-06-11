import { Link, useRouterState } from '@tanstack/react-router';
import { Separator } from '@/components/ui/separator';
import {
  LayoutDashboard,
  Users,
  FileStack,
  CheckSquare,
  BarChart3,
  Settings,
  Shield,
  FileText,
  Network,
  Building2,
  CheckCircle2,
} from 'lucide-react';

type NavLink = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const mainNav: NavLink[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/providers', label: 'Providers', icon: Users },
  { to: '/cases', label: 'Cases', icon: FileStack },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const adminNav: NavLink[] = [
  { to: '/admin/statuses', label: 'Statuses', icon: CheckCircle2 },
  { to: '/admin/templates', label: 'Templates', icon: FileText },
  { to: '/admin/mso-routing', label: 'MSO Routing', icon: Network },
  { to: '/admin/payers', label: 'Payers', icon: Building2 },
  { to: '/admin/audit', label: 'Audit Log', icon: FileStack },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

import { useRole } from '@/lib/auth-store';

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = useRole();
  const showAdmin = role === 'admin';

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + '/');

  const itemClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-md text-[14px] ${
      active
        ? 'bg-primary/10 text-primary font-medium'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
    }`;

  return (
    <aside className="w-[220px] flex-shrink-0 border-r border-border bg-card flex flex-col h-full">
      <div className="h-14 flex items-center px-4 bg-primary text-primary-foreground">
        <div className="flex items-center gap-2 font-semibold text-[16px] tracking-tight">
          <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          OpenPanel
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-6">
        <nav className="px-2 space-y-0.5" aria-label="Main">
          {mainNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to, item.exact);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={itemClass(active)}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {showAdmin ? (
          <>
            <div className="px-5">
              <Separator />
            </div>

            <div className="px-2">
              <h3 className="px-3 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Admin
              </h3>
              <nav className="space-y-0.5" aria-label="Admin">
                {adminNav.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={itemClass(active)}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "@/components/layout/AppShell";
import { NoOrgScreen } from "@/components/org/NoOrgScreen";
import { useAuthStore, registerQueryClient } from "@/lib/auth-store";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Minted Panel Credentialing" },
      {
        name: "description",
        content:
          "Minted Panel handles credentialing and contracting for healthcare provider groups across payers and states, so your team can focus on care.",
      },
      { name: "author", content: "Minted Panel" },
      { property: "og:title", content: "Minted Panel Credentialing" },
      {
        property: "og:description",
        content:
          "Minted Panel handles credentialing and contracting for healthcare provider groups across payers and states, so your team can focus on care.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Minted Panel Credentialing" },
      {
        name: "twitter:description",
        content:
          "Minted Panel handles credentialing and contracting for healthcare provider groups across payers and states, so your team can focus on care.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/1b049f6b-466c-4443-84c3-0c472bcd49a5",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/1b049f6b-466c-4443-84c3-0c472bcd49a5",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      // Geist (E0.9 design-system conformance) is self-hosted via @fontsource
      // imports in styles.css (no Google Fonts CDN) — no manual preload needed.
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthRoute = pathname === "/login";
  const isRootRoute = pathname === "/";
  // Dev-only demo routes (env-flag-gated) skip the session redirect but still
  // render inside the shell, so shell + primitives are verifiable without auth.
  const isDevRoute = pathname.startsWith("/dev");
  // /privacy is fully public (Chrome Web Store requires a hosted policy URL
  // reachable without sign-in): no session redirect, rendered outside AppShell.
  const isPrivacyRoute = pathname === "/privacy";
  // E0.5/E0.6 public trust-boundary surfaces: the E0.5 token capture link, the
  // E0.5 inbound contact form, and the E0.6 read-only report share all render
  // WITHOUT a session, outside the app shell (BD-1).
  const isCaptureRoute = pathname.startsWith("/capture/");
  const isContactRoute = pathname === "/contact";
  const isShareRoute = pathname.startsWith("/share/");
  const isChromelessRoute =
    isAuthRoute ||
    isRootRoute ||
    isPrivacyRoute ||
    isCaptureRoute ||
    isContactRoute ||
    isShareRoute;
  const isPublicRoute = isChromelessRoute || isDevRoute;
  const router = useRouter();
  const init = useAuthStore((s) => s.init);
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const initError = useAuthStore((s) => s.initError);
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);

  useEffect(() => {
    registerQueryClient(queryClient);
  }, [queryClient]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!initialized) return;
    if (!session && !isPublicRoute) {
      router.navigate({ to: "/login", replace: true });
    }
  }, [initialized, session, isPublicRoute, router]);

  if (!initialized) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background text-[13px] text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (initError && session && !isPublicRoute) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-md border border-[#E8E5E0] bg-white p-6 text-center">
          <h2 className="text-[15px] font-semibold text-foreground">Can't reach Minted Panel</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">Check your connection.</p>
          <button
            onClick={() => {
              void init();
            }}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session && !isPublicRoute) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {isChromelessRoute ? (
        <Outlet />
      ) : memberships.length === 0 ? (
        // Signed in but part of no org yet — bootstrap the first org before the
        // app shell (which mounts org-scoped hooks) ever renders.
        <NoOrgScreen />
      ) : (
        <AppShell>
          {/* TE-4 (F0.0.3): keying the routed subtree on the active org forces a
              remount on switch, clearing org-scoped component-local view state
              (selected provider/case/facility, filters, unsaved forms) before
              the new org loads. Server state is cleared by
              auth-store.setActiveOrg -> queryClient.removeQueries(). */}
          <Outlet key={activeOrgId ?? "no-org"} />
        </AppShell>
      )}
      <Toaster />
    </QueryClientProvider>
  );
}

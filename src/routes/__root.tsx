import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  Navigate,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const PUBLIC_PREFIXES = [
  "/auth",
  "/join/",
  "/invite/",
  "/athlete-join/",
  "/athlete-pin-setup",
  "/sitemap.xml",
  "/reports",
  "/training-view/check-in",
  "/training-view/session",
];
const PUBLIC_EXACT = new Set(["/", "/features", "/pricing", "/reports"]);

function isPublicPath(p: string) {
  if (PUBLIC_EXACT.has(p)) return true;
  return PUBLIC_PREFIXES.some((pref) => p === pref || p.startsWith(pref));
}

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { TeamSwitcher } from "@/components/team-switcher";
import { OrgSwitcher } from "@/components/org-switcher";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle, useTheme } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";


function NotFoundComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/index") return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            Home
          </Link>
          <Link to="/performance" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Open app
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Try again</button>
          <a href="/" className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Strength Lab — Athletic Performance Tracker" },
      { name: "description", content: "High school strength & conditioning database. Track athletes, tests, lifts, and attendance." },
      { property: "og:title", content: "Strength Lab — Athletic Performance Tracker" },
      { property: "og:description", content: "Track athletes, tests, lifts, and attendance for your S&C program." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" },
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
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function AppTopBar({ userEmail, onSignOut }: { userEmail: string | null; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur">
      <SidebarTrigger />
      <div className="ml-auto flex items-center gap-2">
        <OrgSwitcher />
        <TeamSwitcher />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
              aria-label="Account"
            >
              <UserIcon className="h-4 w-4" />
              <span className="hidden max-w-[140px] truncate sm:inline">{userEmail ?? "Coach"}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[14rem]">
            {userEmail && <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{userEmail}</DropdownMenuLabel>}
            {userEmail && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const kioskMode = pathname.startsWith("/training-view/");
  const displayMode = pathname.startsWith("/overhead-display");
  const athleteMode = kioskMode || pathname.startsWith("/athlete-join") || pathname === "/athlete" || pathname.startsWith("/athlete/");
  const isPublic = isPublicPath(pathname);

  // Kiosk lock: once an athlete checks in on a shared device, sessionStorage
  // pins them to /training-view/*. Any nav elsewhere bounces back.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("sl.kiosk") === "1" && !kioskMode) {
      window.location.replace("/training-view/session");
    }
  }, [pathname, kioskMode]);

  const [authState, setAuthState] = useState<"loading" | "signed-in" | "signed-out">("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Initialize theme (respects localStorage; defaults to dark)
  useTheme("dark");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setAuthState(data.user ? "signed-in" : "signed-out");
      setUserEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthState(session?.user ? "signed-in" : "signed-out");
      setUserEmail(session?.user?.email ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // "Remember me" enforcement: when the coach unchecks Remember me on /auth,
  // clear the Supabase auth token from localStorage on tab/browser close so
  // the session does not persist to the next launch. Athlete kiosks are not
  // affected (they use a separate PIN flow).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    if (!projectId) return;
    const storageKey = `sb-${projectId}-auth-token`;
    const handler = () => {
      try {
        if (window.localStorage.getItem("sl.rememberMe") === "0") {
          window.localStorage.removeItem(storageKey);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, []);



  useEffect(() => {
    if (authState === "signed-out" && !isPublic && typeof window !== "undefined") {
      let cancelled = false;
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          setAuthState("signed-in");
          setUserEmail(data.session.user.email ?? null);
          return;
        }
        const redirect = encodeURIComponent(`${pathname}${window.location.search}`);
        window.location.replace(`/auth?redirect=${redirect}`);
      });
      return () => { cancelled = true; };
    }
  }, [authState, isPublic, pathname]);

  const handleSignOut = async () => {
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
    } finally {
      if (typeof window !== "undefined") window.location.replace("/auth");
    }
  };

  const showApp = isPublic || authState === "signed-in";
  const useCoachShell = !athleteMode && !displayMode && !isPublic && authState === "signed-in";


  const inner = (
    <main className={cn(
      kioskMode || displayMode
        ? "flex-1"
        : useCoachShell
          ? "flex-1 px-4 py-6 pb-20"
          : athleteMode
            ? "mx-auto max-w-3xl px-4 py-4 pb-20"
            : "mx-auto max-w-6xl px-4 py-6 pb-20",
    )}>

      {showApp ? <Outlet /> : (
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          {authState === "loading" ? "Loading…" : "Redirecting to sign in…"}
        </div>
      )}
    </main>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {useCoachShell ? (
        <SidebarProvider>
          <div className="flex min-h-screen w-full bg-background">
            <AppSidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <AppTopBar userEmail={userEmail} onSignOut={handleSignOut} />
              {inner}
            </div>
          </div>
        </SidebarProvider>
      ) : (
        <div className="min-h-screen bg-background">{inner}</div>
      )}
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}

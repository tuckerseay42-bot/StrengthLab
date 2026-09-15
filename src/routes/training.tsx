import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

export const Route = createFileRoute("/training")({
  head: () => ({ meta: [{ title: "Training — Strength Lab" }] }),
  component: TrainingLayout,
});

type Tab = { label: string; to: string; external?: boolean };
const TABS: Tab[] = [
  { label: "Today", to: "/training/today" },
  { label: "Live", to: "/training/live" },
  { label: "Calendar", to: "/training/calendar" },
  { label: "Completed", to: "/training/completed" },
  { label: "Analytics", to: "/training/analytics" },
];

function TrainingLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold sm:text-2xl">Training</h1>
      </div>
      <nav className="overflow-x-auto border-b border-border/60">
        <ul className="flex min-w-max items-center gap-1">
          {TABS.map((t) => {
            const active = !t.external && (t.to === pathname || pathname.startsWith(t.to + "/"));
            return (
              <li key={t.label}>
                <Link
                  to={t.to}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.external && <ExternalLink className="h-3 w-3 opacity-60" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}

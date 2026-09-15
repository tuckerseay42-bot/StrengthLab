import { Link, useRouterState } from "@tanstack/react-router";
import {
  Satellite,
  LayoutDashboard,
  Users,
  UsersRound,
  CalendarDays,
  Radio,
  CheckCircle2,
  Library,
  Layers,
  FileCheck2,
  BarChart3,
  FileBarChart2,
  Gauge,
  Dumbbell,
  ClipboardCheck,
  CalendarCheck,
  LineChart,
  Trophy,
  Tv,
  Award,
  Building2,
  UserCog,
  ShieldCheck,
  Upload,
  Printer,
  Settings as SettingsIcon,
  User,
  LogIn,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Overview",
    items: [{ to: "/app", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Roster",
    items: [
      { to: "/athletes", label: "Athletes", icon: Users },
      { to: "/teams", label: "Teams", icon: UsersRound },
    ],
  },
  {
    label: "Training",
    items: [
      { to: "/training/today", label: "Today", icon: CalendarCheck },
      { to: "/training/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/programming", label: "Programs", icon: Layers },
      { to: "/training/assigned", label: "Assigned", icon: ClipboardCheck },
      { to: "/rack-console", label: "Training View", icon: Radio },
      { to: "/program-delivery", label: "Program Delivery", icon: Printer },
      { to: "/athlete-qr", label: "Athlete Sign In", icon: LogIn },
      { to: "/training/completed", label: "Completed", icon: CheckCircle2 },
      { to: "/exercises", label: "Exercise Library", icon: Library },
      { to: "/log-review", label: "Log Review", icon: FileCheck2 },
      { to: "/training/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Tracking",
    items: [
      { to: "/tests", label: "Tests", icon: Gauge },
      { to: "/maxes", label: "Training Maxes", icon: Dumbbell },
      { to: "/attendance", label: "Attendance", icon: ClipboardCheck },
      { to: "/gps", label: "GPS Tool", icon: Satellite },
    ],
  },
  {
    label: "Analysis",
    items: [
      { to: "/metrics", label: "Metrics", icon: LineChart },
      { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
      { to: "/live-leaderboard", label: "Live View", icon: Tv },
      { to: "/badges", label: "Badges", icon: Award },
      { to: "/reports", label: "Reports", icon: FileBarChart2 },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/organizations", label: "Organizations", icon: Building2 },
      { to: "/org-members", label: "Coaches & Invites", icon: UserCog },
      { to: "/permissions", label: "Permissions", icon: ShieldCheck },
      { to: "/import", label: "CSV Import", icon: Upload },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
      { to: "/athlete", label: "Athlete Preview", icon: User },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) =>
    to === "/app" ? pathname === "/app" : pathname === to || pathname.startsWith(to + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60 px-2 py-2.5">
        <Link to="/app" className="flex items-center gap-2 px-1">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md brand-bg font-display text-sm shadow-sm">
            SL
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-display text-sm leading-none tracking-tight">
                Strength Lab
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                Performance OS
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {GROUPS.map((g, idx) => (
          <div key={g.label}>
            {idx > 0 && !collapsed && (
              <div className="mx-3 my-1 h-px bg-sidebar-border/50" aria-hidden />
            )}
            <SidebarGroup className="px-2 py-1.5">
              {!collapsed && (
                <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                  {g.label}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {g.items.map((item) => {
                    const active = isActive(item.to);
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className={cn(
                            "h-8 rounded-md text-[13px] font-medium transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          )}
                        >
                          <Link to={item.to} className="flex items-center gap-2.5">
                            <item.icon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                active ? "text-sidebar-primary" : "text-muted-foreground",
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell, NeonCard } from "@/components/marketing-shell";
import {
  Activity, BarChart3, CalendarDays, ClipboardList, Dumbbell, Flame, Gauge,
  LineChart, MonitorPlay, QrCode, Radio, ShieldCheck, Sparkles, Timer, Trophy, Users,
} from "lucide-react";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Features — Strength Lab Hub" },
      { name: "description", content: "Training View, kiosk mode, programming, testing, reporting, analytics, and multi-org tools for elite S&C staffs." },
      { property: "og:title", content: "Features — Strength Lab Hub" },
      { property: "og:description", content: "Everything Strength Lab Hub does for your weight room, program, and reporting." },
      { property: "og:url", content: "https://teamstathub.lovable.app/features" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://teamstathub.lovable.app/features" }],
  }),
  component: FeaturesPage,
});

const PILLARS = [
  {
    tag: "The floor",
    title: "Training View",
    body: "The screen you leave open every session. Live rack tiles, per-set logging, PR pulses, idle-rack alerts, and coach display modes for the whiteboard TV.",
    icon: Gauge,
    items: [
      { icon: Radio, label: "Live rack grid, 2×2 to 4×2" },
      { icon: Trophy, label: "PR neon pulse + confetti" },
      { icon: MonitorPlay, label: "Coach + overhead display modes" },
      { icon: Activity, label: "Auto set progression" },
    ],
  },
  {
    tag: "The athletes",
    title: "Kiosk & QR sign-in",
    body: "Athletes scan a rack QR, enter a 6-digit PIN, and drop right into their assigned workout. They can't navigate anywhere else on the device.",
    icon: QrCode,
    items: [
      { icon: ShieldCheck, label: "PIN-secured OTP verify" },
      { icon: Users, label: "Auto attendance capture" },
      { icon: Timer, label: "Quadrant reset on finish" },
      { icon: Dumbbell, label: "Self-serve set logging" },
    ],
  },
  {
    tag: "The plan",
    title: "Programming workspace",
    body: "Phase → cycle → session → version. Two-panel builder with drag-to-order sets, autosave, idempotent assignment, and one-click publish to a team.",
    icon: ClipboardList,
    items: [
      { icon: CalendarDays, label: "Date-picker publish + assign" },
      { icon: Flame, label: "Templates & duplicate" },
      { icon: Dumbbell, label: "Time / distance / MPH inputs" },
      { icon: Sparkles, label: "Exercise library scoped to org" },
    ],
  },
  {
    tag: "The data",
    title: "Testing, PRs & reports",
    body: "Sprints, jumps, lifts, and custom metrics — logged in seconds or MPH. Athlete report cards and team dashboards with PDF and CSV export.",
    icon: BarChart3,
    items: [
      { icon: LineChart, label: "Velocity + volume trends" },
      { icon: Trophy, label: "Auto-detected PRs" },
      { icon: BarChart3, label: "Athlete + team PDF exports" },
      { icon: ShieldCheck, label: "Coach/admin gated" },
    ],
  },
];

function FeaturesPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-10">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">Product</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Every rack, every set, every PR.
          </h1>
          <p className="mt-4 text-muted-foreground sm:text-lg">
            Strength Lab Hub covers the entire coaching loop — from writing a program to running the floor to
            handing a parent a report card.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-6 px-4 pb-16">
        {PILLARS.map((p) => (
          <NeonCard key={p.title} className="p-8">
            <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">{p.tag}</div>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-md text-white"
                    style={{ background: "linear-gradient(135deg, oklch(0.62 0.19 255), oklch(0.55 0.24 295))" }}
                  >
                    <p.icon className="h-5 w-5" />
                  </span>
                  <h2 className="font-display text-2xl font-semibold">{p.title}</h2>
                </div>
                <p className="mt-4 text-sm text-muted-foreground sm:text-base">{p.body}</p>
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {p.items.map((it) => (
                  <li key={it.label} className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm">
                    <it.icon className="h-4 w-4 text-[color:oklch(0.72_0.18_255)]" />
                    {it.label}
                  </li>
                ))}
              </ul>
            </div>
          </NeonCard>
        ))}
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24 text-center">
        <h3 className="font-display text-3xl font-bold">Ready to run your next session on it?</h3>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/auth" className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Strength Lab Hub Sign in
          </Link>
          <Link to="/pricing" className="inline-flex h-11 items-center rounded-md border border-white/15 bg-white/5 px-6 text-sm font-medium hover:bg-white/10">
            See pricing
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell, NeonCard } from "@/components/marketing-shell";
import { Gauge, ArrowRight, Lock, Satellite, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/reports/")({
  head: () => ({
    meta: [
      { title: "Free Reports for Coaches & Athletes — Strength Lab Hub" },
      { name: "description", content: "Free, no-login performance reports from Strength Lab Hub. Start with the Sprint Speed Profile report — size-adjusted sprint scoring in seconds." },
      { property: "og:title", content: "Free Performance Reports — Strength Lab Hub" },
      { property: "og:description", content: "No-login reports for athletes, parents, and coaches." },
      { property: "og:url", content: "https://www.strengthlabhub.com/reports" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://www.strengthlabhub.com/reports" }],
  }),
  component: ReportsIndex,
});

const LIVE = [
  {
    to: "/reports/speed-potential" as const,
    name: "Sprint Speed Profile",
    body: "Enter height, bodyweight, and sprint splits. Get split velocities, peak MPH, pounds per inch, a predicted 40, and a size-adjusted speed tier.",
    icon: Gauge,
  },
  {
    to: "/reports/gps-report" as const,
    name: "GPS Report Card Builder",
    body: "Upload a practice GPS export and get printable athlete report cards — top speed, player load, sprint yards and load flags. Parsed in your browser, nothing uploaded.",
    icon: Satellite,
  },
  {

    to: "/reports/kpi-report" as const,
    name: "KPI Report Card Builder",
    body: "Upload a testing spreadsheet and get scored athlete report cards — strength, power, speed and COD scores, team ranking, trends and a speed–strength matrix. Nothing is saved.",
    icon: ClipboardList,
  },

];


const SOON = [
  "Jump Potential Report",
  "Relative Strength Report",
  "Reactive Strength Report",
  "Force Production Report",
  "Speed Reserve Report",
];

function ReportsIndex() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-10">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[color:oklch(0.72_0.18_255)]">Free reports</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Performance reports, free and open.
          </h1>
          <p className="mt-4 text-muted-foreground">
            No account. No athlete database. Built for athletes, parents, and coaches.
          </p>
          <div className="mt-5 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">These are data processors, not athlete management systems.</p>
            <p className="mt-1">
              They take a spreadsheet you already have and turn it into a clean, printable one-page report. Nothing
              is stored, no roster is created, and no ongoing athlete record is kept. Use them to give a parent or
              another coach a quick snapshot from a single practice or test day.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {LIVE.map((t) => (
            <Link key={t.to} to={t.to} className="group">
              <NeonCard className="h-full">
                <t.icon className="h-6 w-6 text-[color:oklch(0.72_0.18_255)]" />
                <div className="mt-4 font-display text-xl font-semibold">{t.name}</div>
                <p className="mt-2 text-sm text-muted-foreground">{t.body}</p>
                <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[color:oklch(0.78_0.16_255)]">
                  Open report <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </NeonCard>
            </Link>
          ))}
          {SOON.map((s) => (
            <NeonCard key={s} className="h-full opacity-60">
              <Lock className="h-6 w-6 text-muted-foreground" />
              <div className="mt-4 font-display text-xl font-semibold">{s}</div>
              <p className="mt-2 text-sm text-muted-foreground">Coming soon to Strength Lab Reports.</p>
            </NeonCard>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

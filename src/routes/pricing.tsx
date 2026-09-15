import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingShell, NeonCard } from "@/components/marketing-shell";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Pricing — Strength Lab Hub" },
      { name: "description", content: "Strength Lab Hub is currently in Beta Testing. Join the beta and shape the platform for your weight room." },
      { property: "og:title", content: "Pricing — Strength Lab Hub" },
      { property: "og:description", content: "Strength Lab Hub is currently in Beta Testing." },
      { property: "og:url", content: "https://teamstathub.lovable.app/pricing" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://teamstathub.lovable.app/pricing" }],
  }),
  component: PricingPage,
});

const TIERS = [
  {
    name: "Starter",
    priceHint: "1 coach · 1 team",
    body: "Everything a single coach needs to run the floor and log sessions.",
    cta: "Join beta",
    features: [
      "Training View with up to 4 racks",
      "Unlimited athletes on 1 team",
      "PR & testing logs",
      "Athlete PIN kiosk mode",
      "Basic reports (CSV)",
    ],
  },
  {
    name: "Team",
    priceHint: "Up to 6 coaches · unlimited teams",
    body: "For a full high-school or college strength staff running multiple sports.",
    cta: "Join beta",
    highlight: true,
    features: [
      "Everything in Starter",
      "Up to 8 rack tiles + coach TV display",
      "Programming workspace + templates",
      "PDF report cards",
      "Training analytics dashboard",
      "Priority email support",
    ],
  },
  {
    name: "District",
    priceHint: "Multi-org · SSO · onboarding",
    body: "For athletic departments, private clubs, and multi-school districts.",
    cta: "Contact sales",
    features: [
      "Everything in Team",
      "Multi-organization + super-admin",
      "Custom onboarding & migration",
      "Role-based access controls",
      "Dedicated Slack channel",
      "Annual contract & invoicing",
    ],
  },
];

function PricingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-[color:oklch(0.72_0.18_295)]" />
          Beta testing
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Strength Lab Hub is currently in Beta Testing.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground sm:text-lg">
          Join the beta and help shape the platform for your weight room. Pricing will be announced when we open to the public.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <NeonCard
              key={t.name}
              className={cn(
                "flex flex-col p-8",
                t.highlight && "border-[color:oklch(0.6_0.2_260/0.6)] bg-[color:oklch(0.28_0.08_260/0.35)]",
              )}
            >
              {t.highlight && (
                <div className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-[color:oklch(0.72_0.19_255/0.15)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:oklch(0.82_0.16_255)]">
                  Most popular
                </div>
              )}
              <div className="font-display text-lg font-semibold">{t.name}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold">—</span>
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{t.priceHint}</div>
              <p className="mt-4 text-sm text-muted-foreground">{t.body}</p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:oklch(0.72_0.18_255)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                className={cn(
                  "mt-8 inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold",
                  t.highlight
                    ? "bg-primary text-primary-foreground shadow-[0_0_30px_-6px_oklch(0.62_0.19_255/0.9)] hover:opacity-90"
                    : "border border-white/15 bg-white/5 hover:bg-white/10",
                )}
              >
                {t.cta}
              </Link>
            </NeonCard>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-2xl text-center text-xs text-muted-foreground">
          Beta access is free while we refine the platform. All plans include unlimited athletes, unlimited sessions, and free updates.
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 sm:p-10">
          <h3 className="font-display text-2xl font-semibold">Frequently asked</h3>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {[
              { q: "Do athletes need accounts?", a: "No — athletes sign in with a 6-digit PIN through a shared rack QR code. Only coaches and admins hold full accounts." },
              { q: "Can I import my roster?", a: "Yes. CSV import for athletes, teams, and rep-max history is built in from day one." },
              { q: "Does it work on iPad?", a: "Every screen is optimized for iPad and phone widths, with 44px touch targets and safe-area padding." },
              { q: "How is my data stored?", a: "Your program lives in a per-organization database with row-level security. Export any table any time." },
            ].map((f) => (
              <div key={f.q}>
                <div className="font-display text-sm font-semibold">{f.q}</div>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

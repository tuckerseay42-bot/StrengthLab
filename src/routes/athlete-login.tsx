import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyAthletePin } from "@/lib/athlete-pin.functions";
import { MarketingShell, NeonCard } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trophy, LineChart, ClipboardList, KeyRound, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/athlete-login")({
  head: () => ({
    meta: [
      { title: "Athlete Sign In — Strength Lab Hub" },
      { name: "description", content: "Athletes sign in with email + 6-digit PIN to view their report card, PRs, workouts, and tests." },
      { property: "og:title", content: "Athlete Sign In — Strength Lab Hub" },
      { property: "og:description", content: "See your report card, PRs, and next workout. Sign in with your athlete PIN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://teamstathub.lovable.app/athlete-login" }],
  }),
  component: AthleteLoginPage,
});

type Mode = "email" | "id";

function AthleteLoginPage() {
  const navigate = useNavigate();
  const verifyPin = useServerFn(verifyAthletePin);
  const [mode, setMode] = useState<Mode>("email");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  // Only bounce to /athlete if the signed-in session actually belongs to an athlete.
  // Coaches / super-admins previewing the marketing site must NOT be redirected away.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", userId);
      if ((roles ?? []).some((r) => r.role === "athlete")) {
        navigate({ to: "/athlete", replace: true });
      }
    })();
  }, [navigate]);



  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token_hash } = await verifyPin({ data: { identifier, pin } });
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) throw error;
      // NOT kiosk mode — this is the full athlete portal on the marketing site.
      if (typeof window !== "undefined") window.sessionStorage.removeItem("sl.kiosk");
      toast.success("Signed in");
      navigate({ to: "/athlete", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketingShell>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
        {/* LEFT — Value prop */}
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <KeyRound className="h-3.5 w-3.5 text-[color:oklch(0.72_0.18_255)]" />
            Athlete portal
          </div>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Your training,
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg, oklch(0.72 0.19 255), oklch(0.7 0.22 295))" }}
            >
              on the record.
            </span>
          </h1>
          <p className="mt-4 max-w-lg text-base text-muted-foreground">
            Sign in with your email and 6-digit PIN to open your personal report card — PRs,
            testing trends, spider graph, and today's assigned workout.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <NeonCard>
              <Trophy className="h-5 w-5 text-amber-400" />
              <div className="mt-3 font-display text-sm font-semibold">Report card</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Composite score, spider graph, and coach comparison group.
              </p>
            </NeonCard>
            <NeonCard>
              <LineChart className="h-5 w-5 text-[color:oklch(0.72_0.18_255)]" />
              <div className="mt-3 font-display text-sm font-semibold">PRs & trends</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Every rep max, sprint, and jump — charted over time.
              </p>
            </NeonCard>
            <NeonCard>
              <ClipboardList className="h-5 w-5 text-[color:oklch(0.7_0.22_295)]" />
              <div className="mt-3 font-display text-sm font-semibold">Today's workout</div>
              <p className="mt-1 text-xs text-muted-foreground">
                See exactly what your coach programmed for today.
              </p>
            </NeonCard>
            <NeonCard>
              <ShieldCheck className="h-5 w-5 text-[color:oklch(0.72_0.18_255)]" />
              <div className="mt-3 font-display text-sm font-semibold">Private to you</div>
              <p className="mt-1 text-xs text-muted-foreground">
                PIN-protected. Only you and your coaching staff see your data.
              </p>
            </NeonCard>
          </div>

          <div className="mt-8 text-xs text-muted-foreground">
            Coach?{" "}
            <Link to="/auth" className="text-[color:oklch(0.75_0.18_255)] hover:underline">
              Sign in to the coach dashboard
            </Link>
            .
          </div>
        </div>

        {/* RIGHT — Sign-in card */}
        <div className="lg:pl-6">
          <div
            className="relative overflow-hidden rounded-2xl border border-white/15 bg-[oklch(0.14_0.02_260)]/90 p-6 shadow-2xl backdrop-blur"
            style={{ boxShadow: "0 0 60px -10px oklch(0.55 0.22 260 / 0.45)" }}
          >
            <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <div className="font-display text-sm font-semibold">Athlete sign in</div>
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Email · 6-digit PIN
                </div>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-white/[0.04] p-1 text-sm">
              <button
                type="button"
                className={`h-10 rounded font-medium transition ${mode === "email" ? "bg-white/10 text-foreground shadow-sm" : "text-muted-foreground"}`}
                onClick={() => { setMode("email"); setIdentifier(""); }}
              >Email</button>
              <button
                type="button"
                className={`h-10 rounded font-medium transition ${mode === "id" ? "bg-white/10 text-foreground shadow-sm" : "text-muted-foreground"}`}
                onClick={() => { setMode("id"); setIdentifier(""); }}
              >Athlete ID</button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label htmlFor="al-id">{mode === "email" ? "Email" : "Athlete ID"}</Label>
                <Input
                  id="al-id"
                  type={mode === "email" ? "email" : "text"}
                  autoComplete={mode === "email" ? "email" : "off"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode={mode === "email" ? "email" : "text"}
                  required
                  className="h-11"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="al-pin">6-digit PIN</Label>
                <Input
                  id="al-pin"
                  type="password"
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  className="h-14 text-center tracking-[0.6em] text-xl"
                />
              </div>
              <Button
                type="submit"
                className="h-12 w-full text-base"
                disabled={busy || pin.length !== 6 || !identifier}
              >
                {busy ? "Signing in…" : "View my report card"}
              </Button>
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                Don't have a PIN yet? Your coach can send you a setup link from Strength Lab.
              </p>
            </form>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

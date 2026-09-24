import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { titleCaseName } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogOut, Dumbbell, ShieldCheck } from "lucide-react";
import { TodayView } from "./athlete.today";

export const Route = createFileRoute("/training-view/session")({
  head: () => ({
    meta: [
      { title: "Training View — Session" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: KioskSessionPage,
});

// Auto sign-out after this many ms of no user interaction.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

function KioskSessionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Kick unauthenticated visitors back to check-in.
  useEffect(() => {
    if (userId === null) navigate({ to: "/training-view/check-in", replace: true });
  }, [userId, navigate]);

  // Inactivity auto sign-out.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void handleSignOut(), IDLE_TIMEOUT_MS);
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const { data: athlete, isLoading: athleteLoading } = useQuery({
    queryKey: ["kiosk-athlete", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("athletes")
        .select("id, name, first_name, last_name, team_id, organization_id, program_id")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const handleSignOut = async () => {
    try {
      // Best-effort attendance record for today.
      if (athlete?.id) {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        try {
          const { data: existing } = await supabase.from("attendance")
            .select("id").eq("athlete_id", athlete.id).eq("session_date", iso).maybeSingle();
          if (!existing) {
            await supabase.from("attendance").insert({
              athlete_id: athlete.id, session_date: iso, present: true,
              organization_id: athlete.organization_id,
            });
          }
        } catch { /* ignore */ }
      }
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
    } finally {
      if (typeof window !== "undefined") window.sessionStorage.removeItem("sl.kiosk");
      navigate({ to: "/training-view/check-in", replace: true });
    }
  };


  if (userId === undefined || (userId && athleteLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your workout…
      </div>
    );
  }

  if (userId && !athlete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md">
          <CardContent className="space-y-3 p-6 text-center">
            <div className="text-sm text-muted-foreground">
              This account isn't linked to an athlete profile yet. Ask your coach for a join link.
            </div>
            <Button onClick={handleSignOut} variant="outline">Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!athlete) return null;

  const displayName = titleCaseName(athlete.first_name || athlete.name);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Dumbbell className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{displayName}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Training View — restricted session
          </div>
        </div>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSignOut}
            className="h-10 gap-1.5"
          >
            <LogOut className="h-4 w-4" /> Finish & sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-4 pb-24">
        <TodayView
          athleteId={athlete.id}
          athleteName={displayName}
          programId={athlete.program_id}
        />
      </div>
    </div>
  );
}

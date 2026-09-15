import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyAthletePin } from "@/lib/athlete-pin.functions";
import { athleteCheckIn } from "@/lib/athlete-checkin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ClipboardCheck, ShieldCheck, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/training-view/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Check-In" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AttendancePage,
});

type IdMode = "email" | "id";
type Stage = "signin" | "bodyweight" | "done";

function AttendancePage() {
  const navigate = useNavigate();
  const verifyPin = useServerFn(verifyAthletePin);
  const runCheckIn = useServerFn(athleteCheckIn);

  const [idMode, setIdMode] = useState<IdMode>("email");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [bodyweight, setBodyweight] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("signin");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void supabase.auth.signOut();
    });
  }, []);

  const reset = () => {
    setIdentifier("");
    setPin("");
    setBodyweight("");
    setStage("signin");
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token_hash } = await verifyPin({ data: { identifier, pin } });
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) throw error;
      setStage("bodyweight");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (withBw: boolean) => {
    setBusy(true);
    try {
      const bwNum = withBw && bodyweight.trim() ? Number(bodyweight) : null;
      await runCheckIn({ data: { bodyweight: bwNum } });
      setStage("done");
      toast.success("Checked in for attendance");
      setTimeout(async () => {
        await supabase.auth.signOut();
        reset();
      }, 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold">Attendance check-in</h1>
          <p className="text-xs text-muted-foreground">
            Logs today's attendance and bodyweight only — no workout view.
          </p>
        </div>

        {stage === "signin" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Athlete sign-in</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
                <button type="button" className={`h-11 rounded font-medium transition ${idMode === "email" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setIdMode("email"); setIdentifier(""); }}>Email</button>
                <button type="button" className={`h-11 rounded font-medium transition ${idMode === "id" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setIdMode("id"); setIdentifier(""); }}>Athlete ID</button>
              </div>
              <form onSubmit={submitPin} className="space-y-3">
                <div>
                  <Label htmlFor="att-id">{idMode === "email" ? "Email" : "Athlete ID"}</Label>
                  <Input id="att-id" type={idMode === "email" ? "email" : "text"} autoComplete={idMode === "email" ? "email" : "off"} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode={idMode === "email" ? "email" : "text"} required className="h-12" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="att-pin">6-digit PIN</Label>
                  <Input id="att-pin" type="password" required inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" className="h-14 text-center tracking-[0.6em] text-xl" />
                </div>
                <Button type="submit" className="h-12 w-full text-base" disabled={busy || pin.length !== 6 || !identifier}>
                  {busy ? "Signing in…" : "Continue"}
                </Button>
                <p className="flex items-center justify-center gap-1 pt-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" /> Attendance & bodyweight only. No workout access.
                </p>
                <div className="pt-1 text-center">
                  <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => navigate({ to: "/training-view/check-in" })}>
                    Lifting today? Use full training sign-in →
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {stage === "bodyweight" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Log today's bodyweight</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="att-bw">Bodyweight (lb)</Label>
                <Input id="att-bw" type="number" inputMode="decimal" step="0.1" min={40} max={700} autoFocus value={bodyweight} onChange={(e) => setBodyweight(e.target.value)} placeholder="e.g. 185" className="h-14 text-center text-xl" />
                <p className="mt-1 text-[11px] text-muted-foreground">Optional — attendance is logged either way.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12" disabled={busy} onClick={() => finish(false)}>Skip</Button>
                <Button className="h-12" disabled={busy || !bodyweight.trim()} onClick={() => finish(true)}>{busy ? "Saving…" : "Save & finish"}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {stage === "done" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <div className="text-lg font-semibold">You're checked in</div>
              <p className="text-sm text-muted-foreground">Attendance logged for today. Handing off to the next athlete…</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setAthletePinFromEmail } from "@/lib/athlete-pin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/athlete-pin-setup")({
  head: () => ({
    meta: [
      { title: "Set Athlete PIN — Strength Lab Hub" },
      { name: "description", content: "Athletes create or reset their private 6-digit Strength Lab Hub PIN from a coach email link." },
      { property: "og:title", content: "Set Athlete PIN — Strength Lab Hub" },
      { property: "og:description", content: "Create or reset your private 6-digit Strength Lab Hub athlete PIN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://www.strengthlabhub.com/athlete-pin-setup" }],
  }),
  component: AthletePinSetupPage,
});

function AthletePinSetupPage() {
  const savePin = useServerFn(setAthletePinFromEmail);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncSession = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const sessionEmail = data.session?.user?.email ?? "";
      setEmail((current) => current || sessionEmail);
      setReady(!!data.session);
      setChecking(false);
    };

    void syncSession();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const sessionEmail = session?.user?.email ?? "";
      setEmail((current) => current || sessionEmail);
      setReady(!!session);
      setChecking(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pin.length !== 6) return toast.error("PIN must be 6 digits");
    if (pin !== confirm) return toast.error("PINs don't match");
    setBusy(true);
    try {
      await savePin({ data: { email, pin } });
      await supabase.auth.signOut();
      setDone(true);
      toast.success("PIN saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save PIN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {done ? <CheckCircle2 className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
          </div>
          <CardTitle>{done ? "Your PIN is ready" : "Set your athlete PIN"}</CardTitle>
        </CardHeader>
        <CardContent>
          {checking && (
            <p className="py-6 text-center text-sm text-muted-foreground">Checking your setup link…</p>
          )}

          {!checking && !ready && !done && (
            <div className="space-y-4 text-center">
              <Mail className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Open this page from the PIN setup email your coach sent. That email link confirms who you are before a PIN can be created.
              </p>
              <Button asChild className="w-full">
                <Link to="/athlete-login">Go to athlete sign in</Link>
              </Button>
            </div>
          )}

          {!checking && ready && !done && (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin-setup-email">Email</Label>
                <Input
                  id="pin-setup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin-setup-pin">New 6-digit PIN</Label>
                <Input
                  id="pin-setup-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="new-password"
                  required
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  className="h-14 text-center text-xl tracking-[0.6em]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin-setup-confirm">Confirm PIN</Label>
                <Input
                  id="pin-setup-confirm"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  className="h-14 text-center text-xl tracking-[0.6em]"
                />
              </div>
              <Button type="submit" className="h-12 w-full" disabled={busy || pin.length !== 6 || confirm.length !== 6 || !email.trim()}>
                {busy ? "Saving…" : "Save PIN"}
              </Button>
            </form>
          )}

          {done && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                You can now sign in with your email and PIN from the athlete sign-in page or weight room QR code.
              </p>
              <Button asChild className="w-full">
                <Link to="/athlete-login">Go to athlete sign in</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { verifyAthletePin } from "@/lib/athlete-pin.functions";

const REMEMBER_KEY = "sl.rememberMe";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Strength Lab" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: (s.redirect as string | undefined) ?? undefined }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  const target = normalizeRedirect(redirect);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(REMEMBER_KEY);
    return v === null ? true : v === "1";
  });

  // PIN tab state
  const [pinEmail, setPinEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const verifyPin = useServerFn(verifyAthletePin);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.replace(target);
    });
  }, [target]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Persist the preference; a global pagehide handler in __root clears the
      // Supabase auth token from localStorage when "Remember me" is off, so the
      // session ends when the browser/tab closes.
      if (typeof window !== "undefined") {
        window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Signed in");
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) window.location.replace(target);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinBusy(true);
    try {
      const { token_hash, email: normalized } = await verifyPin({ data: { identifier: pinEmail, pin } });
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) throw error;
      toast.success(`Signed in as ${normalized}`);
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) window.location.replace(normalizeRedirect(redirect, "/athlete"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PIN sign-in failed");
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="password">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="password">Email + password</TabsTrigger>
              <TabsTrigger value="pin">Athlete PIN</TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-4">
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required autoComplete="email"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required minLength={6}
                    autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {(
                  <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(v) => setRemember(v === true)}
                      id="remember-me"
                    />
                    <span>Remember me on this device</span>
                  </label>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Please wait…" : "Sign in"}
                </Button>
              </form>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Access is invite-only. Ask your coach or org admin for an invite.
              </p>

            </TabsContent>

            <TabsContent value="pin" className="mt-4">
              <form onSubmit={submitPin} className="space-y-3">
                <div>
                  <Label htmlFor="pin-email">Email</Label>
                  <Input id="pin-email" type="email" required autoComplete="email"
                    inputMode="email"
                    value={pinEmail} onChange={(e) => setPinEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="pin">6-digit PIN</Label>
                  <Input
                    id="pin"
                    type="text"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    className="text-center tracking-[0.6em] text-lg"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={pinBusy || pin.length !== 6}>
                  {pinBusy ? "Signing in…" : "Sign in with PIN"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  First time? Sign in with email + password once, then set a PIN in your athlete dashboard.
                </p>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-6 text-center">
            <Link to="/" className="text-xs text-muted-foreground hover:underline">Back to home</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function normalizeRedirect(value: string | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

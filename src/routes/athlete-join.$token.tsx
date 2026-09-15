import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { CheckCircle2, Mail } from "lucide-react";
import { CenteredSpinner } from "@/components/loading";
import { athleteDisplayName } from "@/lib/queries";
import { useServerFn } from "@tanstack/react-start";
import { requestAthleteAccessLink } from "@/lib/athlete-access.functions";

export const Route = createFileRoute("/athlete-join/$token")({
  head: () => ({ meta: [{ title: "Athlete Sign-In — Strength Lab" }, { name: "robots", content: "noindex" }] }),
  component: AthleteJoin,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Invalid link</h1>
      <p className="mt-2 text-sm text-muted-foreground">Ask your coach for a new QR code.</p>
    </div>
  ),
});

function AthleteJoin() {
  const { token } = Route.useParams();
  const { data: athlete, isLoading } = useQuery({
    queryKey: ["athlete-by-token", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_athlete_by_join_token", { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw notFound();
      return row as { id: string; name: string; first_name: string | null; last_name: string | null; preferred_name: string | null; athlete_email: string | null };
    },
  });

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestLink = useServerFn(requestAthleteAccessLink);

  if (isLoading) return <CenteredSpinner label="Loading invite…" />;
  if (!athlete) return null;

  const name = athleteDisplayName(athlete as never);
  const suggested = (athlete as { athlete_email: string | null }).athlete_email;

  const send = async () => {
    const to = (email || suggested || "").trim();
    if (!to) return toast.error("Enter your email");
    setBusy(true);
    try {
      await requestLink({
        data: {
          email: to,
          joinToken: token,
          redirectTo: `${window.location.origin}/athlete?claim=${token}&setupPin=1`,
        },
      });
      setSent(true);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">We sent a sign-in link to {email || suggested}. Tap it on this device to open your dashboard.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Enter your email to get a one-tap sign-in link. You'll use the same email every time.</p>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              autoFocus
              inputMode="email"
              placeholder={suggested ?? "you@school.edu"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={send} disabled={busy}>
            <Mail className="mr-2 h-4 w-4" /> {busy ? "Sending…" : "Send my link"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

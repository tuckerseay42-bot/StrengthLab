import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SPORTS, GRADES, GENDERS, GENDER_LABELS, gradeToGradYear, gradYearToGrade } from "@/lib/domain";
import { titleCaseName } from "@/lib/queries";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { CheckCircle2 } from "lucide-react";
import { CenteredSpinner } from "@/components/loading";

export const Route = createFileRoute("/join/$token")({
  head: ({ params }) => ({ meta: [{ title: "Join Team — Strength Lab" }, { name: "robots", content: "noindex" }, { property: "og:title", content: "Join your team" }] }),
  component: JoinPage,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">Invalid invite link</h1>
      <p className="mt-2 text-sm text-muted-foreground">Ask your coach for a new QR code.</p>
    </div>
  ),
});

function JoinPage() {
  const { token } = Route.useParams();
  const { data: team, isLoading } = useQuery({
    queryKey: ["team-by-token", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_team_by_qr_token", { _token: token });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw notFound();
      return row as { id: string; name: string; sport: string | null; color: string | null; season: string | null };
    },
  });

  const [form, setForm] = useState({
    first_name: "", last_name: "", student_id: "",
    grade: "", sport: "", position: "", graduation_year: "",
    height_in: "", weight_lb: "", parent_email: "", athlete_email: "",
    date_of_birth: "", gender: "", sport_fall: "", sport_winter: "", sport_spring: "",
  });
  const [done, setDone] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      if (!team) return;
      if (!form.first_name.trim() || !form.last_name.trim()) throw new Error("First and last name are required");
      const primarySport = form.sport || form.sport_fall || form.sport_winter || form.sport_spring || team.sport || "";
      const { error } = await supabase.rpc("submit_registration", {
        _token: token,
        _payload: {
          first_name: titleCaseName(form.first_name.trim()),
          last_name: titleCaseName(form.last_name.trim()),
          student_id: form.student_id,
          grade: form.grade,
          sport: primarySport,
          sport_fall: form.sport_fall,
          sport_winter: form.sport_winter,
          sport_spring: form.sport_spring,
          date_of_birth: form.date_of_birth,
          position: form.position,
          graduation_year: form.graduation_year,
          height_in: form.height_in,
          weight_lb: form.weight_lb,
          parent_email: form.parent_email,
          athlete_email: form.athlete_email,
          gender: form.gender,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => setDone(true),
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  if (isLoading) return <CenteredSpinner label="Loading team…" />;
  if (!team) return null;

  if (done) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-primary" />
        <h1 className="mt-4 text-2xl font-semibold">You're on the list!</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your coach will approve your registration shortly. Welcome to <span className="font-medium text-foreground">{team.name}</span>.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: team.color ?? "#F97316" }} />
            <CardTitle>Join {team.name}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">{team.sport ? `${team.sport} · ` : ""}Fill this out to register with your coach.</p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name *</Label>
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                onBlur={(e) => setForm((f) => ({ ...f, first_name: titleCaseName(e.target.value.trim()) }))}
              />
            </div>
            <div>
              <Label>Last name *</Label>
              <Input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                onBlur={(e) => setForm((f) => ({ ...f, last_name: titleCaseName(e.target.value.trim()) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Grade</Label>
              <Select
                value={form.grade}
                onValueChange={(v) => {
                  const gy = gradeToGradYear(Number(v));
                  setForm({ ...form, grade: v, graduation_year: gy ? String(gy) : form.graduation_year });
                }}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Graduation year</Label>
              <Input
                inputMode="numeric"
                value={form.graduation_year}
                onChange={(e) => {
                  const yr = e.target.value;
                  const g = gradYearToGrade(Number(yr));
                  setForm({ ...form, graduation_year: yr, grade: g ? String(g) : form.grade });
                }}
                placeholder={`e.g. ${gradeToGradYear(9) ?? 2030}`}
              />
            </div>
            <div />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date of birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></div>
            <div>
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Sports by season (up to 3)</Label>
            {(["fall", "winter", "spring"] as const).map((season) => {
              const key = `sport_${season}` as const;
              return (
                <div key={season} className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <span className="text-sm capitalize">{season}</span>
                  <Select value={form[key]} onValueChange={(v) => setForm({ ...form, [key]: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          <div><Label>Position</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="e.g. QB, Guard" /></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Height (in)</Label><Input inputMode="decimal" value={form.height_in} onChange={(e) => setForm({ ...form, height_in: e.target.value })} placeholder="70" /></div>
            <div><Label>Weight (lb)</Label><Input inputMode="decimal" value={form.weight_lb} onChange={(e) => setForm({ ...form, weight_lb: e.target.value })} placeholder="185" /></div>
          </div>
          <div><Label>Athlete email</Label><Input type="email" value={form.athlete_email} onChange={(e) => setForm({ ...form, athlete_email: e.target.value })} /></div>
          <div><Label>Parent email</Label><Input type="email" value={form.parent_email} onChange={(e) => setForm({ ...form, parent_email: e.target.value })} /></div>
          <Button className="mt-2" onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit registration"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

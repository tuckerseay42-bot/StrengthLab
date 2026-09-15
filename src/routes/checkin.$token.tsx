import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ClipboardCheck, CheckCircle2, Search } from "lucide-react";

export const Route = createFileRoute("/checkin/$token")({
  head: () => ({
    meta: [
      { title: "Team Check-In — Strength Lab" },
      { name: "description", content: "Mark yourself present and log today's bodyweight." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RosterCheckInPage,
});

type RosterRow = {
  athlete_id: string;
  display_name: string;
  grade: number | null;
  class_period: string | null;
};

function RosterCheckInPage() {
  const { token } = Route.useParams();
  const [selected, setSelected] = useState<RosterRow | null>(null);
  const [search, setSearch] = useState("");
  const [bodyweight, setBodyweight] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const teamQ = useQuery({
    queryKey: ["checkin-team", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_team_by_qr_token", { _token: token });
      if (error) throw error;
      return (data as { name: string; sport: string | null }[] | null)?.[0] ?? null;
    },
  });

  const rosterQ = useQuery({
    queryKey: ["checkin-roster", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_roster_by_qr_token", { _token: token });
      if (error) throw error;
      return (data ?? []) as RosterRow[];
    },
  });

  const roster = useMemo(() => rosterQ.data ?? [], [rosterQ.data]);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const bw = bodyweight.trim() ? Number(bodyweight) : null;
      if (bw != null && (!Number.isFinite(bw) || bw < 40 || bw > 700)) {
        throw new Error("Enter a bodyweight between 40 and 700 lb");
      }
      const { data, error } = await supabase.rpc("roster_check_in", {
        _token: token,
        _athlete_id: selected.athlete_id,
        _bodyweight: bw ?? undefined,
      });
      if (error) throw error;
      setDone((data as string | null) ?? selected.display_name);
      setTimeout(() => {
        setDone(null);
        setSelected(null);
        setBodyweight("");
        setSearch("");
      }, 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-start justify-center bg-background p-4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold">
            {teamQ.data?.name ? `${teamQ.data.name} check-in` : "Team check-in"}
          </h1>
          <p className="text-xs text-muted-foreground">
            Find your name, mark present, and log today's bodyweight. No login needed.
          </p>
        </div>

        {done ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-primary" />
              <div className="text-lg font-semibold">{done} is checked in</div>
              <p className="text-sm text-muted-foreground">Attendance logged for today. Pass the phone along…</p>
            </CardContent>
          </Card>
        ) : rosterQ.isError ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This check-in code isn't valid. Ask your coach for the current QR code.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">1. Find your name</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {rosterQ.isLoading ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">Loading roster…</div>
                ) : (
                  <Command shouldFilter className="rounded-none border-t">
                    <div className="flex items-center gap-2 px-3">
                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CommandInput
                        placeholder="Type your last name…"
                        value={search}
                        onValueChange={setSearch}
                        className="h-12 border-0"
                      />
                    </div>
                    <CommandList className="max-h-[45vh]">
                      <CommandEmpty>No athlete found — check with your coach.</CommandEmpty>
                      <CommandGroup>
                        {roster.map((r) => (
                          <CommandItem
                            key={r.athlete_id}
                            value={r.display_name}
                            onSelect={() => setSelected(r)}
                            className={`h-12 text-base ${selected?.athlete_id === r.athlete_id ? "bg-primary/10 text-primary" : ""}`}
                          >
                            <span className="truncate">{r.display_name}</span>
                            {r.grade ? (
                              <span className="ml-auto text-xs text-muted-foreground">Gr {r.grade}</span>
                            ) : null}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">2. Bodyweight (optional)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="rc-bw">Bodyweight (lb)</Label>
                  <Input
                    id="rc-bw"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={40}
                    max={700}
                    value={bodyweight}
                    onChange={(e) => setBodyweight(e.target.value)}
                    placeholder="e.g. 185"
                    className="h-14 text-center text-xl"
                  />
                </div>
                <Button className="h-14 w-full text-base" disabled={!selected || busy} onClick={submit}>
                  {busy
                    ? "Saving…"
                    : selected
                      ? `Mark ${selected.display_name} present`
                      : "Select your name first"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

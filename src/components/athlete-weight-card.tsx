// An athlete's weight on their profile: this week and the last counted week at a
// glance, a weekly trend chart, the week-by-week table, a two-date comparison,
// and the individual weigh-ins (coaches can add, correct or delete them). All
// the weekly rules come from @/lib/weigh-ins so this can't disagree with the
// Team Grid.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { athleteWeighInsQO, type Athlete, type WeighInRow } from "@/lib/queries";
import {
  changeBetweenDates,
  easternToday,
  formatChange,
  formatWeight,
  MIN_DAYS_FOR_WEEK,
  summarizeAthlete,
  trendOf,
  weekStartOf,
  type Trend,
} from "@/lib/weigh-ins";
import { toUserMessage } from "@/lib/db-errors";
import { usePermission } from "@/hooks/use-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TREND_CLASS: Record<Trend, string> = {
  up: "text-emerald-500",
  down: "text-red-500",
  flat: "text-muted-foreground",
};

function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function whenLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "YYYY-MM-DDTHH:mm" in the viewer's local time, for a datetime-local input. */
function localInputValue(d: Date = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type LogResult = { status: "ok" | "confirm"; recent_avg?: number };

function Change({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  const trend = trendOf(value);
  return (
    <span className={cn("font-semibold tabular-nums", trend && TREND_CLASS[trend])}>
      {formatChange(value)}
      {value != null && suffix}
    </span>
  );
}

export function AthleteWeightCard({ athlete }: { athlete: Athlete }) {
  const qc = useQueryClient();
  const { allowed: canEdit } = usePermission("athletes.edit");
  const q = useQuery(athleteWeighInsQO(athlete.id));
  const list = useMemo(() => q.data ?? [], [q.data]);

  const today = easternToday();
  const thisWeek = weekStartOf(today);
  const summary = useMemo(() => summarizeAthlete(list, thisWeek), [list, thisWeek]);
  const current = summary.weeks.find((w) => w.weekStart === thisWeek) ?? null;
  const lastCounted = summary.latestCounted;
  const latest = list[0] ?? null; // newest first

  // Realtime: a kiosk or another coach adds one, this updates without a refresh.
  useEffect(() => {
    const ch = supabase
      .channel(`weight-card-${athlete.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "weigh_ins",
          filter: `athlete_id=eq.${athlete.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["weigh_ins"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [athlete.id, qc]);

  const chartData = useMemo(
    () =>
      summary.weeks
        .filter((w) => w.avg != null)
        .slice(-16)
        .map((w) => ({
          label: shortDate(w.weekStart),
          avg: Number((w.avg as number).toFixed(1)),
          counted: w.counted,
          days: w.days,
        })),
    [summary],
  );

  // ---- two-date comparison ----
  const days = useMemo(() => [...new Set(list.map((w) => w.log_date))].sort(), [list]);
  const [cmpFrom, setCmpFrom] = useState("");
  const [cmpTo, setCmpTo] = useState("");
  const from = cmpFrom || days[0] || "";
  const to = cmpTo || days[days.length - 1] || "";
  const comparison = useMemo(
    () => (from && to ? changeBetweenDates(list, from, to) : null),
    [list, from, to],
  );

  // ---- add / edit / delete ----
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["weigh_ins"] });
    void qc.invalidateQueries({ queryKey: ["athletes"] });
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addWhen, setAddWhen] = useState(localInputValue());
  const [confirmJump, setConfirmJump] = useState<{ value: number; recentAvg: number } | null>(null);

  const save = useMutation({
    mutationFn: async (input: { value: number; confirmed: boolean }): Promise<LogResult> => {
      const { data, error } = await supabase.rpc(
        "log_weigh_in" as never,
        {
          _athlete_id: athlete.id,
          _value: input.value,
          _logged_at: new Date(addWhen).toISOString(),
          _source: "manual",
          _confirmed: input.confirmed,
        } as never,
      );
      if (error) throw error;
      return data as unknown as LogResult;
    },
    onSuccess: (res, input) => {
      if (res.status === "confirm") {
        // Close the Add dialog while the question is up so the two never overlap.
        setAddOpen(false);
        setConfirmJump({ value: input.value, recentAvg: res.recent_avg ?? 0 });
        return;
      }
      setConfirmJump(null);
      setAddOpen(false);
      setAddValue("");
      toast.success("Weigh-in saved");
      refresh();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const submitAdd = () => {
    const v = Number(addValue);
    if (!Number.isFinite(v) || v < 40 || v > 700) {
      toast.error("Enter a weight between 40 and 700 lb");
      return;
    }
    if (!addWhen || Number.isNaN(new Date(addWhen).getTime())) {
      toast.error("Pick a date and time");
      return;
    }
    save.mutate({ value: v, confirmed: false });
  };

  const [editing, setEditing] = useState<WeighInRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const update = useMutation({
    mutationFn: async (input: { id: string; value: number }) => {
      const { error } = await supabase
        .from("weigh_ins" as never)
        .update({ value: input.value } as never)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(null);
      toast.success("Weigh-in corrected");
      refresh();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const [deleting, setDeleting] = useState<WeighInRow | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("weigh_ins" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDeleting(null);
      toast.success("Weigh-in deleted");
      refresh();
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">Weight</CardTitle>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAddWhen(localInputValue());
              setAddOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add weigh-in
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {q.isError ? (
          <p className="text-sm text-muted-foreground">
            Weight history isn't available yet. It arrives with the latest database update, so check
            back after the sync finishes.
          </p>
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No weigh-ins yet. They show up here when {athlete.first_name || "the athlete"} logs
            their weight at check-in{canEdit ? ", or you can add one." : "."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Latest weigh-in">
                <div className="stat-number text-2xl tabular-nums">
                  {formatWeight(latest ? Number(latest.value) : null)}
                  <span className="ml-1 text-xs text-muted-foreground">lb</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {latest ? whenLabel(latest.logged_at) : ""}
                </div>
              </Stat>
              <Stat label="This week">
                {current && current.avg != null ? (
                  <>
                    <div
                      className={cn(
                        "stat-number text-2xl tabular-nums",
                        !current.counted && "opacity-45",
                      )}
                    >
                      {formatWeight(current.avg)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {current.counted
                        ? `${current.days} days`
                        : `${current.days} of ${MIN_DAYS_FOR_WEEK} days, not counted yet`}
                    </div>
                  </>
                ) : (
                  <div className="text-2xl text-muted-foreground/50">—</div>
                )}
              </Stat>
              <Stat label="Last counted week">
                {lastCounted ? (
                  <>
                    <div className="stat-number text-2xl tabular-nums">
                      {formatWeight(lastCounted.avg)}
                    </div>
                    <div className="text-[11px]">
                      <Change value={lastCounted.change} suffix=" lb" />
                      <span className="text-muted-foreground">
                        {" "}
                        week of {shortDate(lastCounted.weekStart)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Needs weigh-ins on {MIN_DAYS_FOR_WEEK} different days in a week
                  </div>
                )}
              </Stat>
              <Stat label="Net change">
                {summary.netChange == null ? (
                  <div className="text-sm text-muted-foreground">Needs two counted weeks</div>
                ) : (
                  <>
                    <div className="stat-number text-2xl tabular-nums">
                      <Change value={summary.netChange} />
                      <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      since week of {shortDate(summary.firstCounted!.weekStart)}
                    </div>
                  </>
                )}
              </Stat>
            </div>

            {chartData.length > 1 && (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      domain={["dataMin - 2", "dataMax + 2"]}
                      tick={{ fontSize: 11 }}
                      width={44}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v} lb`, "Weekly average"]}
                      labelFormatter={(l) => `Week of ${l}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={(p: {
                        cx?: number;
                        cy?: number;
                        index?: number;
                        payload?: { counted: boolean };
                      }) => (
                        <circle
                          key={p.index}
                          cx={p.cx}
                          cy={p.cy}
                          r={4}
                          stroke="var(--primary)"
                          strokeWidth={2}
                          fill={p.payload?.counted ? "var(--primary)" : "var(--background)"}
                        />
                      )}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <p className="-mt-1 text-center text-[11px] text-muted-foreground">
                  Filled dot = counted week (3+ days). Hollow = not enough days yet.
                </p>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Week by week
                </div>
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-semibold">Week of</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Days</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Average</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.weeks
                        .slice(-12)
                        .reverse()
                        .map((w) => (
                          <tr key={w.weekStart} className="border-t border-border/50">
                            <td className="px-3 py-1.5">{shortDate(w.weekStart)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                              {w.days === 0
                                ? "—"
                                : w.counted
                                  ? w.days
                                  : `${w.days} of ${MIN_DAYS_FOR_WEEK}`}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums",
                                w.counted ? "font-bold" : "opacity-45",
                              )}
                            >
                              {formatWeight(w.avg)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {w.counted ? <Change value={w.change} /> : <span>—</span>}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Compare two dates
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={from}
                      onChange={(e) => setCmpFrom(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={to}
                      onChange={(e) => setCmpTo(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-border/60 p-3 text-sm">
                  {!comparison ? (
                    <span className="text-muted-foreground">Pick two dates.</span>
                  ) : comparison.change != null ? (
                    <div>
                      <div className="text-2xl">
                        <Change value={comparison.change} />
                        <span className="ml-1 text-xs text-muted-foreground">lb</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatWeight(comparison.from)} on {shortDate(from)} →{" "}
                        {formatWeight(comparison.to)} on {shortDate(to)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      No weigh-in on{" "}
                      {[
                        comparison.from == null ? shortDate(from) : null,
                        comparison.to == null ? shortDate(to) : null,
                      ]
                        .filter(Boolean)
                        .join(" or ")}
                      . Each date uses that day's weigh-ins, so pick days with one.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent weigh-ins
              </div>
              <div className="divide-y divide-border/50 rounded-md border border-border/60">
                {list.slice(0, 15).map((w) => (
                  <div key={w.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="w-36 text-muted-foreground">{whenLabel(w.logged_at)}</span>
                    <span className="font-bold tabular-nums">
                      {formatWeight(Number(w.value))} lb
                    </span>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {w.source === "checkin" ? "Check-in" : w.source}
                    </Badge>
                    {canEdit && (
                      <span className="ml-auto flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          title="Correct this weigh-in"
                          onClick={() => {
                            setEditing(w);
                            setEditValue(String(Number(w.value)));
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete this weigh-in"
                          onClick={() => setDeleting(w)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a weigh-in</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Weight (lb)</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={40}
                max={700}
                autoFocus
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder="e.g. 185.4"
              />
            </div>
            <div>
              <Label>When</Label>
              <Input
                type="datetime-local"
                value={addWhen}
                max={localInputValue()}
                onChange={(e) => setAddWhen(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={save.isPending || !addValue.trim()}>
              {save.isPending ? "Saving…" : "Save weigh-in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmJump} onOpenChange={(v) => !v && setConfirmJump(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Double-check this weight</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmJump && (
                <>
                  {confirmJump.value} lb is 30% or more away from this athlete's last two weeks
                  (about {confirmJump.recentAvg} lb). That's usually a typo. Save it anyway?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAddOpen(true)}>Re-check</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmJump && save.mutate({ value: confirmJump.value, confirmed: true })
              }
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct this weigh-in</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Weight (lb)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={40}
              max={700}
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
            />
            {editing && (
              <p className="mt-1 text-xs text-muted-foreground">
                Logged {whenLabel(editing.logged_at)}.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={update.isPending}
              onClick={() => {
                const v = Number(editValue);
                if (!editing || !Number.isFinite(v) || v < 40 || v > 700) {
                  toast.error("Enter a weight between 40 and 700 lb");
                  return;
                }
                update.mutate({ id: editing.id, value: v });
              }}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this weigh-in?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting &&
                `${formatWeight(Number(deleting.value))} lb from ${whenLabel(deleting.logged_at)} will be removed. The weekly averages update right away.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

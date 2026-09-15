import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Icons from "lucide-react";
import { Award, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { badgesQO, athleteBadgesQO, evaluateBadges, syncAthleteBadgeAwards, type BadgeProgress, type Badge as BadgeType } from "@/lib/badges";
import type { Athlete, TestRow, LiftRow, AttendanceRow, RepMax } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";
import { cn } from "@/lib/utils";

type Props = {
  athlete: Athlete;
  tests: TestRow[];
  lifts: LiftRow[];
  attendance: AttendanceRow[];
  repMaxes: RepMax[];
  canAward?: boolean;
};

// Single restrained accent tone for all earned badges. Coach-defined color
// values are ignored on the shelf to keep the visual palette limited; the
// color still lives on the badge record for other surfaces.
const EARNED_CLS = "bg-primary/10 text-primary ring-primary/30";
const LOCKED_CLS = "bg-muted text-muted-foreground ring-border";
const colorMap: Record<string, string> = {
  primary: EARNED_CLS,
  accent: EARNED_CLS,
  success: EARNED_CLS,
  destructive: EARNED_CLS,
  muted: LOCKED_CLS,
};

function iconFor(name: string) {
  const I = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return I ?? Award;
}

export function BadgeShelf({ athlete, tests, lifts, attendance, repMaxes, canAward = false }: Props) {
  const qc = useQueryClient();
  const { data: badges = [] } = useQuery(badgesQO);
  const { data: allEarned = [] } = useQuery(athleteBadgesQO);
  const [selected, setSelected] = useState<BadgeProgress | null>(null);
  const [manualPickerOpen, setManualPickerOpen] = useState(false);

  const myEarned = useMemo(() => allEarned.filter((e) => e.athlete_id === athlete.id), [allEarned, athlete.id]);
  // RLS already scopes badges to global + this org
  const relevantBadges = badges;

  const progress = useMemo(
    () => evaluateBadges(athlete, tests, lifts, attendance, repMaxes, relevantBadges, myEarned),
    [athlete, tests, lifts, attendance, repMaxes, relevantBadges, myEarned],
  );

  // Auto-award badges whose criteria are met.
  useEffect(() => {
    if (!canAward || !progress.length) return;
    syncAthleteBadgeAwards(athlete.id, progress)
      .then((n) => {
        if (n > 0) {
          qc.invalidateQueries({ queryKey: ["athlete_badges"] });
          toast.success(`${n} new badge${n === 1 ? "" : "s"} unlocked`);
        }
      })
      .catch(() => { /* swallow — non-blocking */ });
    // Intentionally depend only on serialized state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAward, athlete.id, myEarned.length, tests.length, lifts.length, attendance.length, repMaxes.length]);

  const earned = progress.filter((p) => p.earned);
  const locked = progress.filter((p) => !p.earned).sort((a, b) => b.progress - a.progress);
  const manualBadges = relevantBadges.filter((b) => b.criteria.type === "manual" && !myEarned.some((e) => e.badge_id === b.id));

  const awardManual = async (badge: BadgeType) => {
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("athlete_badges").insert({
      athlete_id: athlete.id,
      badge_id: badge.id,
      awarded_by: user.user?.id ?? null,
      evidence: { manual: true },
    });
    if (error) return toast.error(toUserMessage(error));
    toast.success(`Awarded ${badge.name}`);
    qc.invalidateQueries({ queryKey: ["athlete_badges"] });
    setManualPickerOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><Award className="h-4 w-4" /> Badges</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{earned.length} earned · {locked.length} in progress</p>
        </div>
        {canAward && manualBadges.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setManualPickerOpen(true)}>Award badge</Button>
        )}
      </CardHeader>
      <CardContent>
        {progress.length === 0 ? (
          <p className="text-sm text-muted-foreground">No badges configured yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {earned.map((p) => <BadgeChip key={p.badge.id} p={p} onClick={() => setSelected(p)} />)}
            {locked.map((p) => <BadgeChip key={p.badge.id} p={p} onClick={() => setSelected(p)} />)}
          </div>
        )}
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && (() => {
            const Icon = iconFor(selected.badge.icon);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <span className={cn("grid h-10 w-10 place-items-center rounded-full ring-2", colorMap[selected.badge.color] ?? colorMap.primary)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    {selected.badge.name}
                  </DialogTitle>
                  {selected.badge.description && <DialogDescription>{selected.badge.description}</DialogDescription>}
                </DialogHeader>
                <div className="space-y-2 text-sm">
                  {selected.earned ? (
                    <>
                      <div className="font-medium" style={{ color: "var(--status-pr)" }}>Earned</div>
                      {selected.awardedAt && <div className="text-muted-foreground">Awarded {new Date(selected.awardedAt).toLocaleDateString()}</div>}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-mono">{Math.round(selected.progress * 100)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${selected.progress * 100}%` }} />
                      </div>
                      {(selected.currentLabel || selected.targetLabel) && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                          <span>Current: {selected.currentLabel ?? "—"}</span>
                          <span>Target: {selected.targetLabel ?? "—"}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={manualPickerOpen} onOpenChange={setManualPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Award a badge</DialogTitle>
            <DialogDescription>Manual badges are given at the coach's discretion.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {manualBadges.length === 0 && <p className="text-sm text-muted-foreground">All manual badges already awarded.</p>}
            {manualBadges.map((b) => {
              const Icon = iconFor(b.icon);
              return (
                <button
                  key={b.id}
                  onClick={() => awardManual(b)}
                  className="flex items-center gap-3 rounded-md border p-3 text-left hover:bg-muted transition-colors"
                >
                  <span className={cn("grid h-9 w-9 place-items-center rounded-full ring-2", colorMap[b.color] ?? colorMap.primary)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{b.name}</div>
                    {b.description && <div className="text-xs text-muted-foreground">{b.description}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BadgeChip({ p, onClick }: { p: BadgeProgress; onClick: () => void }) {
  const Icon = iconFor(p.badge.icon);
  const cls = colorMap[p.badge.color] ?? colorMap.primary;
  return (
    <button
      onClick={onClick}
      title={p.badge.name}
      className={cn(
        "group relative flex flex-col items-center gap-1 w-20 focus:outline-none",
        !p.earned && "opacity-60 hover:opacity-100",
      )}
    >
      <span className={cn(
        "grid h-14 w-14 place-items-center rounded-full ring-2 transition-transform group-hover:scale-105",
        p.earned ? cls : "bg-muted text-muted-foreground ring-border",
      )}>
        {p.earned ? <Icon className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
      </span>
      <span className="text-[10px] leading-tight text-center line-clamp-2 text-muted-foreground group-hover:text-foreground">
        {p.badge.name}
      </span>
      {!p.earned && p.progress > 0 && (
        <span className="text-[10px] font-mono text-muted-foreground">{Math.round(p.progress * 100)}%</span>
      )}
    </button>
  );
}

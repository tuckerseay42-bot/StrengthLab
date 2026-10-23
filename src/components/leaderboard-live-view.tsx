// Fullscreen, wall-mountable display of one leaderboard — big enough to
// read from across a weight room, auto-updating as the Leaderboards page's
// realtime subscription invalidates tests/lifts/attendance. A row briefly
// glows when that athlete just logged something, so a coach glancing at the
// screen can see movement happen live during a team test.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Leaderboard, CustomMetric } from "@/lib/queries";
import { athleteDisplayName } from "@/lib/queries";
import type { MetricRow } from "@/lib/metrics";
import { formatLeaderValue, boardRangeLabel } from "@/lib/leaderboard-utils";
import { fullscreenApiSupported } from "@/lib/fullscreen";
import { Button } from "@/components/ui/button";
import { Crown, Maximize2, Minimize2, Radio, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeaderboardLiveView({
  board,
  metric,
  teamName,
  rows,
  teamAverage,
  recentIds,
  onClose,
}: {
  board: Leaderboard;
  metric: CustomMetric | undefined;
  teamName: string | undefined;
  rows: MetricRow[];
  teamAverage: number | null;
  recentIds: Set<string>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreenApiSupported()) return;
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!fullscreenApiSupported()) {
      setIsFullscreen((v) => !v);
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filterLine = [
    teamName && `Team: ${teamName}`,
    board.sport && `Sport: ${board.sport}`,
    board.grade != null && `Grade ${board.grade}`,
    board.position && `Pos: ${board.position}`,
    board.gender && `Gender: ${board.gender}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return createPortal(
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-[200] flex flex-col bg-[#0b0e14] text-white",
        isFullscreen && "fixed inset-0 z-[200]",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-6 py-4 sm:px-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--color-success)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--color-success)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--color-success)]" />
            </span>
            Live
            <Radio className="h-3 w-3" />
          </div>
          <h1 className="font-display truncate text-2xl font-bold sm:text-4xl">{board.name}</h1>
          <p className="truncate text-sm text-white/50 sm:text-base">
            {metric?.name ?? "Metric deleted"}
            {metric?.unit ? ` (${metric.unit})` : ""} · {boardRangeLabel(board)}
            {filterLine ? ` · ${filterLine}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10">
        {rows.length === 0 ? (
          <p className="py-20 text-center text-xl text-white/50">No qualifying athletes yet.</p>
        ) : (
          <ol className="mx-auto flex max-w-4xl flex-col gap-2.5">
            {rows.map((r, i) => {
              const justMoved = recentIds.has(r.athlete.id);
              return (
                <li
                  key={r.athlete.id}
                  className={cn(
                    "flex items-center gap-4 rounded-2xl border px-5 py-3.5 transition-all duration-500 sm:px-6 sm:py-4",
                    i === 0
                      ? "border-[oklch(0.82_0.17_85)]/50 bg-[oklch(0.82_0.17_85)]/10"
                      : "border-white/10 bg-white/[0.03]",
                    justMoved && "ring-2 ring-[color:var(--color-success)]",
                  )}
                >
                  <span
                    className={cn(
                      "w-10 shrink-0 text-center font-mono text-xl font-bold sm:text-2xl",
                      i === 0 ? "text-[oklch(0.82_0.17_85)]" : "text-white/40",
                    )}
                  >
                    {i === 0 ? <Crown className="mx-auto h-7 w-7" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-semibold sm:text-2xl">
                    {athleteDisplayName(r.athlete)}
                  </span>
                  {r.athlete.grade != null && (
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50 sm:text-sm">
                      G{r.athlete.grade}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-2xl font-bold tabular-nums sm:text-3xl">
                    {formatLeaderValue(r.value, metric?.unit)}
                    {metric?.unit && (
                      <span className="ml-1 text-sm font-normal text-white/40 sm:text-base">
                        {metric.unit}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {teamAverage != null && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 px-6 py-3 text-sm text-white/50 sm:text-base">
          <span>Team average</span>
          <span className="font-mono font-semibold text-white">
            {formatLeaderValue(teamAverage, metric?.unit)}
            {metric?.unit ? ` ${metric.unit}` : ""}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consistent loading placeholders. Prefer skeletons for full-page/panel loads,
 * `Spinner` for inline / small waits inside a button or row.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {label && <span>{label}</span>}
    </span>
  );
}

/**
 * PageSkeleton — mirrors the primary layouts used across the app so first paint
 * always shows structure, never a blank screen.
 *
 *  - "header"   : just the top header shimmer (use as prefix to another block)
 *  - "list"     : stacked rows (settings/lifts/attendance)
 *  - "grid"     : card grid (athletes/exercises/programs)
 *  - "detail"   : hero + panels (athlete profile / workout)
 *  - "table"    : dense rows (log review / leaderboards)
 */
export function PageSkeleton({
  variant = "list",
  rows = 6,
  className,
}: {
  variant?: "header" | "list" | "grid" | "detail" | "table";
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)} aria-hidden="true">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {variant === "header" && null}

      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}

      {variant === "grid" && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      )}

      {variant === "detail" && (
        <>
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </>
      )}

      {variant === "table" && (
        <div className="rounded-lg border border-border/60">
          <Skeleton className="h-10 w-full rounded-t-lg" />
          <div className="divide-y divide-border/60">
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-none" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small inline skeleton for use inside panels/cards. */
export function InlineSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-md" />
      ))}
    </div>
  );
}

/** Centered spinner for auth/token loading screens. */
export function CenteredSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:items-center",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="eyebrow mb-1.5">{eyebrow}</div>
        )}
        <h1 className="truncate font-display text-2xl leading-none tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-0.5">
        <h3 className="font-display text-base tracking-tight">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center",
        className,
      )}
    >
      <h3 className="font-display text-base text-destructive">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: "pr" | "near" | "below" | "info" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const styles: Record<typeof status, string> = {
    pr: "bg-[color:var(--status-pr)]/12 text-[color:var(--status-pr)] border-[color:var(--status-pr)]/25",
    near: "bg-[color:var(--status-near)]/12 text-[color:var(--status-near)] border-[color:var(--status-near)]/25",
    below: "bg-[color:var(--status-below)]/12 text-[color:var(--status-below)] border-[color:var(--status-below)]/25",
    info: "bg-[color:var(--status-info)]/12 text-[color:var(--status-info)] border-[color:var(--status-info)]/25",
    neutral: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        styles[status],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Compact KPI tile — dense, scannable, premium.
 * Prefer this over Card + big text when showing a single metric.
 */
export function StatTile({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: "up" | "down" | "flat";
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const trendColor =
    trend === "up"
      ? "text-[color:var(--status-pr)]"
      : trend === "down"
        ? "text-[color:var(--status-below)]"
        : "text-muted-foreground";
  return (
    <div
      className={cn(
        "group rounded-lg border border-border/60 bg-card p-3.5 shadow-sm transition-colors hover:border-border",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="stat-number text-2xl">{value}</span>
        {hint && <span className={cn("text-xs", trendColor)}>{hint}</span>}
      </div>
    </div>
  );
}

/**
 * Compact horizontal toolbar wrapper. Use above tables/lists
 * to group filters, search, and quick actions on one row.
 */
export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

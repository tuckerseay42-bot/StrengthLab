import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function StatCard({
  title, value, hint, icon, tone = "primary",
}: {
  title: string; value: ReactNode; hint?: string; icon?: ReactNode;
  tone?: "primary" | "accent" | "success";
}) {
  const bg = tone === "accent" ? "bg-accent/10 text-accent" : tone === "success" ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]" : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="stat-number mt-1 text-3xl">{value}</div>
            {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
          </div>
          {icon && <div className={cn("grid h-9 w-9 place-items-center rounded-md", bg)}>{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export function LeaderCard({
  title, subtitle, rows, empty,
}: {
  title: string; subtitle?: string;
  rows: { id: string; name: string; meta?: string; value: string; sub?: string }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/60">
                <Badge variant={i === 0 ? "default" : "secondary"} className={cn("h-6 w-6 justify-center rounded-full p-0", i === 0 && "bg-accent text-accent-foreground")}>
                  {i + 1}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  {r.meta && <div className="truncate text-xs text-muted-foreground">{r.meta}</div>}
                </div>
                <div className="text-right">
                  <div className="stat-number tabular-nums">{r.value}</div>
                  {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

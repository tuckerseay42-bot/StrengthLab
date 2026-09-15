import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SPORTS, GRADES, GENDERS, GENDER_LABELS } from "@/lib/domain";
import type { Athlete } from "@/lib/queries";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export type FilterState = {
  /** "all" or a comma-separated list of selected values */
  sport: string;
  grade: string;
  position: string;
  gender: string;
  from: string;
  to: string;
};

export const emptyFilters: FilterState = { sport: "all", grade: "all", position: "all", gender: "all", from: "", to: "" };

/** Parse a filter field into a list of selected values ([] = no filter). */
export function selectedValues(field: string | undefined): string[] {
  if (!field || field === "all") return [];
  return field.split(",").map((s) => s.trim()).filter(Boolean);
}

function toField(values: string[]) {
  return values.length === 0 ? "all" : values.join(",");
}

function matchesField(field: string | undefined, value: string | null | undefined) {
  const selected = selectedValues(field);
  if (selected.length === 0) return true;
  return value != null && selected.includes(String(value));
}

function MultiSelect({
  label, allLabel, options, value, onChange, width,
}: {
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  width: string;
}) {
  const selected = selectedValues(value);
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${label} · ${selected.length}`;

  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    onChange(toField(next));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 justify-between gap-1.5 border-border/60 bg-transparent px-3 text-xs font-medium hover:bg-muted/60",
            width,
          )}
          aria-label={label}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
            selected.length === 0 && "bg-muted",
          )}
        >
          {allLabel}
        </button>
        <div className="my-1 border-t border-border/60" />
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No options</div>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Checkbox checked={selected.includes(o.value)} className="pointer-events-none" />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact filter toolbar — horizontal pills that stay on one row on desktop,
 * wrap gracefully on mobile. Each picker supports selecting multiple values.
 */
export function Filters({
  value, onChange, athletes, showDates = true, className,
}: {
  value: FilterState;
  onChange: (v: FilterState) => void;
  athletes: Athlete[];
  showDates?: boolean;
  className?: string;
}) {
  const positions = useMemo(() => {
    const s = new Set<string>();
    athletes.forEach((a) => { if (a.position) s.add(a.position); });
    return Array.from(s).sort();
  }, [athletes]);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <MultiSelect
        label="Sports"
        allLabel="All sports"
        width="w-[130px]"
        options={SPORTS.map((s) => ({ value: s, label: s }))}
        value={value.sport}
        onChange={(v) => onChange({ ...value, sport: v })}
      />
      <MultiSelect
        label="Grades"
        allLabel="All grades"
        width="w-[120px]"
        options={GRADES.map((g) => ({ value: String(g), label: `Grade ${g}` }))}
        value={value.grade}
        onChange={(v) => onChange({ ...value, grade: v })}
      />
      <MultiSelect
        label="Positions"
        allLabel="All positions"
        width="w-[130px]"
        options={positions.map((p) => ({ value: p, label: p }))}
        value={value.position}
        onChange={(v) => onChange({ ...value, position: v })}
      />
      <MultiSelect
        label="Genders"
        allLabel="All genders"
        width="w-[130px]"
        options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
        value={value.gender ?? "all"}
        onChange={(v) => onChange({ ...value, gender: v })}
      />
      {showDates && (
        <>
          <Input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="From date"
            className="h-8 w-[140px] border-border/60 bg-transparent text-xs"
          />
          <Input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="To date"
            className="h-8 w-[140px] border-border/60 bg-transparent text-xs"
          />
        </>
      )}
    </div>
  );
}

export function filterAthletes(
  athletes: Athlete[],
  f: FilterState,
  activeTeamId?: string | null,
  teamsByAthlete?: Map<string, Set<string>>,
) {
  return athletes.filter((a) => {
    if (activeTeamId) {
      const extras = teamsByAthlete?.get(a.id);
      const belongs = a.team_id === activeTeamId || (extras?.has(activeTeamId) ?? false);
      if (!belongs) return false;
    }
    if (!matchesField(f.sport, a.sport)) return false;
    if (!matchesField(f.grade, a.grade == null ? null : String(a.grade))) return false;
    if (!matchesField(f.position, a.position)) return false;
    if (!matchesField(f.gender, (a as unknown as { gender: string | null }).gender)) return false;
    return true;
  });
}


export function inDateRange(date: string, f: FilterState) {
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

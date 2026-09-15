import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { athleteDisplayName, type Athlete } from "@/lib/queries";

export function AthleteCombobox({
  athletes,
  value,
  onChange,
  placeholder = "Select athlete",
}: {
  athletes: Athlete[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sport, setSport] = useState<string>("all");
  const selected = athletes.find((a) => a.id === value);

  const athleteSports = (athlete: Athlete) =>
    [athlete.sport, athlete.sport_fall, athlete.sport_winter, athlete.sport_spring]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));

  const sports = useMemo(
    () =>
      Array.from(
        new Set(athletes.flatMap(athleteSports)),
      ).sort((a, b) => a.localeCompare(b)),
    [athletes],
  );

  const visible = useMemo(
    () => (sport === "all" ? athletes : athletes.filter((a) => athleteSports(a).includes(sport))),
    [athletes, sport],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? athleteDisplayName(selected) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search name, sport, grade, position…" />
          {sports.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b px-2 py-1.5">
              <SportChip label="All sports" active={sport === "all"} onClick={() => setSport("all")} />
              {sports.map((s) => (
                <SportChip key={s} label={s} active={sport === s} onClick={() => setSport(s)} />
              ))}
            </div>
          )}
          <CommandList>
            <CommandEmpty>No athletes found.</CommandEmpty>
            <CommandGroup>
              {visible.map((a) => {
                const name = athleteDisplayName(a);
                const sportsLabel = athleteSports(a).join(", ");
                const meta = [sportsLabel || null, a.grade != null ? `Gr ${a.grade}` : null, a.position]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <CommandItem
                    key={a.id}
                    value={[
                      name,
                      a.name,
                      a.first_name,
                      a.last_name,
                      a.preferred_name,
                      a.athlete_email,
                      ...athleteSports(a),
                      a.position,
                      a.class_period,
                      a.grade != null ? `grade ${a.grade}` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => {
                      onChange(a.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", value === a.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {meta && (
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{meta}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SportChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

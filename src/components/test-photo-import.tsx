// Bulk-log a clipboard's worth of test results from a photo instead of
// typing each one in by hand. Every extracted name gets matched against the
// roster and shown for review — nothing reaches `tests` until the coach
// confirms each row.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, testTypesQO, customMetricsQO, type Athlete } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { mergedTestTypes } from "@/lib/domain";
import {
  matchCandidates,
  splitFullName,
  MATCH_CONFIDENCE_LABEL,
  MATCH_CONFIDENCE_CLASS,
  MATCH_CONFIDENCE_REVIEW_ORDER,
  type RowMatchConfidence,
} from "@/lib/name-match";
import {
  extractEntriesFromImage,
  fileToBase64,
  type ExtractedTestEntry,
} from "@/lib/test-import-extract";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ImportRow = {
  id: string;
  rawName: string;
  value: string;
  matchId: string;
  confidence: RowMatchConfidence;
};

export function TestPhotoImport({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const { data: customTypes = [] } = useQuery(testTypesQO);
  const { data: customMetrics = [] } = useQuery(customMetricsQO);
  const allTestTypes = useMemo(
    () => mergedTestTypes(customTypes, customMetrics),
    [customTypes, customMetrics],
  );
  const groups = useMemo(
    () => Array.from(new Set(allTestTypes.map((t) => t.group))),
    [allTestTypes],
  );

  const [testType, setTestType] = useState("");
  const [testDate, setTestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);

  const meta = allTestTypes.find((t) => t.value === testType);

  const buildRows = (entries: ExtractedTestEntry[]) => {
    const built: ImportRow[] = entries.map((e, i) => {
      const { firstName, lastName } = splitFullName(e.name);
      const candidates = matchCandidates({ firstName, lastName }, athletes);
      const top = candidates[0];
      return {
        id: `${i}-${e.name}-${e.value}`,
        rawName: e.name,
        value: String(e.value),
        matchId: top ? top.athlete.id : "",
        confidence: top?.confidence ?? "none",
      };
    });
    built.sort(
      (a, b) =>
        MATCH_CONFIDENCE_REVIEW_ORDER[a.confidence] - MATCH_CONFIDENCE_REVIEW_ORDER[b.confidence],
    );
    setRows(built);
  };

  const onPhoto = async (file: File) => {
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const entries = await extractEntriesFromImage(base64, file.type || "image/jpeg");
      if (!entries.length) {
        toast.error("Couldn't find any name/number pairs in that photo.");
        return;
      }
      buildRows(entries);
      toast.success(`Found ${entries.length} entries — review below`);
    } catch (e) {
      toast.error(toUserMessage(e as Error));
    } finally {
      setBusy(false);
    }
  };

  const setMatch = (id: string, athleteId: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, matchId: athleteId, confidence: athleteId ? "manual" : "none" } : r,
      ),
    );
  };
  const setValue = (id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  };

  const validRows = rows.filter(
    (r) => r.matchId && r.value.trim() && !Number.isNaN(Number(r.value)),
  );

  const apply = useMutation({
    mutationFn: async () => {
      if (!testType) throw new Error("Pick a test type first");
      if (!validRows.length) throw new Error("No matched rows with a valid value to log");
      const organization_id = await getScopedOrgId();
      const { error } = await supabase.from("tests").insert(
        validRows.map((r) => ({
          organization_id,
          athlete_id: r.matchId,
          test_type: testType,
          value: Number(r.value),
          unit: meta?.unit ?? "",
          test_date: testDate,
        })),
      );
      if (error) throw error;
      return validRows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["tests"] });
      toast.success(`Logged ${n} test${n === 1 ? "" : "s"}`);
      setRows([]);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const athleteById = useMemo(() => new Map(athletes.map((a: Athlete) => [a.id, a])), [athletes]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setRows([]);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from photo</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Test type *</Label>
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a metric" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {allTestTypes
                      .filter((t) => t.group === g)
                      .map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </div>
        </div>

        {!testType ? (
          <p className="rounded-md bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
            Pick a test type above to start a photo import.
          </p>
        ) : (
          <label
            className={cn(
              "flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-sm text-muted-foreground transition hover:bg-muted/50",
              busy && "pointer-events-none opacity-60",
            )}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            <span>{busy ? "Reading…" : "Take or choose a photo"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Read from photo</th>
                      <th className="px-3 py-2">Matched athlete</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 font-medium">{r.rawName}</td>
                        <td className="px-3 py-2">
                          <AthleteCombobox
                            athletes={athletes}
                            value={r.matchId}
                            onChange={(id) => setMatch(r.id, id)}
                            placeholder="No match — skip"
                            triggerClassName="h-9 w-48 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={r.value}
                            onChange={(e) => setValue(r.id, e.target.value)}
                            className="h-9 w-20 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={MATCH_CONFIDENCE_CLASS[r.matchId ? r.confidence : "none"]}
                          >
                            {r.matchId ? MATCH_CONFIDENCE_LABEL[r.confidence] : "Skipped"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {validRows.length} of {rows.length} will be logged for{" "}
              <span className="font-medium text-foreground">{meta?.label ?? "…"}</span> on{" "}
              {testDate}.
              {rows.some((r) => !athleteById.get(r.matchId)) && " Review any skipped rows above."}
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || !validRows.length || !testType}
          >
            {apply.isPending
              ? "Logging…"
              : `Log ${validRows.length} result${validRows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

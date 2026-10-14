// Settings widget: upload a school SIS "Section Roster" PDF (Infinite Campus
// and similar), match its students against existing athletes by name, and
// bulk-set class_period for whichever ones matched. Only updates athletes
// already in the roster — never creates new ones, since a coach's class
// period usually only covers some of their athletes.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, titleCaseName, type Athlete } from "@/lib/queries";
import { parseRosterPdf, type RosterPdfRow } from "@/lib/roster-pdf-parse";
import { matchCandidates, type MatchConfidence } from "@/lib/name-match";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/db-errors";

type RowConfidence = MatchConfidence | "manual" | "none";

type Row = {
  id: string;
  pdfRow: RosterPdfRow;
  matchId: string;
  confidence: RowConfidence;
};

const CONFIDENCE_LABEL: Record<RowConfidence, string> = {
  id: "Matched by student ID",
  exact: "Exact name match",
  fuzzy: "Likely match — review",
  weak: "Low confidence — review",
  manual: "Confirmed",
  none: "No match found",
};

const CONFIDENCE_CLASS: Record<RowConfidence, string> = {
  id: "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  exact:
    "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  manual:
    "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  fuzzy: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  weak: "border-border bg-muted text-muted-foreground",
  none: "border-border bg-muted text-muted-foreground",
};

export function ClassPeriodRosterImport() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const [classPeriod, setClassPeriod] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const { periodGuess, rows: parsed } = await parseRosterPdf(file);
      if (!parsed.length) {
        toast.error("Couldn't find any student rows in that PDF.");
        return;
      }
      setFileName(file.name);
      setClassPeriod((prev) => prev || periodGuess || "");
      setRows(
        parsed.map((pdfRow, i) => {
          const candidates = matchCandidates(pdfRow, athletes);
          const top = candidates[0];
          const confidence: RowConfidence = top?.confidence ?? "none";
          return {
            id: `${i}-${pdfRow.studentId || pdfRow.lastName}-${pdfRow.firstName}`,
            pdfRow,
            matchId: top && confidence !== "weak" ? top.athlete.id : "",
            confidence,
          };
        }),
      );
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

  const matchedCount = rows.filter((r) => r.matchId).length;

  const apply = useMutation({
    mutationFn: async () => {
      const period = classPeriod.trim();
      if (!period) throw new Error("Enter a class period label");
      const toApply = rows.filter((r) => r.matchId);
      if (!toApply.length) throw new Error("No athletes matched to update");
      const byId = new Map<string, Athlete>(athletes.map((a) => [a.id, a]));
      const results = await Promise.all(
        toApply.map((r) => {
          const athlete = byId.get(r.matchId);
          const patch: { class_period: string; student_id?: string } = { class_period: period };
          if (athlete && !athlete.student_id && r.pdfRow.studentId) {
            patch.student_id = r.pdfRow.studentId;
          }
          return supabase
            .from("athletes")
            .update(patch as never)
            .eq("id", r.matchId);
        }),
      );
      const failed = results.filter((res) => res.error);
      if (failed.length) throw new Error(`${failed.length} update(s) failed`);
      return toApply.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      toast.success(`Updated class period for ${count} athlete${count === 1 ? "" : "s"}`);
      setRows([]);
      setFileName("");
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Update class periods from a roster</CardTitle>
        <CardDescription>
          Upload a Section Roster PDF (Infinite Campus or similar) for one class period. Students
          are matched to your existing athletes by name — the roster uses legal names, which often
          differ from what's entered here, so review each match before applying. Athletes not on the
          roster are left untouched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Class period label</Label>
            <Input
              value={classPeriod}
              onChange={(e) => setClassPeriod(e.target.value)}
              placeholder="3rd Period"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Roster PDF</Label>
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition hover:bg-muted/50">
              <FileUp className="h-4 w-4" />
              <span className="truncate">{busy ? "Reading…" : fileName || "Choose a PDF…"}</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        {rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Roster name</th>
                      <th className="px-3 py-2">Matched athlete</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {titleCaseName(`${r.pdfRow.firstName} ${r.pdfRow.lastName}`)}
                          </div>
                          {r.pdfRow.grade != null && (
                            <div className="text-xs text-muted-foreground">
                              Grade {r.pdfRow.grade}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <AthleteCombobox
                            athletes={athletes}
                            value={r.matchId}
                            onChange={(id) => setMatch(r.id, id)}
                            placeholder="No match — skip"
                            triggerClassName="h-9 w-56 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={CONFIDENCE_CLASS[r.matchId ? r.confidence : "none"]}
                          >
                            {r.matchId ? CONFIDENCE_LABEL[r.confidence] : "Skipped"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {matchedCount} of {rows.length} will be updated to{" "}
                <span className="font-medium text-foreground">{classPeriod.trim() || "…"}</span>.
              </p>
              <Button
                onClick={() => apply.mutate()}
                disabled={apply.isPending || !matchedCount || !classPeriod.trim()}
              >
                {apply.isPending
                  ? "Updating…"
                  : `Update ${matchedCount} athlete${matchedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

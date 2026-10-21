// Settings widget: upload a school SIS "Section Roster" export — PDF or CSV
// (Infinite Campus and similar) — match its students against existing
// athletes by name, and bulk-set class_period for whichever ones matched.
// Only updates athletes already in the roster — never creates new ones,
// since a coach's class period usually only covers some of their athletes.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, titleCaseName, type Athlete } from "@/lib/queries";
import { parseRosterPdf, parseRosterCsv, type RosterPdfRow } from "@/lib/roster-pdf-parse";
import { matchCandidates, type MatchConfidence } from "@/lib/name-match";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AthleteCombobox } from "@/components/athlete-combobox";
import { FileUp, Check, X } from "lucide-react";
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
  weak: "Last-name match only — please review",
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
  weak: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  none: "border-border bg-muted text-muted-foreground",
};

export function ClassPeriodRosterImport() {
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);
  const [classPeriod, setClassPeriod] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  // Per-row outcome from the last apply — kept visible (not cleared away)
  // so "did this actually work?" has a real answer on screen, not just a
  // toast that already scrolled past.
  const [results, setResults] = useState<Record<string, "ok" | "error">>({});

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
      const { periodGuess, rows: parsed } = isCsv
        ? await parseRosterCsv(file)
        : await parseRosterPdf(file);
      if (!parsed.length) {
        toast.error(`Couldn't find any student rows in that ${isCsv ? "CSV" : "PDF"}.`);
        return;
      }
      setFileName(file.name);
      setClassPeriod((prev) => prev || periodGuess || "");
      const built = parsed.map((pdfRow, i) => {
        // Even a "weak" candidate (last name close, first name nothing alike)
        // is worth surfacing — that's exactly the shape of a legal name vs.
        // the nickname an athlete actually goes by. Pre-filling it lets the
        // coach approve with one glance instead of having to re-search a
        // name that was already found.
        const candidates = matchCandidates(pdfRow, athletes);
        const top = candidates[0];
        const confidence: RowConfidence = top?.confidence ?? "none";
        return {
          id: `${i}-${pdfRow.studentId || pdfRow.lastName}-${pdfRow.firstName}`,
          pdfRow,
          matchId: top ? top.athlete.id : "",
          confidence,
        };
      });
      // Rows that need a closer look float to the top so the coach reviews
      // those first instead of hunting for them in a 40-row list.
      const reviewOrder: Record<RowConfidence, number> = {
        none: 0,
        weak: 1,
        fuzzy: 2,
        manual: 3,
        exact: 4,
        id: 5,
      };
      built.sort((a, b) => reviewOrder[a.confidence] - reviewOrder[b.confidence]);
      setRows(built);
      setResults({});
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
      const outcomes = await Promise.all(
        toApply.map(async (r) => {
          const athlete = byId.get(r.matchId);
          const patch: { class_period: string; student_id?: string } = { class_period: period };
          if (athlete && !athlete.student_id && r.pdfRow.studentId) {
            patch.student_id = r.pdfRow.studentId;
          }
          const { error } = await supabase
            .from("athletes")
            .update(patch as never)
            .eq("id", r.matchId);
          return { id: r.id, ok: !error };
        }),
      );
      return outcomes;
    },
    // Rows stay on screen either way — a per-row "Updated"/"Failed" badge
    // is the actual answer to "did this work?", not a toast that's already
    // gone by the time you look up from the keyboard.
    onSuccess: (outcomes) => {
      qc.invalidateQueries({ queryKey: ["athletes"] });
      setResults(Object.fromEntries(outcomes.map((o) => [o.id, o.ok ? "ok" : "error"] as const)));
      const okCount = outcomes.filter((o) => o.ok).length;
      const failCount = outcomes.length - okCount;
      if (failCount > 0) {
        toast.error(`Updated ${okCount}, ${failCount} failed — see table below for which`);
      } else {
        toast.success(`Updated class period for ${okCount} athlete${okCount === 1 ? "" : "s"}`);
      }
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const startOver = () => {
    setRows([]);
    setResults({});
    setFileName("");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Update class periods from a roster</CardTitle>
        <CardDescription>
          Upload a Section Roster export (Infinite Campus or similar — PDF or CSV) for one class
          period. Students are matched to your existing athletes by name — the roster uses legal
          names, which often differ from what's entered here, so review each match before applying.
          Athletes not on the roster are left untouched.
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
            <Label className="text-xs text-muted-foreground">Roster PDF or CSV</Label>
            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition hover:bg-muted/50">
              <FileUp className="h-4 w-4" />
              <span className="truncate">{busy ? "Reading…" : fileName || "Choose a file…"}</span>
              <input
                type="file"
                accept="application/pdf,.pdf,.csv,text/csv"
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
                    {rows.map((r) => {
                      const result = results[r.id];
                      const matchedAthlete = r.matchId
                        ? athletes.find((a) => a.id === r.matchId)
                        : null;
                      const alreadySet =
                        !!matchedAthlete &&
                        !!classPeriod.trim() &&
                        (matchedAthlete as unknown as { class_period: string | null })
                          .class_period === classPeriod.trim();
                      return (
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
                            <div className="flex items-center gap-1.5">
                              {result ? (
                                <Badge
                                  variant="outline"
                                  className={
                                    result === "ok"
                                      ? "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]"
                                      : "border-destructive/30 bg-destructive/15 text-destructive"
                                  }
                                >
                                  {result === "ok" ? (
                                    <>
                                      <Check className="h-3 w-3" /> Updated
                                    </>
                                  ) : (
                                    <>
                                      <X className="h-3 w-3" /> Failed — try again
                                    </>
                                  )}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={CONFIDENCE_CLASS[r.matchId ? r.confidence : "none"]}
                                >
                                  {r.matchId ? CONFIDENCE_LABEL[r.confidence] : "Skipped"}
                                </Badge>
                              )}
                              {!result && alreadySet && (
                                <Badge variant="outline" className="text-muted-foreground">
                                  Already set
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {Object.keys(results).length > 0 ? (
                  "Re-upload to import again, or start over below."
                ) : (
                  <>
                    {matchedCount} of {rows.length} will be updated to{" "}
                    <span className="font-medium text-foreground">{classPeriod.trim() || "…"}</span>
                    .
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={startOver}>
                  Start new import
                </Button>
                <Button
                  onClick={() => apply.mutate()}
                  disabled={apply.isPending || !matchedCount || !classPeriod.trim()}
                >
                  {apply.isPending
                    ? "Updating…"
                    : `Update ${matchedCount} athlete${matchedCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

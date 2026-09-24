import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { athletesQO, athleteDisplayName, titleCaseName, type Athlete } from "@/lib/queries";
import { TEST_TYPES } from "@/lib/domain";
import { useActiveTeamId } from "@/hooks/use-active-team";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toast } from "sonner";
import { Upload, Download, FileText } from "lucide-react";

type EntityKind = "athletes" | "tests" | "lifts" | "attendance" | "class_period";

const TEMPLATES: Record<EntityKind, { headers: string[]; sample: string[] }> = {
  athletes: {
    headers: ["first_name", "last_name", "grade", "sport", "position", "graduation_year", "bodyweight", "height_in", "athlete_email", "parent_email", "student_id"],
    sample: ["Jane", "Doe", "11", "Track & Field", "Sprinter", "2027", "145", "66", "jane@example.com", "", ""],
  },
  class_period: {
    headers: ["athlete_name", "student_id", "class_period"],
    sample: ["Jane Doe", "", "3rd Period"],
  },
  tests: {
    headers: ["athlete_name", "test_type", "value", "test_date", "notes"],
    sample: ["Jane Doe", "vertical_jump", "24.5", "2026-05-01", ""],
  },
  lifts: {
    headers: ["athlete_name", "exercise", "load", "sets", "reps", "lift_date", "notes"],
    sample: ["Jane Doe", "Back Squat", "185", "3", "5", "2026-05-01", ""],
  },
  attendance: {
    headers: ["athlete_name", "session_date", "present", "notes"],
    sample: ["Jane Doe", "2026-05-01", "true", ""],
  },
};

export const Route = createFileRoute("/import")({
  head: () => ({ meta: [{ title: "CSV Import — Strength Lab" }] }),
  component: ImportPage,
});

// Minimal CSV parser supporting quoted fields and commas
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim().length));
}

function toRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCSV(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
  return { headers, records };
}

function findAthlete(athletes: Athlete[], name: string, studentId?: string): Athlete | undefined {
  const sid = studentId?.trim();
  if (sid) {
    const bySid = athletes.find((a) => (a.student_id ?? "").trim() === sid);
    if (bySid) return bySid;
  }
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return athletes.find((a) => {
    const full = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().toLowerCase();
    return full === key || (a.name ?? "").trim().toLowerCase() === key;
  });
}

function downloadTemplate(kind: EntityKind) {
  const t = TEMPLATES[kind];
  const csv = [t.headers.join(","), t.sample.join(",")].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportPage() {
  const [kind, setKind] = useState<EntityKind>("athletes");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  const [activeTeamId] = useActiveTeamId();
  const qc = useQueryClient();
  const { data: athletes = [] } = useQuery(athletesQO);

  const parsed = useMemo(() => (text ? toRecords(text) : { headers: [], records: [] }), [text]);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    setText(await f.text());
  };

  const runImport = async () => {
    if (!parsed.records.length) { toast.error("No rows to import"); return; }
    setBusy(true);
    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;

    try {
      if (kind === "athletes") {
        const rows = parsed.records.map((r, idx) => {
          const first = titleCaseName(r.first_name || r.firstname || "");
          const last = titleCaseName(r.last_name || r.lastname || "");
          if (!first && !last) { errors.push(`Row ${idx + 2}: missing name`); return null; }
          return {
            first_name: first || null,
            last_name: last || null,
            name: `${first} ${last}`.trim(),
            grade: r.grade ? Number(r.grade) : null,
            sport: r.sport || null,
            position: r.position || null,
            graduation_year: r.graduation_year ? Number(r.graduation_year) : null,
            bodyweight: r.bodyweight ? Number(r.bodyweight) : null,
            height_in: r.height_in ? Number(r.height_in) : null,
            athlete_email: r.athlete_email || null,
            parent_email: r.parent_email || null,
            student_id: r.student_id || null,
            team_id: activeTeamId,
            status: "active",
          };
        }).filter(Boolean) as Record<string, unknown>[];
        if (rows.length) {
          const organization_id = await getScopedOrgId();
          const scopedRows = rows.map((r) => ({ ...r, organization_id }));
          const { error, count } = await supabase.from("athletes").insert(scopedRows as never, { count: "exact" });
          if (error) errors.push(error.message);
          else inserted = count ?? rows.length;
        }
        skipped = parsed.records.length - rows.length;
      }

      else if (kind === "class_period") {
        const updates: { id: string; class_period: string | null }[] = [];
        parsed.records.forEach((r, idx) => {
          const athlete = findAthlete(athletes, r.athlete_name || r.athlete || "", r.student_id);
          if (!athlete) {
            errors.push(`Row ${idx + 2}: athlete "${r.athlete_name || r.student_id || "?"}" not found in your roster — not creating a new athlete`);
            skipped++;
            return;
          }
          updates.push({ id: athlete.id, class_period: r.class_period?.trim() || null });
        });
        if (updates.length) {
          const results = await Promise.all(
            updates.map((u) => supabase.from("athletes").update({ class_period: u.class_period } as never).eq("id", u.id)),
          );
          results.forEach((res, i) => {
            if (res.error) errors.push(`${updates[i].id}: ${res.error.message}`);
          });
          inserted = updates.length - results.filter((r) => r.error).length;
        }
      }

      else if (kind === "tests") {
        const rows: Record<string, unknown>[] = [];
        parsed.records.forEach((r, idx) => {
          const athlete = findAthlete(athletes, r.athlete_name || r.athlete || "");
          if (!athlete) { errors.push(`Row ${idx + 2}: athlete "${r.athlete_name}" not found`); skipped++; return; }
          const tt = TEST_TYPES.find((t) => t.value === r.test_type);
          if (!tt) { errors.push(`Row ${idx + 2}: unknown test_type "${r.test_type}"`); skipped++; return; }
          const val = Number(r.value);
          if (!isFinite(val)) { errors.push(`Row ${idx + 2}: invalid value`); skipped++; return; }
          rows.push({
            athlete_id: athlete.id,
            test_type: r.test_type,
            value: val,
            unit: tt.unit,
            test_date: r.test_date || new Date().toISOString().slice(0, 10),
            notes: r.notes || null,
          });
        });
        if (rows.length) {
          const { error, count } = await supabase.from("tests").insert(rows as never, { count: "exact" });
          if (error) errors.push(error.message);
          else inserted = count ?? rows.length;
        }
      }

      else if (kind === "lifts") {
        const rows: Record<string, unknown>[] = [];
        parsed.records.forEach((r, idx) => {
          const athlete = findAthlete(athletes, r.athlete_name || r.athlete || "");
          if (!athlete) { errors.push(`Row ${idx + 2}: athlete "${r.athlete_name}" not found`); skipped++; return; }
          if (!r.exercise) { errors.push(`Row ${idx + 2}: missing exercise`); skipped++; return; }
          rows.push({
            athlete_id: athlete.id,
            exercise: r.exercise,
            load: r.load ? Number(r.load) : null,
            sets: r.sets ? Number(r.sets) : null,
            reps: r.reps ? Number(r.reps) : null,
            lift_date: r.lift_date || new Date().toISOString().slice(0, 10),
            notes: r.notes || null,
          });
        });
        if (rows.length) {
          const { error, count } = await supabase.from("lifts").insert(rows as never, { count: "exact" });
          if (error) errors.push(error.message);
          else inserted = count ?? rows.length;
        }
      }

      else if (kind === "attendance") {
        const rows: Record<string, unknown>[] = [];
        parsed.records.forEach((r, idx) => {
          const athlete = findAthlete(athletes, r.athlete_name || r.athlete || "");
          if (!athlete) { errors.push(`Row ${idx + 2}: athlete "${r.athlete_name}" not found`); skipped++; return; }
          if (!r.session_date) { errors.push(`Row ${idx + 2}: missing session_date`); skipped++; return; }
          const present = /^(1|true|yes|y|present|p)$/i.test((r.present || "").trim());
          rows.push({
            athlete_id: athlete.id,
            session_date: r.session_date,
            present,
            notes: r.notes || null,
          });
        });
        if (rows.length) {
          const { error, count } = await supabase.from("attendance").insert(rows as never, { count: "exact" });
          if (error) errors.push(error.message);
          else inserted = count ?? rows.length;
        }
      }

      setResult({ inserted, skipped, errors });
      if (inserted > 0) {
        toast.success(`Imported ${inserted} row${inserted === 1 ? "" : "s"}`);
        qc.invalidateQueries();
      } else if (errors.length) {
        toast.error("Import failed — see details below");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">CSV Import</h1>
        <p className="text-sm text-muted-foreground">Bulk-load athletes, tests, lifts, or attendance from a CSV file.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1. Choose what to import</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[220px_1fr] items-end">
          <div>
            <Label>Data type</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v as EntityKind); setResult(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="athletes">Athletes (roster)</SelectItem>
                <SelectItem value="class_period">Class period (update existing)</SelectItem>
                <SelectItem value="tests">Tests</SelectItem>
                <SelectItem value="lifts">Lifts</SelectItem>
                <SelectItem value="attendance">Attendance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            <div className="mb-2"><span className="font-medium text-foreground">Expected columns:</span> {TEMPLATES[kind].headers.join(", ")}</div>
            {kind === "class_period" && (
              <p className="mb-2 text-xs">
                Matches each row to an athlete already in your roster — by <code>student_id</code> when given, otherwise by full name — and sets their class period. Rows that don't match an existing athlete are skipped; nothing new is created.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => downloadTemplate(kind)}>
              <Download className="mr-2 h-4 w-4" /> Download template
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">2. Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {fileName && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" /> {fileName} — {parsed.records.length} row{parsed.records.length === 1 ? "" : "s"} detected
            </div>
          )}
          {kind === "athletes" && !activeTeamId && (
            <p className="text-xs text-destructive">Tip: pick an active team in the header so imported athletes are assigned to it.</p>
          )}
          {parsed.records.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>{parsed.headers.map((h) => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.records.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t">
                      {parsed.headers.map((h) => <td key={h} className="px-2 py-1">{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.records.length > 5 && (
                <div className="border-t px-2 py-1 text-xs text-muted-foreground">…and {parsed.records.length - 5} more</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">3. Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={runImport} disabled={busy || !parsed.records.length}>
            <Upload className="mr-2 h-4 w-4" /> {busy ? "Importing…" : `Import ${parsed.records.length} row${parsed.records.length === 1 ? "" : "s"}`}
          </Button>
          {result && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">{result.inserted}</span> {kind === "class_period" ? "updated" : "inserted"}
                {result.skipped > 0 && <> · <span className="font-medium">{result.skipped}</span> skipped</>}
              </div>
              {result.errors.length > 0 && (
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-destructive">{result.errors.length} error{result.errors.length === 1 ? "" : "s"}</summary>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                    {result.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

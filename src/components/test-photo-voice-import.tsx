// Two ways to bulk-log a clipboard's worth of test results without typing
// each one by hand: snap a photo of the handwritten sheet, or read the
// names and numbers out loud while this is listening. Either way, every
// extracted name gets matched against the roster and shown for review —
// nothing reaches `tests` until the coach confirms each row.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { athletesQO, testTypesQO, customMetricsQO, type Athlete } from "@/lib/queries";
import { getScopedOrgId } from "@/lib/scoped-insert";
import { toUserMessage } from "@/lib/db-errors";
import { mergedTestTypes } from "@/lib/domain";
import {
  matchCandidates,
  MATCH_CONFIDENCE_LABEL,
  MATCH_CONFIDENCE_CLASS,
  MATCH_CONFIDENCE_REVIEW_ORDER,
  type RowMatchConfidence,
} from "@/lib/name-match";
import {
  extractEntriesFromImage,
  extractEntriesFromTranscript,
  fileToBase64,
  type ExtractedTestEntry,
} from "@/lib/test-import-extract";
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech-recognition";
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
import { Textarea } from "@/components/ui/textarea";
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
import { Camera, Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ImportRow = {
  id: string;
  rawName: string;
  value: string;
  matchId: string;
  confidence: RowMatchConfidence;
};

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : (parts[0] ?? ""),
  };
}

export function TestPhotoVoiceImport({
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
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const meta = allTestTypes.find((t) => t.value === testType);
  const speechSupported = !!getSpeechRecognitionCtor();

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

  const startRecording = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    setTranscript("");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
      }
      if (finalText) setTranscript((t) => (t + " " + finalText).trim());
    };
    rec.onerror = (event) => {
      if (event.error !== "no-speech") toast.error(`Voice input error: ${event.error}`);
    };
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const parseTranscript = async () => {
    if (!transcript.trim()) {
      toast.error("Nothing recorded yet");
      return;
    }
    setBusy(true);
    try {
      const entries = await extractEntriesFromTranscript(transcript);
      if (!entries.length) {
        toast.error("Couldn't find any name/number pairs in that recording.");
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
      resetAll();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(toUserMessage(e)),
  });

  const resetAll = () => {
    setRows([]);
    setTranscript("");
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const athleteById = useMemo(() => new Map(athletes.map((a: Athlete) => [a.id, a])), [athletes]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetAll();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from photo or voice</DialogTitle>
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
            Pick a test type above to start a photo or voice import.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
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

            <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-sm text-muted-foreground">
              {!speechSupported ? (
                <span className="px-3 text-center text-xs">
                  Voice input isn't supported in this browser.
                </span>
              ) : recording ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={stopRecording}
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                  <span className="text-xs">Listening…</span>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={startRecording}
                  >
                    <Mic className="h-3.5 w-3.5" /> Record
                  </Button>
                  <span className="text-xs">Read names + numbers aloud</span>
                </>
              )}
            </div>
          </div>
        )}

        {transcript && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Transcript</Label>
              {!recording && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void parseTranscript()}
                >
                  {busy ? "Parsing…" : "Parse transcript"}
                </Button>
              )}
            </div>
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Heard / read</th>
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

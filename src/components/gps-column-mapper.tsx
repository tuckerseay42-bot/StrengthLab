// "Match your columns" screen — shown when a GPS export's headers can't be
// auto-mapped (or when the coach wants to correct the auto match).
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { GPS_FIELDS, type ColumnMapping, type SheetScan } from "@/lib/gps";

const NONE = "__none__";

export function GpsColumnMapper({
  scan, open, onCancel, onConfirm,
}: {
  scan: SheetScan | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: (mapping: ColumnMapping, remember: boolean) => void;
}) {
  const [draft, setDraft] = useState<ColumnMapping>({});
  const [remember, setRemember] = useState(true);
  const [seeded, setSeeded] = useState<SheetScan | null>(null);

  // Seed from the auto-detected mapping whenever a new file is scanned.
  if (scan && seeded !== scan) {
    setSeeded(scan);
    setDraft({ ...scan.mapping });
  }

  const missing = useMemo(
    () => GPS_FIELDS.filter((f) => f.required && draft[f.key] === undefined).map((f) => f.label),
    [draft],
  );

  if (!scan) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Match your columns</DialogTitle>
          <DialogDescription>
            We read <span className="font-medium">{scan.headers.length}</span> columns from
            {" "}<span className="font-medium">{scan.sheet}</span>. Pair each report field with the matching column
            from your file. Optional fields can stay unmatched.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border/60 rounded-lg border border-border/60">
          {GPS_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.label}</div>
                <div className="text-[11px] text-muted-foreground">{f.required ? "Required" : "Optional"}</div>
              </div>
              <select
                value={draft[f.key] === undefined ? NONE : String(draft[f.key])}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) => {
                    const next = { ...d };
                    if (v === NONE) delete next[f.key];
                    else next[f.key] = Number(v);
                    return next;
                  });
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value={NONE}>— Not in my file —</option>
                {scan.headers.map((h, i) => (
                  <option key={`${h}-${i}`} value={i}>{h}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
          Remember this mapping for future uploads from this source
        </label>

        <DialogFooter className="gap-2">
          {missing.length > 0 && (
            <span className="mr-auto text-xs text-destructive">Still needed: {missing.join(", ")}</span>
          )}
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={missing.length > 0} onClick={() => onConfirm(draft, remember)}>
            Build report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import * as XLSX from "xlsx";

export type GpsRow = {
  id: string;
  organization_id: string;
  athlete_id: string | null;
  player_name: string;
  session_date: string;
  top_speed: number | null;
  peak_acceleration: number | null;
  sprint_yards: number | null;
  player_load: number | null;
  sprint_count: number | null;
  acceleration_count: number | null;
  deceleration_count: number | null;
  source_file: string | null;
  created_at: string;
};

export type ParsedGpsRow = {
  player_name: string;
  session_date: string;
  top_speed: number | null;
  peak_acceleration: number | null;
  sprint_yards: number | null;
  player_load: number | null;
  sprint_count: number | null;
  acceleration_count: number | null;
  deceleration_count: number | null;
};

export const GPS_METRICS = [
  { key: "top_speed", label: "Top Speed", unit: "mph" },
  { key: "peak_acceleration", label: "Peak Acceleration", unit: "m/s²" },
  { key: "player_load", label: "Player Load", unit: "" },
  { key: "sprint_yards", label: "Sprint Yards", unit: "yd" },
  { key: "sprint_count", label: "Sprint Count", unit: "" },
  { key: "acceleration_count", label: "Acceleration Count", unit: "" },
  { key: "deceleration_count", label: "Deceleration Count", unit: "" },
] as const;

export type GpsMetricKey = (typeof GPS_METRICS)[number]["key"];

/** Metrics selectable on the leaderboard: raw GPS columns plus derived ones. */
export const BOARD_METRICS = [
  ...GPS_METRICS,
  { key: "combined_effort", label: "High Intensity Efforts", unit: "" },
  { key: "loaf", label: "Loafs (below weekday avg)", unit: "" },
] as const;

export type BoardMetricKey = GpsMetricKey | "combined_effort" | "loaf";

/** Value of any board metric for a row (handles derived accel + decel total). */
export function boardMetricValue(row: Record<string, unknown>, key: BoardMetricKey): number | null {
  // Loafs need the athlete's history; computed by boardEntries in gps-report.ts.
  if (key === "loaf") return null;
  if (key === "combined_effort") {
    const a = row["acceleration_count"];
    const d = row["deceleration_count"];
    const an = typeof a === "number" ? a : null;
    const dn = typeof d === "number" ? d : null;
    if (an == null && dn == null) return null;
    return (an ?? 0) + (dn ?? 0);
  }
  const raw = row[key];
  return typeof raw === "number" ? raw : null;
}

export type GpsField = keyof ParsedGpsRow;

/**
 * Every field the report can use, with the naming variants seen across GPS
 * vendors (Titan, Catapult, Polar, GPSports, STATSports, plain spreadsheets…).
 * Matching is normalized: lowercased, punctuation stripped, spaces collapsed.
 */
export const GPS_FIELDS: { key: GpsField; label: string; required: boolean; aliases: string[] }[] = [
  {
    key: "session_date",
    label: "Date",
    required: true,
    aliases: ["date", "session date", "session day", "day", "practice date", "activity date", "start date", "date time", "datetime", "timestamp", "session"],
  },
  {
    key: "player_name",
    label: "Player / Athlete Name",
    required: true,
    aliases: ["player name", "player", "name", "athlete", "athlete name", "full name", "player full name", "participant", "person", "display name", "last name first name", "player id name"],
  },
  {
    key: "acceleration_count",
    label: "Acceleration Count",
    required: false,
    aliases: ["acceleration count", "accel count", "accelerations", "accels", "# accels", "no of accels", "number of accelerations", "acc count", "total accelerations", "acceleration efforts", "accel efforts", "accelerations count"],
  },
  {
    key: "deceleration_count",
    label: "Deceleration Count",
    required: false,
    aliases: ["deceleration count", "decel count", "decelerations", "decels", "# decels", "no of decels", "number of decelerations", "dec count", "total decelerations", "deceleration efforts", "decel efforts", "decelerations count"],
  },
  {
    key: "top_speed",
    label: "Top Speed",
    required: false,
    aliases: ["top speed", "max speed", "peak speed", "maximum speed", "max velocity", "top speed mph", "max speed mph", "highest speed", "vmax", "max vel"],
  },
  {
    key: "peak_acceleration",
    label: "Peak Acceleration",
    required: false,
    aliases: ["peak acceleration", "max acceleration", "acceleration", "maximum acceleration", "peak accel", "max accel", "top acceleration"],
  },
  {
    key: "player_load",
    label: "Player Load",
    required: false,
    aliases: ["player load", "load", "total player load", "training load", "workload", "session load", "impulse load", "body load"],
  },
  {
    key: "sprint_yards",
    label: "Sprint Yards",
    required: false,
    aliases: ["sprint yards", "sprint distance", "sprint yds", "high speed distance", "high speed running", "hsr", "sprint distance yards", "sprint distance yd"],
  },
  {
    key: "sprint_count",
    label: "Sprint Count",
    required: false,
    aliases: ["sprint count", "sprints", "# sprints", "number of sprints", "sprint efforts", "total sprints", "no of sprints"],
  },
];

export const GPS_REQUIRED_FIELDS = GPS_FIELDS.filter((f) => f.required).map((f) => f.key);

export function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .replace(/[_\-/\\|.,:;()[\]{}#%*"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ALIAS_INDEX: Record<string, GpsField> = (() => {
  const out: Record<string, GpsField> = {};
  for (const f of GPS_FIELDS) {
    out[normalizeHeader(f.key)] = f.key;
    out[normalizeHeader(f.label)] = f.key;
    for (const a of f.aliases) out[normalizeHeader(a)] = f.key;
  }
  return out;
})();

/** Exact-then-fuzzy match of one header cell to a report field. */
export function matchField(header: unknown): GpsField | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  if (ALIAS_INDEX[h]) return ALIAS_INDEX[h];
  // "max speed (mph)" -> "max speed mph" -> try dropping trailing unit tokens
  const stripped = h.replace(/\b(mph|m s|ms|kph|km h|yd|yds|yards|m|meters|metres|per session|total|avg|average)\b/g, " ").replace(/\s+/g, " ").trim();
  if (stripped && ALIAS_INDEX[stripped]) return ALIAS_INDEX[stripped];
  // containment fallback: header contains a known alias (or vice versa)
  let best: { key: GpsField; len: number } | null = null;
  for (const [alias, key] of Object.entries(ALIAS_INDEX)) {
    if (alias.length < 4) continue;
    if (h === alias || h.includes(alias)) {
      if (!best || alias.length > best.len) best = { key, len: alias.length };
    }
  }
  return best?.key ?? null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\s*#/.test(v)) return null; // #DIV/0!, #N/A …
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDateString(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const yr = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${yr}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Spreadsheet calculation-error markers that mean "no signal / no session". */
const ERROR_CELL = /^#(div\/0|n\/a|value|ref|name|num|null)/i;
export const isErrorCell = (v: unknown) => typeof v === "string" && ERROR_CELL.test(v.trim());

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/** field -> column index in the header row. */
export type ColumnMapping = Partial<Record<GpsField, number>>;

export type SheetScan = {
  sheet: string;
  headerIndex: number;
  headers: string[];
  grid: unknown[][];
  /** Auto-detected mapping (may be incomplete). */
  mapping: ColumnMapping;
  /** Required fields the auto-matcher could not confidently resolve. */
  missingRequired: GpsField[];
};

function autoMap(headerRow: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headerRow.forEach((cell, i) => {
    const key = matchField(cell);
    if (key && mapping[key] === undefined) mapping[key] = i;
  });
  return mapping;
}

function scanSheet(grid: unknown[][], sheet: string): SheetScan | null {
  let bestIdx = -1;
  let bestScore = -1;
  const limit = Math.min(grid.length, 30);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] ?? [];
    const map = autoMap(row);
    const filled = row.filter((c) => String(c ?? "").trim() !== "").length;
    const score = Object.keys(map).length * 10 + Math.min(filled, 8);
    if (filled >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;
  const headerRow = grid[bestIdx] ?? [];
  const headers = headerRow.map((c, i) => {
    const s = String(c ?? "").trim();
    return s || `Column ${i + 1}`;
  });
  const mapping = autoMap(headerRow);
  return {
    sheet,
    headerIndex: bestIdx,
    headers,
    grid,
    mapping,
    missingRequired: GPS_REQUIRED_FIELDS.filter((k) => mapping[k] === undefined),
  };
}

/** Reads the workbook and returns the most data-rich sheet with its header row. */
export function scanGpsWorkbook(data: ArrayBuffer): SheetScan | null {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const candidates = wb.SheetNames.filter((n) => !n.startsWith("_ib"));
  let best: SheetScan | null = null;
  let bestRows = -1;
  for (const name of candidates.length ? candidates : wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      raw: true,
    });
    const scan = scanSheet(grid, name);
    if (!scan) continue;
    const bodyRows = grid.length - scan.headerIndex - 1;
    const rank = Object.keys(scan.mapping).length * 1000 + bodyRows;
    if (rank > bestRows) {
      bestRows = rank;
      best = scan;
    }
  }
  return best;
}

export type ParseResult = {
  rows: ParsedGpsRow[];
  /** Rows with a player/date but unusable content. */
  skipped: number;
  /** Rows dropped as no-signal / calculation-error entries. */
  filtered: number;
  sheet: string | null;
};

/** Turns a scanned sheet + column mapping into report rows, filtering junk. */
export function rowsFromScan(scan: SheetScan, mapping: ColumnMapping): ParseResult {
  const rows: ParsedGpsRow[] = [];
  let skipped = 0;
  let filtered = 0;

  const col = (key: GpsField, raw: unknown[]) => {
    const i = mapping[key];
    return i === undefined ? undefined : raw[i];
  };

  for (let i = scan.headerIndex + 1; i < scan.grid.length; i++) {
    const raw = scan.grid[i] ?? [];
    if (!raw.length) continue;

    const name = String(col("player_name", raw) ?? "").trim();
    const date = toDateString(col("session_date", raw));
    if (!name || !date) {
      if (name || date) skipped++;
      continue;
    }

    // A calculation error in a column we actually use = no signal for that session.
    const usedCells = Object.values(mapping)
      .filter((i): i is number => i !== undefined)
      .map((i) => raw[i]);
    if (usedCells.some(isErrorCell)) {
      filtered++;
      continue;
    }

    const rec: ParsedGpsRow = {
      player_name: name,
      session_date: date,
      top_speed: num(col("top_speed", raw)),
      peak_acceleration: num(col("peak_acceleration", raw)),
      sprint_yards: num(col("sprint_yards", raw)),
      player_load: num(col("player_load", raw)),
      sprint_count: num(col("sprint_count", raw)),
      acceleration_count: num(col("acceleration_count", raw)),
      deceleration_count: num(col("deceleration_count", raw)),
    };

    // No-session rows: every metric present on the row is explicitly zero.
    const values = [
      rec.top_speed, rec.peak_acceleration, rec.sprint_yards, rec.player_load,
      rec.sprint_count, rec.acceleration_count, rec.deceleration_count,
    ].filter((v): v is number => v != null);
    if (values.length && values.every((v) => v === 0)) {
      filtered++;
      continue;
    }


    rows.push(rec);
  }

  return { rows, skipped, filtered, sheet: scan.sheet };
}

/** Back-compatible one-shot parse (auto mapping only). */
export function parseGpsWorkbook(data: ArrayBuffer, fileName?: string): ParseResult {
  void fileName;
  const scan = scanGpsWorkbook(data);
  if (!scan || scan.missingRequired.length) return { rows: [], skipped: 0, filtered: 0, sheet: null };
  return rowsFromScan(scan, scan.mapping);
}

// ---------------------------------------------------------------------------
// Remembered mappings (per source-file header signature, per browser/org)
// ---------------------------------------------------------------------------

const MAP_STORE = "sl.gpsColumnMaps.v1";

/** Stable key for "an export from this source" — the set of column headers. */
export function headerSignature(headers: string[]): string {
  return headers.map(normalizeHeader).filter(Boolean).sort().join("|");
}

type StoredMap = Record<string, Record<string, string>>; // signature -> field -> header name

function readStore(): StoredMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(MAP_STORE) ?? "{}") as StoredMap;
  } catch {
    return {};
  }
}

export function loadSavedMapping(scan: SheetScan, scopeKey = "default"): ColumnMapping | null {
  const saved = readStore()[`${scopeKey}::${headerSignature(scan.headers)}`];
  if (!saved) return null;
  const mapping: ColumnMapping = {};
  for (const [field, header] of Object.entries(saved)) {
    const idx = scan.headers.findIndex((h) => normalizeHeader(h) === normalizeHeader(header));
    if (idx >= 0) mapping[field as GpsField] = idx;
  }
  return GPS_REQUIRED_FIELDS.every((k) => mapping[k] !== undefined) ? mapping : null;
}

export function saveMapping(scan: SheetScan, mapping: ColumnMapping, scopeKey = "default") {
  if (typeof window === "undefined") return;
  const store = readStore();
  const entry: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    if (idx === undefined) continue;
    const header = scan.headers[idx as number];
    if (header) entry[field] = header;
  }
  store[`${scopeKey}::${headerSignature(scan.headers)}`] = entry;
  try {
    window.localStorage.setItem(MAP_STORE, JSON.stringify(store));
  } catch {
    /* storage full / disabled — mapping just won't be remembered */
  }
}

export function forgetMapping(scan: SheetScan, scopeKey = "default") {
  if (typeof window === "undefined") return;
  const store = readStore();
  delete store[`${scopeKey}::${headerSignature(scan.headers)}`];
  window.localStorage.setItem(MAP_STORE, JSON.stringify(store));
}

// ---------------------------------------------------------------------------

export type LoadStatus = "high" | "normal" | "low" | "none";

/** Today's player load ÷ rolling average load. */
export function loadStatus(today: number | null, average: number | null): { ratio: number | null; status: LoadStatus } {
  if (!today || !average) return { ratio: null, status: "none" };
  const ratio = today / average;
  if (ratio > 1.2) return { ratio, status: "high" };
  if (ratio < 0.8) return { ratio, status: "low" };
  return { ratio, status: "normal" };
}

export function statusLabel(s: LoadStatus) {
  return s === "high" ? "High" : s === "low" ? "Low" : s === "normal" ? "Normal" : "—";
}

export function summarize(rows: GpsRow[], key: GpsMetricKey) {
  const values = rows.map((r) => r[key]).filter((v): v is number => v != null);
  if (!values.length) return { today: null, average: null, max: null };
  const sorted = [...rows].sort((a, b) => a.session_date.localeCompare(b.session_date));
  const latest = [...sorted].reverse().find((r) => r[key] != null)?.[key] ?? null;
  return {
    today: latest as number | null,
    average: values.reduce((s, v) => s + v, 0) / values.length,
    max: Math.max(...values),
  };
}

export function fmt(v: number | null | undefined, digits = 2) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

/** Matches an imported player name to an athlete id. */
export function matchAthlete<T extends { id: string; name: string; first_name: string | null; last_name: string | null; preferred_name: string | null }>(
  playerName: string,
  athletes: T[],
): string | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const target = norm(playerName);
  for (const a of athletes) {
    const options = [
      a.name,
      [a.first_name, a.last_name].filter(Boolean).join(" "),
      [a.preferred_name, a.last_name].filter(Boolean).join(" "),
    ].filter(Boolean) as string[];
    if (options.some((o) => norm(o) === target)) return a.id;
  }
  return null;
}

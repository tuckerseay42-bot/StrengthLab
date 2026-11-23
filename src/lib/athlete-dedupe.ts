import { normalize, splitFullName } from "@/lib/name-match";

/**
 * Bulk duplicate clean-up by FIRST name + LAST name.
 *
 * Two athletes are "the same kid" here when their first name and last name match
 * (case, punctuation and Jr/Sr ignored), using the first/last name fields and
 * falling back to splitting the old single "name" when those are empty. Two
 * records with the same name are NOT merged automatically when they clearly
 * are different people: both have a student ID and the IDs differ, or both have
 * a graduation year and the years differ. Those are reported for a hand review.
 */

export type DedupeAthlete = {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  student_id?: string | null;
  athlete_email?: string | null;
  graduation_year?: number | null;
  user_id?: string | null;
  created_at?: string | null;
};

export type History = { tests: number; lifts: number; attendance: number };

export function firstLastKey(a: DedupeAthlete): string | null {
  const split = splitFullName(a.name ?? "");
  const first = normalize(a.first_name || split.firstName);
  const last = normalize(a.last_name || split.lastName);
  // One-word names have nothing to compare on.
  if (!first || !last) return null;
  if (!a.first_name && !a.last_name && !(a.name ?? "").trim().includes(" ")) return null;
  return `${first}|${last}`;
}

const idOf = (a: DedupeAthlete) => (a.student_id ?? "").trim().toLowerCase();

/** True when these two records cannot be the same kid. */
export function conflicting(a: DedupeAthlete, b: DedupeAthlete): boolean {
  if (idOf(a) && idOf(b) && idOf(a) !== idOf(b)) return true;
  if (
    a.graduation_year != null &&
    b.graduation_year != null &&
    a.graduation_year !== b.graduation_year
  ) {
    return true;
  }
  return false;
}

const total = (h: History | undefined) => (h ? h.tests + h.lifts + h.attendance : 0);

/**
 * The record to keep: the one with the most history, then one linked to a login,
 * then one with a student ID, then one with an email, then the oldest.
 */
export function pickKeeper<T extends DedupeAthlete>(
  members: T[],
  history: Map<string, History>,
): T {
  const score = (a: T) => [
    total(history.get(a.id)),
    a.user_id ? 1 : 0,
    idOf(a) ? 1 : 0,
    (a.athlete_email ?? "").trim() ? 1 : 0,
  ];
  return [...members].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);
  })[0];
}

export type MergePlan<T> = { key: string; keep: T; drop: T[] };
export type ReviewGroup<T> = { key: string; members: T[] };

export function planFirstLastMerges<T extends DedupeAthlete>(
  athletes: T[],
  history: Map<string, History>,
): { merges: MergePlan<T>[]; needsReview: ReviewGroup<T>[] } {
  const buckets = new Map<string, T[]>();
  for (const a of athletes) {
    const k = firstLastKey(a);
    if (!k) continue;
    const list = buckets.get(k);
    if (list) list.push(a);
    else buckets.set(k, [a]);
  }

  const merges: MergePlan<T>[] = [];
  const needsReview: ReviewGroup<T>[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    // Split the same-name records into clusters whose members could all be one kid.
    const clusters: T[][] = [];
    for (const m of members) {
      const home = clusters.find((c) => c.every((o) => !conflicting(o, m)));
      if (home) home.push(m);
      else clusters.push([m]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      const keep = pickKeeper(c, history);
      merges.push({ key, keep, drop: c.filter((m) => m.id !== keep.id) });
    }
    if (clusters.length > 1) needsReview.push({ key, members });
  }
  merges.sort((a, b) => a.key.localeCompare(b.key));
  return { merges, needsReview };
}

// ---------------------------------------------------------------------------
// Same LAST name, different first name: the same kid under a nickname and a legal
// name ("Mike" / "Michael", "Bo" / "Beauregard"). These are offered for the coach to
// decide, never merged automatically, because brothers and sisters share a last name.
// ---------------------------------------------------------------------------

const NICKNAME_SETS: string[][] = [
  ["william", "will", "bill", "billy", "willie", "liam"],
  ["michael", "mike", "mikey", "mick"],
  ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["richard", "rick", "rich", "ricky", "dick"],
  ["james", "jim", "jimmy", "jamie", "jay"],
  ["john", "jack", "johnny", "jon", "jonny"],
  ["joseph", "joe", "joey"],
  ["daniel", "dan", "danny", "dj"],
  ["david", "dave", "davey"],
  ["anthony", "tony", "ant"],
  ["christopher", "chris", "topher"],
  ["matthew", "matt", "matty"],
  ["nicholas", "nick", "nicky", "nico"],
  ["alexander", "alex", "xander", "lex"],
  ["benjamin", "ben", "benny", "benji"],
  ["samuel", "sam", "sammy"],
  ["thomas", "tom", "tommy"],
  ["jacob", "jake", "jakob"],
  ["zachary", "zach", "zack", "zac"],
  ["elijah", "eli", "lijah"],
  ["jeremiah", "jeremy", "jj"],
  ["timothy", "tim", "timmy"],
  ["patrick", "pat", "paddy"],
  ["andrew", "andy", "drew"],
  ["edward", "ed", "eddie", "ted", "teddy"],
  ["charles", "charlie", "chuck", "chaz"],
  ["steven", "stephen", "steve"],
  ["joshua", "josh"],
  ["jonathan", "jon", "jonny", "nathan", "nate"],
  ["nathaniel", "nate", "nathan"],
  ["gabriel", "gabe"],
  ["isaiah", "zay"],
  ["abraham", "abreham", "abe"],
  ["muhammad", "mohammed", "mohammad", "mo"],
  ["francisco", "frank", "paco", "pancho", "cisco"],
  ["jose", "pepe", "joe"],
  ["jesus", "chuy"],
  ["guillermo", "memo", "willy", "will"],
  ["eduardo", "lalo", "eddie", "ed"],
  ["enrique", "kike", "henry"],
  ["miguel", "mike", "mikey"],
  ["roberto", "beto", "bobby"],
  ["fernando", "nando", "fer"],
  ["javier", "javi"],
  ["rafael", "rafa", "ralph"],
  ["alejandro", "alex", "alejo"],
  ["ricardo", "rick", "ricky"],
  ["antonio", "tony", "toni"],
  ["christian", "chris", "kit"],
  ["dominic", "dom", "nick"],
  ["jeffrey", "jeff", "jeffery"],
  ["gregory", "greg"],
  ["jordan", "jordy"],
  ["terrance", "terrence", "terry", "t"],
];
const NICKNAME_GROUPS = new Map<string, Set<number>>();
NICKNAME_SETS.forEach((set, i) => {
  for (const n of set) {
    const g = NICKNAME_GROUPS.get(n) ?? new Set<number>();
    g.add(i);
    NICKNAME_GROUPS.set(n, g);
  }
});

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** True when two first names could be the same person: a nickname pair, a short form, or a typo. */
export function firstNamesRelated(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const gx = NICKNAME_GROUPS.get(x);
  const gy = NICKNAME_GROUPS.get(y);
  if (gx && gy && [...gx].some((g) => gy.has(g))) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 2 && long.startsWith(short)) return true; // Mike / Michael-style short forms
  if (short.length <= 3 && short[0] === long[0]) return true; // DJ / Daniel, Bo / Beau
  return lev(x, y) <= 2 && x[0] === y[0];
}

/** Last names count as the same when they match, differ by one typo, or share a long word ("Garcia" / "Garcia Lopez"). */
export function lastNamesSimilar(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 5 && lev(x, y) <= 1) return true;
  const tx = x.split(" ").filter((t) => t.length >= 4);
  const ty = new Set(y.split(" ").filter((t) => t.length >= 4));
  return tx.some((t) => ty.has(t));
}

type CandidateAthlete = DedupeAthlete & {
  preferred_name?: string | null;
  grade?: number | null;
  team_id?: string | null;
  sport?: string | null;
};

const lastOf = (a: CandidateAthlete) => a.last_name || splitFullName(a.name ?? "").lastName;
const firstOf = (a: CandidateAthlete) => a.first_name || splitFullName(a.name ?? "").firstName;

/** Why two same-last-name athletes might be one kid. Null when they clearly are not (or nothing points that way). */
export function nicknameCandidateReasons(
  a: CandidateAthlete,
  b: CandidateAthlete,
): string[] | null {
  if (!lastNamesSimilar(lastOf(a), lastOf(b))) return null;
  if (conflicting(a, b)) return null;
  // Both have a grade and they differ (and no graduation year to settle it): brothers or sisters.
  if (
    a.graduation_year == null &&
    b.graduation_year == null &&
    a.grade != null &&
    b.grade != null &&
    a.grade !== b.grade
  ) {
    return null;
  }
  const reasons: string[] = [];
  const firstsA = [firstOf(a), a.preferred_name].filter((s): s is string => !!s);
  const firstsB = [firstOf(b), b.preferred_name].filter((s): s is string => !!s);
  const related = firstsA.some((x) => firstsB.some((y) => firstNamesRelated(x, y)));
  if (related) reasons.push("First names look related");
  const sameYear = a.graduation_year != null && a.graduation_year === b.graduation_year;
  const sameGrade = a.grade != null && a.grade === b.grade;
  if (sameYear) reasons.push("Same graduation year");
  else if (sameGrade) reasons.push("Same grade");
  const sameTeam = !!a.team_id && a.team_id === b.team_id;
  const sameSport = !!a.sport && a.sport === b.sport;
  if (sameTeam) reasons.push("Same team");
  else if (sameSport) reasons.push("Same sport");
  const sameId = !!idOf(a) && idOf(a) === idOf(b);
  if (sameId) reasons.push("Same student ID");
  const emailA = (a.athlete_email ?? "").trim().toLowerCase();
  const sameEmail = !!emailA && emailA === (b.athlete_email ?? "").trim().toLowerCase();
  if (sameEmail) reasons.push("Same email");
  const qualifies =
    sameId || sameEmail || related || ((sameYear || sameGrade) && (sameTeam || sameSport));
  return qualifies ? reasons : null;
}

export type NicknameGroup<T> = { key: string; members: T[]; hint: string };

/**
 * Groups athletes who share a (similar) last name and look like one kid under two first
 * names. Meant for a "same kid?" question to the coach, so it is deliberately generous.
 */
export function findNicknameGroups<T extends CandidateAthlete>(athletes: T[]): NicknameGroup<T>[] {
  const parent = new Map<string, string>(athletes.map((a) => [a.id, a.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const reasonsByRoot = new Map<string, Set<string>>();
  const pairReasons: Array<[string, string, string[]]> = [];

  // Bucket by the first 3 letters of the last name so a big roster is not compared all-pairs.
  const buckets = new Map<string, T[]>();
  for (const a of athletes) {
    const l = normalize(lastOf(a));
    if (!l) continue;
    const k = l.slice(0, 3);
    const list = buckets.get(k);
    if (list) list.push(a);
    else buckets.set(k, [a]);
  }
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const r = nicknameCandidateReasons(list[i], list[j]);
        if (!r) continue;
        pairReasons.push([list[i].id, list[j].id, r]);
        parent.set(find(list[i].id), find(list[j].id));
      }
    }
  }
  for (const [a, , r] of pairReasons) {
    const root = find(a);
    const set = reasonsByRoot.get(root) ?? new Set<string>();
    r.forEach((x) => set.add(x));
    reasonsByRoot.set(root, set);
  }
  const comps = new Map<string, T[]>();
  for (const a of athletes) {
    if (!reasonsByRoot.has(find(a.id))) continue;
    const list = comps.get(find(a.id)) ?? [];
    list.push(a);
    comps.set(find(a.id), list);
  }
  return [...comps.entries()]
    .filter(([, m]) => m.length > 1)
    .map(([root, members]) => ({
      key: `same_last:${[...members.map((m) => m.id)].sort().join("|")}`,
      members,
      hint: [...(reasonsByRoot.get(root) ?? [])].join(" · "),
    }));
}

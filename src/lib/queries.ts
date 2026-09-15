import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getActiveOrgId } from "@/hooks/use-active-org";

// Super-admin org scoping: when an active org is selected in the switcher,
// scope org-owned reads to that org. Non-super-admin users are already
// scoped by RLS, so the extra .eq is a harmless no-op for them.
function scoped<T extends { eq: (col: string, v: string) => T }>(q: T): T {
  const orgId = getActiveOrgId();
  return orgId ? q.eq("organization_id", orgId) : q;
}

/**
 * The Data API caps a single response at 1000 rows. Tables like lifts grow well
 * past that, so page through until a short page comes back.
 */
const PAGE = 1000;
async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}


export type Athlete = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  student_id: string | null;
  graduation_year: number | null;
  height_in: number | null;
  parent_email: string | null;
  athlete_email: string | null;
  photo_url: string | null;
  status: string;
  team_id: string | null;
  grade: number | null;
  sport: string | null;
  sport_fall: string | null;
  sport_winter: string | null;
  sport_spring: string | null;
  position: string | null;
  bodyweight: number | null;
  notes: string | null;
  created_at: string;
  program_id: string | null;
  program_start_date: string | null;
  join_token: string;
  user_id: string | null;
  gender: string | null;
  organization_id: string;
  class_period: string | null;
  training_group: string | null;
  tags: string[];
};
export type Program = {
  id: string; name: string; description: string | null;
  team_id: string | null; weeks: number | null;
  created_at: string; updated_at: string; organization_id: string;
};
export type ProgramWorkout = {
  id: string; program_id: string; workout_id: string;
  week: number; day: number; position: number; created_at: string;
};
export type TestRow = {
  id: string; athlete_id: string; test_type: string; value: number;
  unit: string | null; test_date: string; notes: string | null;
};
export type LiftRow = {
  id: string; athlete_id: string; exercise: string; load: number | null;
  sets: number | null; reps: number | null; velocity: number | null;
  time_seconds: number | null; distance_in: number | null;
  lift_date: string; notes: string | null;
};

export type AttendanceRow = {
  id: string; athlete_id: string; session_date: string; present: boolean; notes: string | null;
  updated_at?: string | null; created_at?: string | null;
};

export type Team = {
  id: string; name: string; sport: string | null; season: string | null;
  color: string | null; qr_token: string; notes: string | null;
  archived_at: string | null; created_at: string; organization_id: string;
};
export type Registration = {
  id: string; team_id: string;
  first_name: string; last_name: string; preferred_name: string | null;
  student_id: string | null; grade: number | null; sport: string | null;
  position: string | null; graduation_year: number | null;
  height_in: number | null; weight_lb: number | null;
  parent_email: string | null; athlete_email: string | null;
  status: string; reviewed_at: string | null; created_at: string;
};
export type Exercise = {
  id: string; name: string; category: string | null; equipment: string | null;
  primary_muscles: string[] | null;
  video_url: string | null; image_url: string | null; is_custom: boolean;
  measurement_type: "load" | "seconds" | "inches" | "reps";
  is_metric: boolean;
  created_at: string; organization_id: string;
};
export type ExerciseRelationship = {
  id: string; from_exercise_id: string; to_exercise_id: string;
  ratio: number; notes: string | null; created_at: string;
};
export type MetricVariable = {
  name: string; // identifier used in the formula
  source: "athlete" | "test" | "lift";
  key: string; // athlete field, test_type, or exercise name
  agg?: "best" | "latest" | "first"; // for test/lift
};
export type CustomMetric = {
  id: string; name: string; description: string | null;
  kind: "test_value" | "bw_coefficient" | "ratio" | "lift_max" | "attendance_pct" | "improvement_pct" | "formula";
  test_type: string | null;
  numerator_test: string | null; denominator_test: string | null;
  lower_is_better: boolean; unit: string | null;
  exercise_name: string | null; since_days: number | null;
  formula: string | null;
  variables: MetricVariable[];
  measurement: "load" | "time" | "height";
  created_at: string;
};

export type Workout = {
  id: string; name: string; description: string | null;
  team_id: string | null; notes: string | null;
  created_at: string; updated_at: string; organization_id: string;
};
export type WorkoutBlock = {
  id: string; workout_id: string; name: string; position: number; notes: string | null; created_at: string;
};
export type WorkoutExercise = {
  id: string; workout_id: string; block_id: string | null;
  exercise_id: string | null; exercise_name: string; position: number;
  sets: number | null; reps: string | null; load: number | null;
  percent_of_exercise_id: string | null; percent: number | null;
  tempo: string | null; rest_seconds: number | null; notes: string | null;
  target_velocity_min: number | null; target_velocity_max: number | null;
  superset_group: string | null;
  created_at: string;
};
export type WorkoutSet = {
  id: string; workout_exercise_id: string; position: number;
  sets: number | null; reps: string | null;
  load: number | null; percent: number | null;
  percent_of_exercise_id: string | null;
  rm_reps: number | null;
  target_velocity_min: number | null; target_velocity_max: number | null;
  time_seconds: number | null; distance_in: number | null;
  notes: string | null; created_at: string;
};
export type RepMax = {
  id: string; athlete_id: string; exercise_id: string | null;
  exercise_name: string; reps: number; load: number;
  tested_at: string; notes: string | null; created_at: string;
};
export type WorkoutAssignment = {
  id: string; workout_id: string;
  athlete_id: string | null; team_id: string | null;
  scheduled_date: string; status: string; notes: string | null; created_at: string;
};
export type Leaderboard = {
  id: string; name: string; metric_id: string;
  team_id: string | null; sport: string | null;
  grade: number | null; position: string | null;
  gender: string | null;
  row_limit: number;
  since_days: number | null;
  date_from: string | null; date_to: string | null;
  created_at: string;
};

export const athletesQO = queryOptions({
  queryKey: ["athletes"],
  queryFn: (): Promise<Athlete[]> =>
    fetchAll<Athlete>(() => scoped(supabase.from("athletes").select("*")).order("name").order("id")),
});

export const testsQO = queryOptions({
  queryKey: ["tests"],
  queryFn: (): Promise<TestRow[]> =>
    fetchAll<TestRow>(() =>
      scoped(supabase.from("tests").select("*")).order("test_date", { ascending: false }).order("id"),
    ),
});


export type TestAssignment = {
  id: string;
  organization_id: string;
  team_id: string | null;
  athlete_id: string | null;
  test_type: string;
  scheduled_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export const testAssignmentsQO = queryOptions({
  queryKey: ["test_assignments"],
  queryFn: async (): Promise<TestAssignment[]> => {
    const { data, error } = await scoped(supabase
      .from("test_assignments" as never)
      .select("*"))
      .order("scheduled_date", { ascending: false });
    if (error) throw error;
    return (data ?? []) as TestAssignment[];
  },
});

export const liftsQO = queryOptions({
  queryKey: ["lifts"],
  queryFn: (): Promise<LiftRow[]> =>
    fetchAll<LiftRow>(() =>
      scoped(supabase.from("lifts").select("*")).order("lift_date", { ascending: false }).order("id"),
    ),
});

export type LiftSet = {
  id: string; lift_id: string; position: number;
  load: number | null; reps: number | null; velocity: number | null;
  notes: string | null; created_at: string;
};

export const liftSetsQO = queryOptions({
  queryKey: ["lift_sets"],
  queryFn: (): Promise<LiftSet[]> =>
    fetchAll<LiftSet>(() => supabase.from("lift_sets").select("*").order("position").order("id")),
});


export const attendanceQO = queryOptions({
  queryKey: ["attendance"],
  queryFn: async (): Promise<AttendanceRow[]> => {
    const { data, error } = await scoped(supabase.from("attendance").select("*")).order("session_date", { ascending: false });
    if (error) throw error;
    return (data ?? []) as AttendanceRow[];
  },
});

export const teamsQO = queryOptions({
  queryKey: ["teams"],
  queryFn: async (): Promise<Team[]> => {
    const { data, error } = await scoped(supabase.from("teams").select("*").is("archived_at", null)).order("name");
    if (error) throw error;
    return (data ?? []) as Team[];
  },
});

export const registrationsQO = queryOptions({
  queryKey: ["registrations"],
  queryFn: async (): Promise<Registration[]> => {
    const { data, error } = await scoped(supabase.from("registrations").select("*")).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Registration[];
  },
});

export type AthleteTeam = { athlete_id: string; team_id: string; season: string | null };
export const athleteTeamsQO = queryOptions({
  queryKey: ["athlete_teams"],
  queryFn: async (): Promise<AthleteTeam[]> => {
    const { data, error } = await supabase.from("athlete_teams").select("athlete_id, team_id, season");
    if (error) throw error;
    return (data ?? []) as AthleteTeam[];
  },
});


export const exercisesQO = queryOptions({
  queryKey: ["exercises"],
  queryFn: async (): Promise<Exercise[]> => {
    const { data, error } = await scoped(supabase.from("exercises").select("*")).order("name");
    if (error) throw error;
    return (data ?? []) as Exercise[];
  },
});

export const exerciseRelationshipsQO = queryOptions({
  queryKey: ["exercise_relationships"],
  queryFn: async (): Promise<ExerciseRelationship[]> => {
    const { data, error } = await supabase.from("exercise_relationships").select("*");
    if (error) throw error;
    return (data ?? []) as ExerciseRelationship[];
  },
});

export const customMetricsQO = queryOptions({
  queryKey: ["custom_metrics"],
  queryFn: async (): Promise<CustomMetric[]> => {
    const { data, error } = await scoped(supabase.from("custom_metrics").select("*")).order("name");
    if (error) throw error;
    return (data ?? []) as unknown as CustomMetric[];
  },
});

export type CustomTestType = {
  id: string;
  organization_id: string;
  value: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  group_name: string;
};

export const testTypesQO = queryOptions({
  queryKey: ["test_types"],
  queryFn: async (): Promise<CustomTestType[]> => {
    const { data, error } = await scoped(supabase.from("test_types" as never).select("*")).order("label");
    if (error) throw error;
    return (data ?? []) as unknown as CustomTestType[];
  },
});

export const leaderboardsQO = queryOptions({
  queryKey: ["leaderboards"],
  queryFn: async (): Promise<Leaderboard[]> => {
    const { data, error } = await scoped(supabase.from("leaderboards").select("*")).order("name");
    if (error) throw error;
    return (data ?? []) as Leaderboard[];
  },
});

export const workoutsQO = queryOptions({
  queryKey: ["workouts"],
  queryFn: async (): Promise<Workout[]> => {
    const { data, error } = await scoped(supabase.from("workouts").select("*")).order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Workout[];
  },
});

export const workoutBlocksQO = queryOptions({
  queryKey: ["workout_blocks"],
  queryFn: async (): Promise<WorkoutBlock[]> => {
    const { data, error } = await supabase.from("workout_blocks").select("*").order("position");
    if (error) throw error;
    return (data ?? []) as WorkoutBlock[];
  },
});

export const workoutExercisesQO = queryOptions({
  queryKey: ["workout_exercises"],
  queryFn: async (): Promise<WorkoutExercise[]> => {
    const { data, error } = await supabase.from("workout_exercises").select("*").order("position");
    if (error) throw error;
    return (data ?? []) as WorkoutExercise[];
  },
});

export const workoutAssignmentsQO = queryOptions({
  queryKey: ["workout_assignments"],
  queryFn: async (): Promise<WorkoutAssignment[]> => {
    const { data, error } = await supabase.from("workout_assignments").select("*").order("scheduled_date", { ascending: false });
    if (error) throw error;
    return (data ?? []) as WorkoutAssignment[];
  },
});

export type RackSessionAthlete = {
  id: string;
  rack_session_id: string;
  athlete_id: string;
  quadrant: number;
  source_team_id: string | null;
  assigned_workout_id: string | null;
  active_workout_id: string | null;
  override_reason: "assigned" | "manual_workout" | "template" | "one_off" | "makeup";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const rackSessionAthletesQO = queryOptions({
  queryKey: ["rack_session_athletes"],
  queryFn: async (): Promise<RackSessionAthlete[]> => {
    const { data, error } = await supabase
      .from("rack_session_athletes")
      .select("*")
      .order("quadrant");
    if (error) throw error;
    return (data ?? []) as RackSessionAthlete[];
  },
});

export const workoutSetsQO = queryOptions({
  queryKey: ["workout_sets"],
  queryFn: async (): Promise<WorkoutSet[]> => {
    const { data, error } = await supabase.from("workout_sets").select("*").order("position");
    if (error) throw error;
    return (data ?? []) as WorkoutSet[];
  },
});

// Rep maxes power every %-of-1RM prescription. The rollup that turns logged
// rack sets / lifts into rep_max rows used to be triggered from the (now
// removed) Rep Max screen, so we refresh it here — idempotent, only inserts
// rows that beat what's already stored. Throttled so it runs at most once
// every 2 minutes per client.
let lastRepMaxRollup = 0;
async function refreshRepMaxRollup() {
  const now = Date.now();
  if (now - lastRepMaxRollup < 120_000) return;
  lastRepMaxRollup = now;
  try {
    await supabase.rpc("rollup_rep_maxes" as never);
  } catch {
    /* non-fatal: fall back to whatever is already stored */
  }
}

export const repMaxesQO = queryOptions({
  queryKey: ["rep_maxes"],
  queryFn: async (): Promise<RepMax[]> => {
    await refreshRepMaxRollup();
    // Thousands of rows across a roster — page through, or older athletes'
    // maxes fall off and their prescribed loads come back blank.
    return fetchAll<RepMax>(() =>
      scoped(supabase.from("rep_maxes").select("*")).order("tested_at", { ascending: false }).order("id"),
    );
  },
});



export const programsQO = queryOptions({
  queryKey: ["programs"],
  queryFn: async (): Promise<Program[]> => {
    const { data, error } = await scoped(supabase.from("programs" as never).select("*")).order("name");
    if (error) throw error;
    return (data ?? []) as unknown as Program[];
  },
});

export const programWorkoutsQO = queryOptions({
  queryKey: ["program_workouts"],
  queryFn: async (): Promise<ProgramWorkout[]> => {
    const { data, error } = await supabase.from("program_workouts" as never).select("*").order("position");
    if (error) throw error;
    return (data ?? []) as unknown as ProgramWorkout[];
  },
});

// ---------- Program hierarchy (phases → cycles → sessions) ----------

export type ProgramPhase = {
  id: string; program_id: string; organization_id: string;
  name: string; goal: string | null; color: string | null;
  position: number; start_date: string | null; end_date: string | null;
  created_at: string; updated_at: string;
};
export type ProgramCycle = {
  id: string; phase_id: string; program_id: string; organization_id: string;
  name: string; weeks: number; intensity: string | null; volume: string | null;
  focus: string | null; position: number; start_date: string | null;
  created_at: string; updated_at: string;
};
export type ProgramSession = {
  id: string; cycle_id: string; phase_id: string; program_id: string; organization_id: string;
  workout_id: string | null; name: string;
  week: number; day: number; position: number;
  scheduled_date: string | null; notes: string | null;
  created_at: string; updated_at: string;
};
export type ProgramVersion = {
  id: string; program_id: string; organization_id: string;
  label: string; notes: string | null; snapshot: unknown;
  created_by: string | null; created_at: string; version_number: number;
};

export const programPhasesQO = (programId: string) => queryOptions({
  queryKey: ["program_phases", programId],
  queryFn: async (): Promise<ProgramPhase[]> => {
    const { data, error } = await supabase.from("program_phases" as never)
      .select("*").eq("program_id", programId).order("position");
    if (error) throw error;
    return (data ?? []) as unknown as ProgramPhase[];
  },
});
export const programCyclesQO = (programId: string) => queryOptions({
  queryKey: ["program_cycles", programId],
  queryFn: async (): Promise<ProgramCycle[]> => {
    const { data, error } = await supabase.from("program_cycles" as never)
      .select("*").eq("program_id", programId).order("position");
    if (error) throw error;
    return (data ?? []) as unknown as ProgramCycle[];
  },
});
export const programSessionsQO = (programId: string) => queryOptions({
  queryKey: ["program_sessions", programId],
  queryFn: async (): Promise<ProgramSession[]> => {
    const { data, error } = await supabase.from("program_sessions" as never)
      .select("*").eq("program_id", programId).order("week").order("day").order("position");
    if (error) throw error;
    return (data ?? []) as unknown as ProgramSession[];
  },
});
export const programVersionsQO = (programId: string) => queryOptions({
  queryKey: ["program_versions", programId],
  queryFn: async (): Promise<ProgramVersion[]> => {
    const { data, error } = await supabase.from("program_versions" as never)
      .select("*").eq("program_id", programId).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ProgramVersion[];
  },
});



export function athleteDisplayName(a: Pick<Athlete, "name" | "first_name" | "last_name" | "preferred_name">) {
  if (a.preferred_name && a.last_name) return `${a.preferred_name} ${a.last_name}`;
  if (a.first_name && a.last_name) return `${a.first_name} ${a.last_name}`;
  return a.name;
}

// ---------- Configurable dashboards (spider + KPI cards) ----------

export type SpiderAssignment = {
  sport?: string | null;
  team_id?: string | null;
  position?: string | null;
  training_group?: string | null;
};

export type SpiderNormalizationMethod =
  | "percentile"
  | "pb_percent"
  | "goal"
  | "threshold";
export type SpiderComparisonGroup =
  | "team" | "sport" | "grade" | "position" | "org" | "custom";
export type SpiderDateRule = "latest" | "season" | "career" | "last_90d";

export type SpiderTemplate = {
  id: string;
  organization_id: string;
  name: string;
  is_default: boolean;
  assignment: SpiderAssignment;
  normalization_method: SpiderNormalizationMethod;
  comparison_group: SpiderComparisonGroup;
  date_rule: SpiderDateRule;
  kpi_config: {
    kpis?: string[];              // ordered list of kpi keys
    sparkline?: boolean;
    highlight_pb?: boolean;
  };
  options: {
    show_badges?: boolean;
    show_progress?: boolean;
    show_prs?: boolean;
  };
  created_at: string;
  updated_at: string;
};

export type SpiderMetric = {
  id: string;
  template_id: string;
  position: number;
  metric_key: string;            // "test:sprint_40y" or "metric:<custom_metric_id>"
  display_label: string | null;
  hide_if_missing: boolean;
};

export const spiderTemplatesQO = queryOptions({
  queryKey: ["spider_graph_templates"],
  queryFn: async (): Promise<SpiderTemplate[]> => {
    const { data, error } = await scoped(supabase
      .from("spider_graph_templates" as never)
      .select("*"))
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw error;
    return (data ?? []) as unknown as SpiderTemplate[];
  },
});

export const spiderMetricsQO = queryOptions({
  queryKey: ["spider_graph_metrics"],
  queryFn: async (): Promise<SpiderMetric[]> => {
    const { data, error } = await supabase
      .from("spider_graph_metrics" as never)
      .select("*")
      .order("position");
    if (error) throw error;
    return (data ?? []) as unknown as SpiderMetric[];
  },
});


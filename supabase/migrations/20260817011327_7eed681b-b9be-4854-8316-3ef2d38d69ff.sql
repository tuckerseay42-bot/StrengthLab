
create or replace function public.athlete_can_read_workout(_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workout_assignments wa
    where wa.workout_id = _workout_id
      and (
        public.is_self_athlete(wa.athlete_id)
        or (wa.team_id is not null and exists (
              select 1 from public.athletes a
              where a.user_id = auth.uid()
                and (a.team_id = wa.team_id
                     or exists (select 1 from public.athlete_teams at
                                where at.athlete_id = a.id and at.team_id = wa.team_id))
        ))
      )
  )
  or exists (
    select 1 from public.rack_session_athletes rsa
    where public.is_self_athlete(rsa.athlete_id)
      and _workout_id in (rsa.assigned_workout_id, rsa.active_workout_id)
  )
  or exists (
    select 1
    from public.program_sessions ps
    join public.athletes a on a.program_id = ps.program_id
    where ps.workout_id = _workout_id and a.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.program_workouts pw
    join public.athletes a on a.program_id = pw.program_id
    where pw.workout_id = _workout_id and a.user_id = auth.uid()
  );
$$;

drop policy if exists "athletes read assigned workout_assignments" on public.workout_assignments;
create policy "athletes read assigned workout_assignments"
on public.workout_assignments for select to authenticated
using (
  public.is_self_athlete(athlete_id)
  or (team_id is not null and exists (
        select 1 from public.athletes a
        where a.user_id = auth.uid()
          and (a.team_id = workout_assignments.team_id
               or exists (select 1 from public.athlete_teams at
                          where at.athlete_id = a.id and at.team_id = workout_assignments.team_id))
  ))
);

drop policy if exists "athletes read assigned workouts" on public.workouts;
create policy "athletes read assigned workouts"
on public.workouts for select to authenticated
using (public.athlete_can_read_workout(id));

drop policy if exists "athletes read assigned workout_exercises" on public.workout_exercises;
create policy "athletes read assigned workout_exercises"
on public.workout_exercises for select to authenticated
using (public.athlete_can_read_workout(workout_id));

drop policy if exists "athletes read assigned workout_sets" on public.workout_sets;
create policy "athletes read assigned workout_sets"
on public.workout_sets for select to authenticated
using (exists (
  select 1 from public.workout_exercises we
  where we.id = workout_sets.workout_exercise_id
    and public.athlete_can_read_workout(we.workout_id)
));

drop policy if exists "athletes read own program_sessions" on public.program_sessions;
create policy "athletes read own program_sessions"
on public.program_sessions for select to authenticated
using (
  workout_id is not null and public.athlete_can_read_workout(workout_id)
);

drop policy if exists "athletes read own program_workouts" on public.program_workouts;
create policy "athletes read own program_workouts"
on public.program_workouts for select to authenticated
using (public.athlete_can_read_workout(workout_id));

drop policy if exists "athletes read own team memberships teams" on public.teams;
create policy "athletes read own team memberships teams"
on public.teams for select to authenticated
using (exists (
  select 1 from public.athletes a
  where a.user_id = auth.uid()
    and (a.team_id = teams.id
         or exists (select 1 from public.athlete_teams at where at.athlete_id = a.id and at.team_id = teams.id))
));

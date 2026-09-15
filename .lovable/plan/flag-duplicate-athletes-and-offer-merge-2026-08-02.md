# Flag duplicate athletes and offer merge

Add duplicate detection to the Athletes tab so coaches can spot the same athlete entered twice and merge the records into one, keeping all history.

## What the coach sees

- A "Possible duplicates" banner at the top of the roster when matches are found: "3 possible duplicate athletes found — Review".
- Reviewing opens a dialog listing each duplicate group (e.g. "Jake Miller x2") with each record's team, grade, email, student ID, and counts of tests / lifts / attendance so it is clear which one has the history.
- For each group: pick which record to keep, then "Merge" — with a confirmation step explaining the other record's data moves to the kept athlete and the duplicate is removed.
- Also a "Not a duplicate" dismiss per group so twins or genuine same-name athletes stop being flagged (stored locally in the browser).
- Duplicate rows also get a small "Duplicate" chip in the roster table.

## How duplicates are detected (client-side, on existing data)

Grouped within the active organization, flagged when any of these match:
- Normalized full name (case/whitespace/punctuation insensitive) — same as the existing add-athlete duplicate check.
- Same non-empty student ID.
- Same non-empty athlete email.
Archived athletes are included but labelled, since duplicates are often "one archived, one re-added".

## Merging

A new security-definer database function `merge_athletes(_keep uuid, _drop uuid)` runs the whole merge in one transaction:
- Verifies both athletes exist and belong to the caller's organization.
- Repoints every child row from the dropped athlete to the kept one: tests, lifts, attendance, rep_maxes, athlete_badges, athlete_teams, athlete_kpi_pins, gps_sessions, test_assignments, workout_assignments, rack_session_athletes, rack_set_logs, rack_athlete_exercise_overrides, rack_sessions.active_athlete_id, athlete_pin_hashes.
- Fills blank fields on the kept record from the dropped one (email, student ID, grade, bodyweight, height, DOB, photo, program, class period, notes appended) — never overwrites existing values.
- De-duplicates rows that would collide on a unique key (attendance same date, athlete_teams same team, badges, kpi pins): keeps the kept athlete's row and drops the other.
- Deletes the dropped athlete row and returns the kept id.

The UI calls this through a server function guarded by `requireSupabaseAuth`, then refreshes the athlete, tests, lifts and attendance caches and shows a success toast.

## Technical notes

- New migration: `merge_athletes` function, `SECURITY DEFINER`, `search_path = public`, org check via `is_org_member`, plus `GRANT EXECUTE` to `authenticated`.
- New `src/lib/athlete-merge.functions.ts` wrapping the RPC.
- Duplicate grouping helper added to `src/lib/validation.ts` (`findAthleteDuplicateGroups`), reusing the existing name normalization.
- New `src/components/athlete-duplicates.tsx` for the banner + review/merge dialog; `src/routes/athletes.tsx` renders it above the roster.
- Dismissed groups stored in `localStorage` keyed by the pair of athlete ids.

# End-to-End Flows

Living reference for the four flows I audited during Stage A. Update this
whenever the underlying route or DB behavior changes.

---

## 1. Athlete scans QR → PIN → logs a set in Training View

**Route path:** `/training-view/check-in` → `/training-view/session`

1. Coach opens `/athlete-qr` and prints a team QR code. The QR encodes a URL
   for `/training-view/check-in?team=<team_id>` (or generic if no team).
2. Athlete scans it on the wall tablet. `training-view.check-in.tsx` runs.
   - The route sets `sessionStorage.setItem("sl.kiosk", "1")` so
     `src/routes/__root.tsx` treats this device as kiosk mode and blocks
     navigation to the coach app.
3. Athlete identifies themselves (Email / Student ID / manual pick).
   `getAthleteByEmailOrId` server call looks the athlete up scoped by team.
4. Athlete enters their PIN. Client calls the `verifyAthletePin` server
   function (`src/lib/athlete-pin.functions.ts`). That function:
   - Reads the row from `athlete_pin_hashes` (RLS blocks direct client reads;
     writes are blocked by a `RESTRICTIVE FOR ALL` policy).
   - Compares the hash, increments `failed_attempts`, and locks the athlete
     after N failures.
   - On success, sets a short-lived session token in sessionStorage.
5. `/training-view/session` loads. It resolves the athlete's assigned workout
   via `resolveAthleteWorkout` (workout_assignments → program_sessions →
   fallback to team default).
6. Athlete taps a set pill. `training-view.session.tsx` upserts into
   `rack_set_logs` scoped by `rack_session_id + athlete_id +
   workout_exercise_id + set_position`. `organization_id` is derived from
   the athlete row, not from the client form.
7. On workout finish the client inserts one row into `attendance` (also
   scoped by `athlete.organization_id`) and clears the kiosk token.

**Gaps flagged in Stage A (now fixed):**
- Previously, `rack_sessions` insert relied on `DEFAULT current_org_id()`,
  which returns NULL for a super-admin without an `organization_members`
  row. The insert now passes `organization_id` explicitly from the
  athlete/team.
- Raw Postgres errors leaked into the athlete's toast. All error paths now
  go through `toUserMessage()` and show a plain-language message.

**Remaining edge cases to monitor:**
- If a coach deletes a team while an athlete is mid-session, the resolver
  returns null. The UI should show "No workout assigned for today" instead
  of a raw FK error.
- The kiosk session token has no server-side revocation. If a tablet walks
  away, sessionStorage persists until the tab closes.

---

## 2. Coach assigns a workout to a team → athlete completes it

**Route path:** `/programming` (assignment) → `/athlete/today` or
`/training-view/session` (completion)

1. Coach picks a workout in `programming.tsx` and opens the Assignments
   panel (`workout-editor.tsx`).
2. `AssignmentsPanel.add` inserts one row into `workout_assignments` with
   `{ workout_id, team_id | athlete_id, scheduled_date, organization_id }`.
   The organization_id now comes from `getScopedOrgId()` (was previously
   relying on nothing — the column was nullable so nothing failed loudly,
   but the row was orphaned from org scoping).
3. `resolveAthleteWorkout` picks up the assignment for every athlete on the
   team on the scheduled date.
4. When the athlete opens `/athlete/today` (or the kiosk session), the
   assigned workout renders and set pills go into `rack_set_logs`. The
   `trg_rack_log_to_lift` trigger promotes completed sets into `lifts`.
5. When the athlete finishes, the completion trigger flips
   `workout_assignments.status` to `completed` (SQL-side).

**Gaps flagged in Stage A (now fixed):**
- Assignment insert did not pass `organization_id`, so rows created by a
  super-admin without a membership row were orphaned from org scoping and
  invisible to teammates via RLS.
- Assignment errors surfaced as `null value in column…` toasts.

**Remaining edge cases:**
- If a workout is unassigned mid-day, any in-progress `rack_set_logs`
  remain. That's intentional (audit trail) but the coach display doesn't
  currently indicate the assignment was pulled.

---

## 3. Coach logs a test result for an athlete (the flow that just broke)

**Route path:** `/tests`

1. Coach opens `/tests` and clicks "Log a test".
2. `tests.tsx > save` builds a payload from the form: `{ athlete_id,
   test_type, value, unit, test_date, notes }`.
3. Insert into `tests`. `organization_id` is now supplied explicitly from
   `getScopedOrgId()`. Previously the code trusted the
   `DEFAULT current_org_id()` on the column, which returns NULL when the
   signed-in user has no `organization_members` row (super-admins, first
   owner). That's the "null value in column organization_id violates
   not-null constraint" error you hit.
4. Row lands. `athlete_id` FK is validated. `updated_at` trigger sets the
   timestamp. RLS lets any org member (or admin) read.
5. `useQuery(testsQO)` invalidates and the row appears in the list.

**Gaps flagged in Stage A (now fixed):**
- The insert relied on the column default. Fixed: `organization_id` is
  pulled from context on every insert. Same fix applied to
  `athlete.tsx`, `predicted-height-tool.tsx`, and the assignment-driven
  `logAttempts` insert.
- Raw error toast replaced with `toUserMessage()` — the coach now sees
  "No active organization…" or "This already exists…" instead of the SQL.

**Remaining edge cases:**
- Duplicate test entries for the same athlete + type + date are still
  allowed (no unique constraint). We deliberately allow multiple attempts
  per day.

---

## 4. Coach archives an athlete → later restores them

**Route path:** `/athletes` (list + edit dialog)

1. Coach opens an athlete in `/athletes` and clicks Archive. The client
   updates `athletes` with `{ archived_at: now() }`. `is_active` is not
   used anymore — the Stage A hardening standardized on `archived_at`.
2. Queries in `queries.ts` filter `archived_at IS NULL` by default. The
   athlete disappears from rosters, training view, leaderboards, and
   reports.
3. Historical rows (lifts, tests, rack_set_logs, attendance) remain
   intact. FK is `ON DELETE RESTRICT` so an archived athlete cannot be
   hard-deleted while history exists.
4. Restore: coach opens the archived list, clicks Restore. Client updates
   `{ archived_at: null }`. The athlete rejoins every roster and their
   historical data reappears in aggregates.

**Gaps flagged in Stage A:**
- Some list queries were not filtering on `archived_at`. Fixed as part of
  the schema audit (Stage A).
- The archive/restore mutation did not report errors clearly if RLS
  blocked the write (e.g. coach in a different org). Now surfaces
  "You don't have permission to do that." via `toUserMessage()`.

**Remaining edge cases:**
- Rack sessions from before the archive still list the athlete's name.
  That's intentional — historical records reflect who was actually there.
- If an archived athlete's team is also deleted, `team_id` goes to NULL
  (ON DELETE SET NULL). Restoring the athlete doesn't recreate the team;
  the coach must re-assign them.

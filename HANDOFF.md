# Where We Left Off

## Where Things Stand
- 2026-11-04: Rebuilt all weight tracking using Cody Hughes's method (my-idea.md has the request and decisions). All six steps are written and pushed to `claude/strengthlab-hub-system-kbgc1g` (latest `42743d3`). NOTHING IS CONFIRMED LIVE YET: it needs the Lovable sync (applies the two migrations) and then Publish.
- What exists now:
  - `weigh_ins` table (every weigh-in with its time, Eastern day stored, locked to the org's coaches plus the athlete themself). Migrations `20261104120000_weigh_ins_rebuild.sql` and `20261104130000_weight_one_door_retire_old_table.sql`. Tested on a real Postgres: `python3 supabase/tests/weigh_ins.test.py` (49 checks; needs `pip install pgserver psycopg2-binary`).
  - Weekly math: `src/lib/weigh-ins.ts` (+ `npm test`, 22 tests). Monday-Sunday weeks, a day's weigh-ins averaged, a week counts with 3+ different days, change vs last counted week, net change, two-date change. Up is green, down is red, no goals.
  - Team Grid: `/weight` (Tracking > Weight). Profile weight card: `src/components/athlete-weight-card.tsx` on the athlete page. Attendance, KPI dashboard and report metrics read `weigh_ins`.
  - Kiosks: type-a-name `/checkin/<code>` and the two PIN kiosks show the athlete their own result (`src/components/weigh-in-feedback.tsx`) for about 9 seconds. Weight goes through `kiosk_check_in` / `log_weigh_in` (range check, 30% typo prompt).
  - Attendance board and list: a scale button on each athlete logs a weigh-in (same `log_weigh_in` door, typo question included) and marks them present; tapping the tile still only flips present/absent.
  - Any change to `athletes.bodyweight` (profile edit, roster import) now also records a weigh-in (database trigger). `athletes.bodyweight` always equals the latest weigh-in, so strength-vs-bodyweight scores, spider charts and the print report are untouched.
  - Old `bodyweight_logs` is retired: read-only for coaches, no anonymous access.
- Earlier this stretch (already pushed): testing sheet styling, program team reassignment, auto-group fix, live set-entry typo prompt, "Email athletes", Display board, review-gating data fix (migration `20261103120000_...`, also needs the sync).

## What We Decided and Why
- Weight lives inside Strength Lab Hub (not a separate tracker). Cody's "this computer only / file in a folder" lines were for his practice tracker.
- Same-day weigh-ins are all kept; each day counts once in the weekly average. No goals: gain is green, loss is red.
- Athletes get immediate feedback on every kiosk, including the type-a-name one (no PIN). Tradeoff accepted: anyone at that kiosk can tap another name and see that athlete's feedback.
- Weeks are Monday-Sunday in Eastern time (`America/New_York`, fixed in the database and in `easternToday()`).
- Course files are not committed (Cody's paid material, repo syncs to GitHub/Lovable).
- "Pending" review status must never hide data. Only an explicit reject removes a set.
- Cloud sessions cannot use Bypass permissions (Auto mode, or allow rules in `.claude/settings.json`, not set up).

## What Is Next
1. Lovable sync, then Publish. Then test on the live site (see checklist below). Report anything odd.
2. After the sync is confirmed: remove the temporary "old write path" fallbacks (in `src/lib/athlete-checkin.functions.ts` and `src/routes/checkin.$token.tsx`) that exist only to survive the sync gap.
3. Also still unconfirmed from before: Training Maxes / Bench Press populating after the review-gating migration; "Email athletes" reaching kids (athletes need an email on their record); the Display board on a real iPad/TV.
4. Ideas not built: coach alerts (red-flagged logs, injuries), parent/admin reports, simpler athlete logging screen, SMS, a Data Health screen.
5. Fixed: `/athlete-login` is now on the public list (signed-out athletes were being sent to the coach login; the "Email athletes" link points there). Also fixed the root error component's type, so `npx tsc --noEmit` is now fully clean.

- Team check-in kiosk (`/checkin/<code>`) now takes a name off the list once that kid is present today (Eastern day), so the next kid can't tap it by mistake. The list also refreshes every 20 seconds so other iPads on the same link catch up. A coach brings a name back with the small undo button on a present tile (or in the list view) on the Attendance page; that sets `attendance.kiosk_reopened` for today only and does not mark the kid absent or notify a parent. Checking in again clears it. Migration `20261105120000_kiosk_hide_checked_in.sql` (needs the Lovable sync). Test: `python3 supabase/tests/kiosk_hide_checked_in.test.py` (12 checks). Not covered: the two PIN kiosks have no name list, so they are unchanged.
## Live Test Checklist (after sync + Publish)
- Tracking > Weight loads (no "isn't available yet" message). Existing history shows as weeks.
- Open any athlete (roster > name): the profile page opens and shows the Weight card.
- On a signed-out iPad open the team check-in link (Attendance page QR): find a name, type a weight, see the feedback card; try a wild number (e.g. 90 for a 185 lb kid) to see the "is that right?" prompt.
- Log two weigh-ins on one day and three different days in one week for one athlete; check the grid shows the bold average and a green/red change.
- Edit an athlete's weight in the roster form: a new weigh-in should appear on their profile.
- Check one kid in on the kiosk: their name leaves the list (also on a second iPad within 20 seconds). On the Attendance board tap the small undo icon on their tile: the name returns to the kiosk list; check in again and it leaves again.

## What Went Wrong
- Found while testing the kiosk change: the older migration `20260924180000_...` writes `position text` bare in a `RETURNS TABLE(...)`, and a fresh real Postgres rejects that (reserved word). Production evidently has it, so I did not touch that file; the new migration drops and re-creates the roster function with `"position"` quoted so it works either way.
- Prescribed weights appearing and disappearing for some kids (Nov 2026). Causes found, all fixed in the commits after `9205769`:
  1. Shared lists (workouts, workout exercises/sets, assignments, programs, exercises, attendance, athlete teams, rack members, ...) were loaded in ONE request, and the Data API silently returns at most 1000 rows. Past that, rows are dropped, and with ties in the sort (many sets at position 1) WHICH rows are dropped can differ per request, so the same screen could show a weight on one device and not on another. Fix: every list now pages with `fetchAll` (`src/lib/fetch-all.ts`) and a unique `id` tie-break. Rule going forward: never read a growing table with a plain `.select()`; use `fetchAll` or filter to one day/athlete/workout.
  2. The Training View and live page read EVERY rack assignment ever made (grows daily); now scoped to today's racks.
  3. The Training View froze rep maxes the moment they first loaded, even if that was a cached copy from an earlier visit. Now it waits for a finished load.
  4. The athlete's own workout screen filled the weight box only when it first appeared; if the rep maxes (or a "% of another lift" name) arrived a moment later, the box stayed blank. Now it shows "Getting your weights ready..." until pricing data is in, restarts the box if the prescription changes, and holds the maxes still for the workout.
  5. Printed athlete cards, rack sheets and the "Email athletes" message priced "% of another lift" sets without that lift's name, so those came out blank. Now they get the names.
  6. The Training View kiosk (`training-view.session.tsx`) did not pass the athlete's organization to the workout screen, so it always used the default 1RM formula while the athlete's own screen used the organization's. If an organization picked a different formula, the same kid could get a different weight on each screen. Now passed through.
  Browser check (mocked database, old vs new code): old code left the weight box blank even after the max arrived; new code shows "Getting your weights ready..." then the weight, and a typed value survives a refocus. Not tested: a failed rep-max request. Note: `/athlete/today` shows the Dashboard (parent route has no outlet); the workout screen is reached through the Training View.
  Tests: `npm test` (fetch-all paging, prescription pricing). Could not check the real database sizes from here; if `workout_sets` or `workout_exercises` is over 1000 rows that confirms cause 1.
- Attendance board in full screen: tapping the scale did nothing visible. Browser full screen shows only the one element, and the weigh-in box (and the pop-up messages) open on the page behind it. Fix: the box opens inside the full-screen card (`DialogContent container=`), and the result also shows as a banner inside the card. Rule: any dialog or toast opened from inside a full-screen element must be placed inside that element. Scale button is now centered on the right of each tile.
- Auto-group: wrote `override_reason: "auto-grouped"`, which the database check constraint rejects. Racks were created empty. Fix: use `"assigned"`.
- Rep maxes "no data": opening Log Review silently set unusual sets to `pending`, and the rollup and lift trigger ignored everything but `auto`/`approved`. Fix: only `rejected` is excluded.
- The `xlsx` package silently ignores cell styles on write. Fix: `exceljs`, loaded on demand (static import grew the Tests page from 32KB to 963KB).
- Prettier checked a copy outside the repo ignored the project config. Put the copy inside the repo.
- Weight history was one row per athlete per UTC day, overwritten by a second weigh-in, and readable/writable by anyone with the public key. Fix: `weigh_ins` (above).
- Found by browser testing: the athlete profile page never rendered (child of the roster route, which has no outlet) and the QR check-in links bounced signed-out iPads to login. Both fixed in `5b1a335`. Lesson: run new screens in a browser with a faked database (the side-agent harness approach) before trusting them.
- `/athlete-login` was a public page that the app's sign-in guard did not know was public, so athletes emailed the link landed on the coach login. Fixed in `__root.tsx`.
- Postgres grants new functions to everyone by default; a function meant for signed-in users must `REVOKE ... FROM PUBLIC, anon` explicitly.

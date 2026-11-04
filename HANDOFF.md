# Where We Left Off

## Where Things Stand
- 2026-11-04: Rebuilt all weight tracking using Cody Hughes's method (my-idea.md has the request and decisions). All six steps are written and pushed to `claude/strengthlab-hub-system-kbgc1g` (latest `42743d3`). NOTHING IS CONFIRMED LIVE YET: it needs the Lovable sync (applies the two migrations) and then Publish.
- What exists now:
  - `weigh_ins` table (every weigh-in with its time, Eastern day stored, locked to the org's coaches plus the athlete themself). Migrations `20261104120000_weigh_ins_rebuild.sql` and `20261104130000_weight_one_door_retire_old_table.sql`. Tested on a real Postgres: `python3 supabase/tests/weigh_ins.test.py` (49 checks; needs `pip install pgserver psycopg2-binary`).
  - Weekly math: `src/lib/weigh-ins.ts` (+ `npm test`, 22 tests). Monday-Sunday weeks, a day's weigh-ins averaged, a week counts with 3+ different days, change vs last counted week, net change, two-date change. Up is green, down is red, no goals.
  - Team Grid: `/weight` (Tracking > Weight). Profile weight card: `src/components/athlete-weight-card.tsx` on the athlete page. Attendance, KPI dashboard and report metrics read `weigh_ins`.
  - Kiosks: type-a-name `/checkin/<code>` and the two PIN kiosks show the athlete their own result (`src/components/weigh-in-feedback.tsx`) for about 9 seconds. Weight goes through `kiosk_check_in` / `log_weigh_in` (range check, 30% typo prompt).
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
5. Noticed, not fixed: `/athlete-login` is not on the public list in `src/routes/__root.tsx` (check whether signed-out athletes can reach it). `/training-view/check-in` and `/training-view/session` already were public.

## Live Test Checklist (after sync + Publish)
- Tracking > Weight loads (no "isn't available yet" message). Existing history shows as weeks.
- Open any athlete (roster > name): the profile page opens and shows the Weight card.
- On a signed-out iPad open the team check-in link (Attendance page QR): find a name, type a weight, see the feedback card; try a wild number (e.g. 90 for a 185 lb kid) to see the "is that right?" prompt.
- Log two weigh-ins on one day and three different days in one week for one athlete; check the grid shows the bold average and a green/red change.
- Edit an athlete's weight in the roster form: a new weigh-in should appear on their profile.

## What Went Wrong
- Auto-group: wrote `override_reason: "auto-grouped"`, which the database check constraint rejects. Racks were created empty. Fix: use `"assigned"`.
- Rep maxes "no data": opening Log Review silently set unusual sets to `pending`, and the rollup and lift trigger ignored everything but `auto`/`approved`. Fix: only `rejected` is excluded.
- The `xlsx` package silently ignores cell styles on write. Fix: `exceljs`, loaded on demand (static import grew the Tests page from 32KB to 963KB).
- Prettier checked a copy outside the repo ignored the project config. Put the copy inside the repo.
- Weight history was one row per athlete per UTC day, overwritten by a second weigh-in, and readable/writable by anyone with the public key. Fix: `weigh_ins` (above).
- Found by browser testing: the athlete profile page never rendered (child of the roster route, which has no outlet) and the QR check-in links bounced signed-out iPads to login. Both fixed in `5b1a335`. Lesson: run new screens in a browser with a faked database (the side-agent harness approach) before trusting them.
- Postgres grants new functions to everyone by default; a function meant for signed-in users must `REVOKE ... FROM PUBLIC, anon` explicitly.

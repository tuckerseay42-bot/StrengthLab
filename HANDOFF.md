# Where We Left Off

## Where Things Stand
- 2026-11-04: Set up the project memory files (CLAUDE.md, HANDOFF.md, my-idea.md) using Cody Hughes's Build With AI method. The "backbone restructure" is only an idea so far; nothing has been rebuilt.
- Latest pushed commit before this: `947ada2`. Branch: `claude/strengthlab-hub-system-kbgc1g`.
- Shipped this stretch (all pushed):
  - Testing sheet download is styled (exceljs, banded rows, solid borders, lazy-loaded so the Tests page stays small).
  - Program editor can reassign a program's team.
  - Auto-group on Assign Racks works (it was inserting a value the database rejected).
  - Athletes get a "double-check this weight" prompt when a logged set is 30% or more off the prescribed weight (`SetEntry`, `athlete.today.tsx`).
  - "Email athletes" button on Program Delivery sends each athlete their own set list (new route `notify-workout`, email queue already existed).
  - Display board (Training View, Display tab) shows a coach-picked team, class period, or program, and an athlete's name turns green when they finish every prescribed set.
  - Review-gating data bug fixed in a migration (see below).

## What We Decided and Why
- Course files are not committed to this repo. They are Cody's paid material and the repo syncs to GitHub and Lovable. His method is written into CLAUDE.md in my own words.
- The first course zip is a beginner workflow course, not an architecture. We do not rip out the live backbone in one shot. If we restructure, it is plank by plank, with checkpoints, and real data is never at risk.
- "Pending" review status must never hide data. It is a review-queue marker only. Only an explicit reject removes a set.
- Cloud sessions cannot use Bypass permissions. Options are Auto mode or allow rules in `.claude/settings.json` (not set up yet).

## What Is Next
- Waiting on me: more course zips (maybe Put It Online), and my answers to the questions about what is actually holding the current system back.
- IMPORTANT: migration `20261103120000_dont_gate_lift_data_on_review_status.sql` must be applied by the Lovable sync. After it syncs, check Training Maxes, Bench Press. Not confirmed yet.
- Not confirmed yet: whether "Email athletes" reaches kids (athletes need an email on their record), and the Display board on a real iPad/TV.
- Ideas not built: coach-to-coach alerts (red-flagged logs, injuries), parent/admin reports, simpler athlete logging screen, SMS (needs a new provider and phone numbers).

## What Went Wrong
- Auto-group: wrote `override_reason: "auto-grouped"`, which the database check constraint rejects. Racks were created empty. Fix: use `"assigned"`.
- Rep maxes "no data": opening Log Review silently set unusual sets to `pending`, and the rollup and lift trigger ignored everything but `auto`/`approved`. Fix: only `rejected` is excluded (migration above).
- The `xlsx` package silently ignores cell styles on write. Fix: `exceljs`, loaded on demand (static import grew the Tests page from 32KB to 963KB).
- Prettier checked a copy outside the repo ignored the project config. Put the copy inside the repo.

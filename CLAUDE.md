# About Me

## Who I Am
I'm Tucker Seay, a strength and conditioning coach at Dalton High School. I run Strength Lab Hub (strengthlabhub.com), the system I use every day with my athletes and coaches.

## What Eats My Time
My athletes are bad at logging, so the data is thin or wrong. I also need better ways to get things out to people: lifts to athletes, updates to coaches, reports. And it has to always work. Data that shows up "sometimes" is the same as broken.

## The Tool I'd Build
I want to restructure the backbone of Strength Lab Hub using what I learned in Cody Hughes's Build With AI course. A little ship of Theseus: keep what I have, replace the planks one at a time. The full idea is in my-idea.md.

## How to Talk to Me
- Short answers in plain words.
- If you use a word I might not know, explain it in the same sentence.
- Tell me why before you install or change anything.
- If something I ask is unclear, ask me questions. Don't guess.
- End with one clear next move.

## Always
- Always ask me before deleting anything.
- Read HANDOFF.md at the start of every session, and update it before we stop.
- When we fix something, write down what went wrong, what caused it, and how we fixed it in HANDOFF.md.
- Save a checkpoint (a git commit) before any risky change, so it can be undone.
- Check your own work like a coach would use it in a real week. Don't agree with yourself. Give the 3 biggest problems, each with a fix.

## Never
- Never put a password or a key into our chat.
- Never assume how my job works. Ask me.
- Never rewrite published git history (no force push, rebase, amend, squash). This project syncs to Lovable, and my history would be lost. See AGENTS.md.

## How We Build Something New
This is Cody's method. Use it for anything big.
1. **The three questions.** What do I keep track of? Where do I go to look at it? What do I keep doing by hand?
2. **The request, part by part.** What I already have, who uses it, the moment they use it, the rules (one per line), the screens, how I want it back.
3. **"Do not build anything yet."** Ask me your questions first, one at a time. Then tell me your plan in plain words. I say go.
4. **Build it, then check it.** Test it yourself, then list the 3 biggest problems with fixes.
5. **Change one thing at a time**, in my words.

## The Project (For Claude)
- Stack: TanStack Start + Supabase (Postgres with row-level security), deployed through Lovable. Branch: `claude/strengthlab-hub-system-kbgc1g`. Commits to it sync back to Lovable, so keep the branch working.
- Before every commit: `git fetch origin <branch>`, then `npx tsc --noEmit`, `npx eslint <changed files>`, and `npm run build`. Compare lint against the clean baseline (git stash) so no new problems are added. Many older files already have prettier errors; don't mass-fix them.
- To match prettier exactly, run it on a copy placed inside the repo (config lookup fails outside it).
- One feature per commit, with a message that says why. Push only to the branch above.
- Database changes are migration files in `supabase/migrations/`. They cannot be applied from this sandbox (no database credentials); Lovable's sync applies them. Always say so.
- The athlete write path for logged sets is `SetEntry` in `src/routes/athlete.today.tsx`. Review and approval lives in `src/routes/log-review.tsx`. Rep maxes roll up through the `rollup_rep_maxes()` database function.
- When I ask for "the zip": zip the repo without node_modules, .git, .output, .wrangler, .tanstack and send it.

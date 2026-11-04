---
name: stuck
description: Walks Tucker through a problem when something won't work and he can't see why. Use when he types /stuck, says he is stuck or lost, or says something broke and he doesn't know why.
---

# Stuck

Read `CLAUDE.md` (the rules) and `HANDOFF.md` (where things stand) first. Don't ask what you already know.

Go one question at a time. Ask before you change anything.

1. **Ask what happened.** Say: "What were you trying to do, and what do you see now?" Example: "I clicked Save and nothing happened." Ask for a screenshot if it would help.
2. **Look before you guess.** Read the code, the logs, the database migrations, any error. Say what went wrong in plain words.
3. **Suggest one fix.** One or two lines on what and why. Change nothing until he says go.
4. **Check it worked**, yourself if you can (typecheck, lint, build, read the data path). Tell him plainly.
5. **If it worked:** add what went wrong, what caused it, and how it was fixed to "What Went Wrong" in `HANDOFF.md`.
6. **If it still doesn't work after one fix:** stop trying. Write a short note (what he tried, what you tried, the exact error) so he can hand it to someone who can help.

Never delete anything without asking. Never put a password or key in a note. If a fix needs a database change, say plainly that it only takes effect after the Lovable sync applies it.

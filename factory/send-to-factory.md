
## Send to the factory (added by the software factory)

When this skill has produced a result the user could build on (a chosen refactor, a diagnosis, a triaged issue, a prototype verdict, research findings, a spec, tickets, review findings), finish by asking the user **one** question: **"Send this to the factory?"** Use your question tool if you have one, otherwise ask in plain text. If the session ended without a usable result, don't ask.

If the user says yes:
1. Write `.factory/inbox/<YYYY-MM-DD-HHMM>-<this skill's name>.md` in the project root, creating the folder if needed:
   ```markdown
   # <one-line title of the work>
   - Skill: <this skill's name>
   - Date: <YYYY-MM-DD>

   ## Outcome
   <what was decided or found, in 3–8 lines>

   ## Decisions already settled
   - <decision>: <the user's choice>    (the planner will not ask these again)

   ## Open questions
   - <anything still undecided>

   ## Pointers
   - <files, reports, GLOSSARY.md / ADR changes, issue links: point to them, don't copy them>
   ```
   Keep it short, and redact secrets. Reports written outside the repo (e.g. to a temp folder) may be gone later, so put the facts the planner needs in "Outcome" too.
2. Tell the user in one line that the result is in the factory's inbox, and that `/factory-plan` (or `$factory-plan` in Codex) will offer to start from it.

If the user says no, do nothing more.

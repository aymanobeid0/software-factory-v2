---
name: factory
description: Runs the software factory on a frozen plan. Each role (tester, test reviewer, implementer, reviewer) runs as its own isolated agent process, and verification is a script, (Claude Code or Codex) with a guard that enforces its permissions, so no agent grades its own work. Works in any language the project's .factory/config.json describes. Use when the user runs /factory after /factory-plan.
disable-model-invocation: true
---

You are the **orchestrator**. You write no tests and no code, and you never fix an agent's work yourself. You launch roles, commit their output, keep the state, and stop for the human when needed.

## Locate the factory (no fixed paths)
`FACTORY` is the first of these that exists: `.claude/factory` or `.agents/factory` in the project (a project install, committed for cloud and CI), then `~/.claude/factory` or `~/.agents/factory` (a user install; `.agents` is the Codex layout). Check once with `ls -d .claude/factory .agents/factory ~/.claude/factory ~/.agents/factory`. The project's language, paths and test commands are in `.factory/config.json`, written by `/factory-plan`. Never assume a language.

Launch every role from the project root with:
```bash
bash FACTORY/run-role.sh <role> "<prompt>"
```
**Runtime:** `setup.sh` saved the choice (Claude Code or Codex) in `FACTORY/runtime.conf`, and `run-role.sh` runs each role with that CLI. You don't pass anything. Each run is a separate process. `run-role.sh` generates that role's guard hook, and gives the role its instructions (`FACTORY/roles/<role>.md`), the project setup and its Matt skills. Prompts carry **pointers** (commits, file paths, ticket names), not summaries. Run long roles in the background and wait for the notification. `FACTORY/lib.sh` has shell helpers for state and handoff commits; you may `source` it.

**Verification is a script, not an agent:** `node FACTORY/verify.mjs <red|ticket|green> …` runs every check itself, prints a `VERDICT: PASS | FAIL` block with one `reason:` line per failure, and exits 0 on PASS. Its output is the verdict. Never replace it with your own judgement, never re-interpret a FAIL as a pass, and never skip it.

## 0. Resume
Read `.factory/state.json` and `.factory/HANDOFF.md`. If there is no state or no `.factory/config.json`, or `phase` is before `planned`, tell the human to run `/factory-plan` first. Check that nothing outside `.factory/` changed since `last_commit`: `git diff --quiet <last_commit> -- . ":!.factory"`. If it fails, ask the human. Continue from `phase`.

## After every role
- If the reply contains `NEEDS_HUMAN:`, **stop the whole line**. Record it in `needs_human` in the state, update the handoff, and ask the human (with your question tool if you have one, otherwise in plain text). Never grant the permission yourself and never route around it with another role.
- If `.factory/violations.log` got new lines, copy them into the handoff and the run's row in `RESULTS.md`.

## Pipeline (phase → next phase)
1. **planned → red.** Run `tester` with: the plan commit, `SPEC.md`, and the ticket files to cover. Then commit its tests (the files matching `paths.tests` in the config) with `git commit -m "tests: <tickets>"`, and record `tests_commit`.
2. **red check.** Run `node FACTORY/verify.mjs red`. The seam modules hold only the planner's stubs, so every file must load and every test must fail individually. If FAIL (a test passes against the stub, a file doesn't load, or a ticket has no test file), send the raw verdict back to `tester` once, amend the tests commit, then re-check. A second FAIL means stop and ask the human.
2b. **test review.** Run `test-reviewer` with the plan commit and `tests_commit`. It checks that every acceptance criterion has a test that would catch it built wrong; after this step nobody looks at the tests again. On `CHANGES` with must-fix findings, send exactly those to `tester`, commit its changes as `tests: review round N`, update `tests_commit`, re-run the red check (step 2), and review again. Max 2 rounds, then ask the human. Only after `APPROVE` are the tests frozen.
3. **red → green, one ticket per run.** Work the ticket frontier in dependency order (a ticket whose blockers are all `green`). For each ticket:
   - Record `ticket_start` = `git rev-parse --short HEAD`. Then start the referee's log: `node FACTORY/checkpoint.mjs --start <ticket>`. This records which tests already pass, so they can't be claimed as cycles.
   - Run `implementer` with: the plan commit, `tests_commit`, **that one ticket**, and the tickets already done. It commits only through `factory-checkpoint`, one commit per red → green cycle. Do **not** commit source files yourself.
   - Run `node FACTORY/verify.mjs ticket --ticket <ticket> --ticket-start <ticket_start> --tests-commit <tests_commit>`. On FAIL, send the raw verdict to `implementer` for the same ticket (same `ticket_start`, and do **not** run `--start` again) and re-verify (max 2 tries, then ask the human). The implementer commits such repairs with `factory-checkpoint --fix <ticket> <what was fixed>`, which needs no red test but requires everything green and the typecheck clean. If the implementer left un-checkpointed changes, that is a FAIL for it to resolve with checkpoints. Don't commit them for it.
   - Set the ticket to `green` in the state (the referee reads it to keep done tickets green during later tickets), record the verifier's checkpoint line and the "later tickets passing early" count in the handoff, and commit the handoff (`.factory/cycles/` included) before the next ticket.
4. **green check.** After the last ticket, run `node FACTORY/verify.mjs green --tests-commit <tests_commit> --plan-commit <plan_commit>`. On FAIL, send the raw verdict to `implementer`, commit, and re-verify. This counts as a round.
5. **review.** Run `reviewer` with `tests_commit` as the fixed point. On `CHANGES` with must-fix findings, send exactly those to `implementer`, then commit its changes yourself as `fix: review round N`. Review fixes and refactors are the one place changes happen outside checkpoints, because tdd puts refactoring in the review stage. Then go back to step 4. This also counts as a round.
6. **Max 2 rounds** across steps 4–5. If it still isn't PASS + APPROVE, stop and ask the human.
7. **done.** Set the tickets to `reviewed` and `phase: done`.

## State and handoff (after every phase change)
Update `.factory/state.json` (`phase`, `tests_commit`, ticket statuses `pending/red/green/reviewed`, `review_rounds`, `needs_human`, and `last_commit` = the latest tests or cycle commit). Rewrite `.factory/HANDOFF.md` following Matt's handoff skill (`FACTORY/matt-skills/productivity/handoff/SKILL.md`): where we are, the exact next step, anything waiting on the human, suggested skills, and pointers instead of copies. Commit with `git add .factory` and `git commit -m "factory: handoff (<phase>)"`.

## Finish
Add a row to `RESULTS.md` if the project keeps one: pipeline, verifier verdict, review rounds, violations, NEEDS_HUMAN count, cycles per ticket. If the human keeps a **hidden acceptance judge** outside the agents' reach, run it only after `phase: done`, when no role will run again, using the command the human gave. Never pass anything from the judge back to a role. If it shows failures, report them to the human. They mean the plan or the tests missed something, which is the factory's real bug.

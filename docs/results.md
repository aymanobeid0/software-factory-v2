# Factory results

Every run starts from the `lab: start` commit (`git reset --hard <start>`), uses the unchanged `TASK.md`, and is judged by the hidden acceptance tests in `../factory-lab-hidden`, which no agent may read. The judge had 16 tests for runs 0–5. From run 6 it has 20, after mutation testing showed gaps (lesson 9). Every earlier run's final code was re-judged with the 20-test version and passes 20/20, the baseline included (on its own file).

Judge command, run by the human after each run:

```bash
npx vitest run --root ../factory-lab-hidden
```

| Date | Stage | Pipeline | Hidden pass | Own tests changed after red? | Violations / NEEDS_HUMAN | Review rounds | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-08 | 0 | baseline: one agent follows `implement` alone (branch `baseline`, `f0aa977`) | **0/16** as delivered (wrong file `src/priceCart.ts`, so the fixed interface broke). 16/16 when pointed at its file | n/a (wrote and judged its own 15 tests) | 0 / 0 | self-review only | Admits it skipped the `tdd` and `code-review` skills. Its own tests all passed, so it couldn't see the contract break. |
| 2026-11-08 | 1–4 | factory: planner → tester → verifier(red) → implementer → verifier(green) → reviewer (`667df1d`) | **16/16** | no (verifier checked) | 0 / 0 | 0 (APPROVE first time) | 33 independent tests. The implementer admits it skipped reading `implement`/`tdd`, but the guard and the independent checks made that harmless. |
| 2026-11-08 | change 1 | same factory, with **the seam naming its module** in `SPEC.md`, plus updated Matt skills (`GLOSSARY.md`). Branch `run-2`, `4b23a74` | **16/16** | no (verifier checked) | 0 / 0 | 0 (APPROVE first time) | The tester imported from `src/cart.ts` **because the spec said so** (in run 1 it got the path from TASK.md by luck). The reviewer explicitly checked the seam's path and signature. The implementer again admits it skipped tdd's one-test-at-a-time loop (lesson 4 still open). |
| 2026-11-08 | change 2 | **seam stub in the plan + strict red + one ticket per implementer run**, each verified on its own. Branch `run-3`, `8b7fe13` | **16/16** | no (verifier checked) | 0 / 0 | 0 (APPROVE, 2 `nice`) | Strict red: 35 tests loaded and **each failed on the stub, 0 passed**. Cycles per ticket: 01 → 4, 02 → 1 (a single rule, honestly reported), 03 → 2. No code for a later ticket appeared early. Later-ticket tests passing early: 7/24 after 01, 7/17 after 02 (trivially-true rules, as expected). New finding: the stub's comment survived into the final code (fixed in `/factory-plan`). |
| 2026-11-08 | change 3 | **refereed cycles:** `checkpoint.mjs` checks every red → green step itself and commits it. Branch `run-4`, final `dc09160` | **16/16** | no (verifier checked) | 0 / 0 (2 checkpoint rejections, both mistyped test names, no code issue) | 0 (APPROVE, 2 `nice`) | 42 tests, strict red. **7 refereed cycle commits**: 01 → 4, 02 → 1, 03 → 2. The verifier confirmed "log matches git" for every ticket. The referee's "nothing earlier may break" rule made the implementer add the best-code pick at exactly the moment a test needed it. The implementer again admits it didn't read the skill files, and that no longer matters: the loop is enforced from outside. |
| 2026-11-08 | change 4 | **skills injected** into each role's system prompt by `run-role.sh` (`--append-system-prompt-file`, read fresh from `matt-skills` on every run). Branch `run-5`, final `9bb56bd` | **16/16** | no (verifier checked) | 0 / 0 (1 checkpoint rejection, a mistyped test name) | 0 (APPROVE, 2 `nice`) | First run in which no agent says "I didn't read the skill". A readiness check confirmed the tester quotes the skill text exactly with no tool use. **30 tests** (run 4: 42) with the same bug-catching power (14/14, see mutation testing). 7 refereed cycles: 01 → 4, 02 → 1, 03 → 2. |
| 2026-11-08 | change 5 | **invariants + stronger judge:** the planner marks rules no input can reach under `### Invariants` (the human chose: zero floor = safeguard). The tester writes no fake test for them, the implementer must write the safeguard, and the reviewer must find it. Branch `run-6`, final `d9d980e` | **20/20** (new judge) | no (verifier checked) | 0 / 0 (2 checkpoint rejections, label wording) | 0 (APPROVE, 1 `nice`) | The tester explicitly skipped a fake test for the invariant. The implementer wrote `Math.max(0, …)` in ticket 03 cycle 1. The reviewer checked it explicitly ("passes"). The zero-floor note from runs 4–5 is gone. 32 tests, 7 refereed cycles, mutation 14/14. |

## Mutation testing (test quality, measured neutrally)
A correct reference implementation with 14 planted bugs, switched on one at a time. Each run's frozen tests are run against each bug. A test suite "kills" a bug if any test fails.

| Test suite | Bugs caught | Missed |
|---|---|---|
| baseline (one agent, self-tested) | 11/14 | validation only checks the first line; bulk rounding on the total instead of per line; PCT20 on the subtotal |
| factory runs 1–6 | **14/14** each | none |
| the hidden judge, 16 tests (runs 0–5) | 10/14 | case-insensitive codes; first-line-only validation; total-level rounding; PCT20 on the subtotal |
| the hidden judge, 20 tests (from run 6) | **14/14** | none |

Reading: separating the tester from the implementer produced clearly stronger tests than self-testing. Injecting skills (run 5) kept full strength with 29% fewer tests, which fits tdd's "you can't test everything". But on a task this small, mutation testing can't show a quality gain beyond 14/14.

## Lessons from run 1
1. **The factory's main win was the contract:** the independent tester imported from the path in `TASK.md`, so the implementer had to satisfy it. The lone agent picked its own file name and graded itself green.
2. ~~**Planner gap:** `SPEC.md` left out the module path, because to-spec says "no file paths". Next change: the `### Seams` section must name the module the seam lives in.~~ **Done in change 1** (run 2): the planner, tester and reviewer now enforce it.
3. ~~**Weak red check:** "red" currently means the suite fails to load because `src/` is missing.~~ **Done in change 2** (run 3): the planner freezes a throwing stub, and the verifier requires every file to load and every test to fail individually.
4. ~~**Agents skip tdd's one-test-at-a-time loop.**~~ **Done in changes 2 and 3** (runs 3–4). Change 2 made it one ticket per run, verified per ticket. Change 3 added `checkpoint.mjs`, a referee script, the only way the implementer can commit. It accepts a cycle only if the named test was red at the previous checkpoint, is green now, src changed, and nothing that passed before broke. Every cycle is its own commit, so git history is the proof, not the agent's word.

## Lessons from run 3
5. Seam stubs must carry no comments about being stubs: they survive into the final code. Fixed in `/factory-plan`.
6. Trivially-true rules ("qty 9 gets no discount", "unknown codes ignored") pass before their ticket is built. So "later tickets still fail" can't be a gate, only information. The real gate is "this ticket's file and the earlier ones pass".

## Lessons from run 4
7. ~~**Unreachable spec rules:**~~ **Done in change 5** (run 6), together with lesson 9. "the total is never negative" can't be reached by any test, because no code takes off more than the amount. So strict TDD, correctly, wrote no code for it, and the reviewer flagged it as `nice`. A spec rule no test can reach is either dead or a safeguard. Proposed next change: during to-spec the planner marks such rules explicitly, as either "drop" or "safeguard: must be written into the code". The reviewer then treats a missing safeguard as `must-fix`.
8. **One cycle can turn many tests green** (up to 6 here) when one rule covers several tests. That's legitimate tdd ("minimum code"), and the referee records it as "also green". The number is information, not a gate.

## Lessons from run 5
9. ~~**The judge is the weakest test suite in the lab** (10/14 bugs).~~ **Done:** it now has 4 more cases and catches 14/14. It still agreed with every factory run, but a stronger factory needs a stronger judge. Next change: add hidden cases for the 4 bugs it misses (only the human or orchestrator may edit `../factory-lab-hidden`).
10. **Skills belong in context, not behind a "read this file" link.** Agents skipped linked skills in runs 1–4 and used injected ones in run 5.
11. The reviewer flagged the same missing zero floor as in run 4, which confirms lesson 7 is a real planner gap and not a one-off.

## Lessons from run 6
12. These are invariants, not edge cases. An edge case is a reachable input on a rule's boundary (qty 9 vs 10, exactly 2000), and TDD covers it. An invariant is a rule no input can reach today, and TDD is blind to it by design. Marking invariants in the plan closes the gap: one human decision, enforced by the implementer and checked by the reviewer.
13. All 13 earlier lessons are now closed or recorded. The factory has held 16/16 → 20/20 on this task for six runs. The next useful signal needs a **bigger or different task**: several modules, several seams, real ticket dependencies.

## Change 6: portable and language-neutral factory (runs 7 and Python)
The user pointed out that the factory hard-coded this machine's paths and assumed TypeScript, so it would break in the cloud, on GitHub, or in another language. Fixed at the root:
- **No fixed paths:** every script locates itself (`lib/config.mjs` → `FACTORY_HOME`; `run-role.sh` and `bin/factory-checkpoint` from their own path). The factory works as a user install (`~/.claude/factory`) or a project install (`.claude/factory`, committed for cloud and CI). Guard settings are generated per run, and the hard-coded `roles/*.json` files are gone. Tested: a copy moved to a temp folder found itself and its own skills, and refused the other install's files.
- **No fixed language:** each project has `.factory/config.json` (source and test globs, test-file pattern, commands for test, test file, one test, JUnit and typecheck, plus extra PATH such as a venv). The guard builds its write rules and command allowlist from it, and `run-role.sh` injects it into every role's system prompt.
- **Language-neutral referee:** `checkpoint.mjs` reads per-test results from **JUnit XML**, which vitest, jest, pytest, gotestsum and cargo-nextest emit. Test names are matched by whole words in order, ignoring case and symbols, so `empty cart` matches both `prices an empty cart` and `test_empty_cart_prices`.
- Guard tests: 37 cases across TypeScript, Python, Go-style co-located tests, and a project with no config. All pass.

| Run | Language | Judge | Tests | Refereed cycles | Rejections | Review | Violations |
|---|---|---|---|---|---|---|---|
| Python lab (`D:\factory-lab-py`) | Python + pytest | **21/21** (pytest judge) | 40 | 7 (01: 4, 02: 1, 03: 2) | 4 in ticket 01, all from name matching (underscores), fixed in the referee, then 0 | APPROVE, 0 rounds | 0 |
| run 7 (branch `run-7`) | TypeScript + vitest | **20/20** | 31 | 7 (01: 4, 02: 1, 03: 2) | **0** | APPROVE, 0 rounds | 0 |

## Lessons from change 6
14. A factory meant to run anywhere must hold **no knowledge of a machine or a language** in its code. All of that belongs in per-project config, frozen with the plan, which the guard and the roles read.
15. Cross-language details hide in small places. Here it was test-name style (`test_snake_case` vs prose names), found only by actually running a second language.

## Project install test (`D:\factory-lab-proj`, branch `proj-1`)
The factory was copied into the repo's `.claude/` (factory, agents, skills) and committed. Then the **user install in `~/.claude` was parked**, so nothing outside the repo could help, and the full pipeline ran from the project copy. The user install was restored automatically afterwards by a `trap`.

| Check | Result |
|---|---|
| Factory resolved to | `/d/factory-lab-proj/.claude/factory` (the project copy) |
| Strict red | 32 tests, all failed |
| Refereed cycles | 7 (01: 4, 02: 1, 03: 2), **0 rejections**, log matches git for every ticket |
| Green / review | 32/32, typecheck clean / APPROVE (2 `nice`), 0 rounds |
| Hidden judge | **20/20** |
| Guard blocks | 5, all harmless: the verifier tried `cd <path>; …` and `git -C <path>`, then used the allowed form. Agents now say to run commands directly. |
| Line endings | Found during setup: Git on Windows would turn the scripts into CRLF, which breaks bash on Linux and in the cloud. Added `.claude/factory/.gitattributes` (`eol=lf`). A fresh clone with `core.autocrlf=true` keeps 0 CR characters in the scripts. |

16. A factory that works from `~/.claude` can still fail from a repo in small ways (line endings, `cd` habits). Only running it with the user install **removed** proves the project copy stands alone.

## Change 7: scripted verifier, fix checkpoints, test review, harder guard (from a code review, not yet run live)
A review of the factory's own code found places where its promise ("no agent's word counts") did not hold. Fixed:
- **The verifier is now a script** (`verify.mjs`, modes `red`, `ticket`, `green`), not an agent. The `verifier` role is gone.
- **Fix checkpoints:** `factory-checkpoint --fix <ticket> <what>` commits a repair that has no red test (a typecheck error, a regression, a safeguard). Before, the referee rejected it and un-refereed changes failed verification, so the line always stopped for the human. A fix must keep everything green, keep the typecheck clean, and turn no red test green.
- **Earlier tickets are checked at every checkpoint**, so a regression is rejected when it happens.
- **Test reviewer:** a new read-only role checks, before the tests freeze, that every acceptance criterion has a test that would catch it built wrong. Before, nobody reviewed the tests.
- **Guard:** line breaks are blocked like `;`; project commands are allowed only in the exact shape the config gives (no extra options such as `--outputFile=`); `git --output/--no-index/--ext-diff`, `rg --pre`, `sed` beyond printing a line range, `find -fprint0`, `tree -o` and outside-project `Glob` patterns are blocked; the guard, referee and verifier read the config frozen in git, not the copy on disk.
- **The factory's own tests** are in `factory/tests/` (19 tests: guard cases for TypeScript, Python and Go, and the referee and verifier on a fake project), run in CI on Linux and Windows.

Still open: these changes are tested with the scripts' own tests only. A full pipeline run with Claude Code, and the first live Codex run, are pending. The guard judges tool calls and is not a sandbox: code a role may run (its tests) still runs with the role's OS permissions, and `verify.mjs` detects the result rather than preventing it.

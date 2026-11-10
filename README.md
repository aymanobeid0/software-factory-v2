# Software Factory v2

**Matt Pocock's skills as a software factory, for Claude Code or Codex: one guarded agent per role, so no agent ever grades its own work.**

[العربية في الأسفل](#بالعربي)

## Setup
```bash
git clone https://github.com/aymanobeid0/software-factory-v2.git
cd software-factory-v2
./setup.sh
```
`setup.sh` asks two things, **Claude Code or Codex**, and **all your projects or one project**, and sets everything up for that choice:
- the factory, with your choice saved in `factory/runtime.conf`
- the commands `/factory-plan` and `/factory` (`$factory-plan`, `$factory` in Codex)
- Matt Pocock's skills as commands: `/improve-codebase-architecture`, `/tdd`, `/to-spec`, `/grill-me`, `/diagnosing-bugs`… (31). Matt's `code-review` is installed as `matt-code-review`, so it doesn't clash with Claude Code's built-in `/code-review`.

Non-interactive: `./setup.sh claude`, `./setup.sh codex`, or `./setup.sh codex /path/to/project`.

| | Claude Code | Codex |
|---|---|---|
| Installs into | `~/.claude` or `<project>/.claude` | `~/.agents` or `<project>/.agents` |
| Commands | `/name` | `$name` |
| Roles run as | `claude -p` | `codex exec` |
| Guard | PreToolUse hook | PreToolUse hook (Bash and apply_patch) |

Needs: `node`, `git`, `bash` (Git Bash on Windows), the CLI you chose, and a test runner that can write JUnit XML.

## Why
When one agent writes the tests, writes the code and reviews it, it can quietly weaken a test, write a test that can't fail, or claim success. This factory keeps [Matt Pocock's skills](https://github.com/mattpocock/skills) as they are and only **separates the agents**:

| Role | Does | May write | Skill |
|---|---|---|---|
| Planner (you + the agent) | grills you, writes spec, tickets, project config, seam stubs | plan files | grill-with-docs, to-spec, to-tickets |
| Tester | red tests at the agreed seams | test files only | tdd |
| Implementer | one ticket per run, one red → green cycle at a time | source files only | implement + tdd |
| Test reviewer | checks every spec rule has a test that would catch it built wrong | nothing | tdd (tests.md) |
| Verifier | **a script** (`verify.mjs`), not an agent: runs every check, prints PASS or FAIL | nothing | — |
| Reviewer | reviews the diff against the spec and standards | nothing | code-review |

Each agent role is a separate process. A **guard** hook enforces each role's permissions, built from the project's `.factory/config.json`. A **referee** (`factory-checkpoint`) is the implementer's only way to commit, and it accepts a cycle only if the named test was really red before and is green now (`--fix` covers repairs with no red test: everything must stay green and the typecheck clean). The factory's own tests: `node --test "factory/tests/*.test.mjs"`. When a role needs something it lacks, it stops with `NEEDS_HUMAN` instead of working around it.

## Use
1. Run `/factory-plan` in your project. No brief needed: the planner asks what you want, explores the repo, and grills you on the open decisions only.
2. Run `/factory`.

**Skills on their own, then the factory:** run any skill by itself, e.g. `/improve-codebase-architecture` or `/diagnosing-bugs`. When it has a result, it asks **"Send this to the factory?"**. If you say yes, the result goes to `.factory/inbox/`, and the next `/factory-plan` offers to start from it, without asking again what's already decided.

## Evidence
Measured on a fixed task with a hidden acceptance judge no agent can read ([docs/results.md](docs/results.md)):
- Claude Code + TypeScript: 7 runs; the final runs scored 20/20, with 0 guard violations.
- Claude Code + Python: 21/21, with no change to the factory.
- Mutation testing with 14 planted bugs: the factory's tests caught **14/14**; a single self-testing agent caught 11/14.
- Codex: the guard is tested against Codex's documented hook inputs (apply_patch, shell). A live Codex pipeline run is still pending.

Matt Pocock's skills are pinned in `factory/matt-skills` under their MIT license (see `LICENSE` and `SOURCE.md` there). To update them after setup: `bash <install-dir>/factory/update-matt-skills.sh`.

---

## بالعربي

**مهارات Matt Pocock على شكل مصنع برمجيات، بيشتغل مع Claude Code أو Codex: كل دور إله وكيل منفصل ومحمي، فما في وكيل بيقيّم شغله بنفسه.**

### الإعداد
```bash
git clone https://github.com/aymanobeid0/software-factory-v2.git
cd software-factory-v2
./setup.sh
```
السكربت بيسألك سؤالين: **Claude Code ولا Codex؟** و**لكل مشاريعك ولا لمشروع واحد؟** وبيجهّز كل شي على أساس جوابك: المصنع، وأوامر `/factory-plan` و`/factory`، و31 أمر من مهارات Matt. (بـ Codex الأوامر بتبدأ بـ `$` بدل `/`.)

### الاستخدام
1. شغّل `/factory-plan` بمشروعك، بدون ما تكتب أي ملف. المخطِّط بيسألك شو بدك تبني.
2. شغّل `/factory`.

**بتقدر تشغّل أي مهارة لحالها**، مثل `/improve-codebase-architecture`. لما تخلص، بتسألك: **"بدك تبعث النتيجة للمصنع؟"** إذا قلت نعم، النتيجة بتنحفظ، و`/factory-plan` الجاي بيعرض عليك يبني عليها.

الدليل الكامل بالعربي في [factory/README.md](factory/README.md)، والنتائج في [docs/results.md](docs/results.md).

# Software Factory v2

**Matt Pocock's skills as a software factory: one guarded agent per role, so no agent ever grades its own work.**

[العربية في الأسفل](#بالعربي)

## Why
When one agent writes the tests, writes the code and reviews it, it can quietly weaken a test, write a test that can't fail, or claim success. This factory keeps [Matt Pocock's skills](https://github.com/mattpocock/skills) exactly as they are and only **separates the agents**:

| Role | Does | May write | Skill |
|---|---|---|---|
| Planner (you + Claude) | grills you, writes spec, tickets, project config, seam stubs | plan files | grill-with-docs, to-spec, to-tickets |
| Tester | red tests at the agreed seams | test files only | tdd |
| Implementer | one ticket per run, one red → green cycle at a time | source files only | implement + tdd |
| Verifier | runs every check itself | nothing | — |
| Reviewer | reviews the diff against the spec and standards | nothing | code-review |

Each role is a separate `claude -p` process. A **guard** hook enforces each role's permissions, built from the project's config. A **referee** (`factory-checkpoint`) is the implementer's only way to commit, and it accepts a cycle only if the named test was really red before and is green now. When a role needs something it lacks, it stops and returns `NEEDS_HUMAN` instead of working around it.

## Portable by design
- **No fixed paths:** every script locates itself. Install per user (`~/.claude`) or per project (`.claude/` committed to the repo, for cloud and CI).
- **No fixed language:** each project gets `.factory/config.json` with its source/test globs and test commands. The referee reads per-test results as **JUnit XML** (vitest, jest, pytest, gotestsum, cargo-nextest…).
- **Resumable:** `.factory/state.json` and `.factory/HANDOFF.md` let any new session continue where the last one stopped.

## Everything ships in the repo
All of it lives in `.claude/`, which Claude Code loads automatically when you open it in this repo. **Clone it and the commands are there**, with no install and no plugin:

| Command | What |
|---|---|
| `/factory-plan`, `/factory` | the factory itself |
| `/improve-codebase-architecture`, `/tdd`, `/to-spec`, `/to-tickets`, `/grill-with-docs`, `/grill-me`, `/diagnosing-bugs`, `/triage`, `/wayfinder`, `/prototype`, `/handoff`, … | Matt Pocock's skills (31), from the pinned copy |
| `/matt-code-review` | Matt's `code-review`, renamed so it doesn't clash with Claude Code's built-in `/code-review` |

```
.claude/
  factory/   guard, referee, run-role.sh, config example, pinned matt-skills
  agents/    the four factory roles
  skills/    /factory-plan, /factory and Matt's 31 commands
install.sh   copies the same .claude/ content into another project, or into ~/.claude
```

## Use it in another project
```bash
git clone https://github.com/aymanobeid0/software-factory-v2.git
cd software-factory-v2
./install.sh /path/to/your/repo   # project install into /path/to/your/repo/.claude (commit it)
./install.sh                      # or: user install into ~/.claude, for every project
```
Add `--no-matt-commands` to install only the factory. Needs: `claude` (Claude Code), `node`, `git`, `bash` (Git Bash on Windows), and a test runner that can write JUnit XML.

## Use
1. In your project, run `/factory-plan`. No brief file needed: the planner asks what you want, explores the repo, and grills you on the open decisions only. It then freezes the spec, tickets, config and seam stubs.
2. Run `/factory`. Tester → strict red check → per ticket (implementer with the referee → verifier) → green check → reviewer.

## Evidence
Measured on a fixed task with a hidden acceptance judge no agent can read ([docs/results.md](docs/results.md)):
- TypeScript: 7 runs; final runs 20/20 on the hidden judge, 0 guard violations.
- Python: 21/21 on a hidden pytest judge, with no change to the factory.
- Project install with no user install present: 20/20.
- Mutation testing with 14 planted bugs: the factory's tests caught **14/14**; a single self-testing agent caught 11/14.

Matt Pocock's skills are pinned in `.claude/factory/matt-skills` under their MIT license (see `.claude/factory/matt-skills/LICENSE` and `SOURCE.md`). To update them to the latest version and refresh the commands: `bash .claude/factory/update-matt-skills.sh`.

---

## بالعربي

**مهارات Matt Pocock على شكل مصنع برمجيات: كل دور إله وكيل منفصل ومحمي، فما في وكيل بيقيّم شغله بنفسه.**

### ليش؟
لما وكيل واحد يكتب الاختبارات والكود ويراجع حاله، بيقدر يضعّف اختبار، أو يكتب اختبار ما بيفشل أبداً، أو يدّعي إنه نجح. هذا المصنع بيحافظ على مهارات Matt زي ما هي، وبيفصل الوكلاء بس:
- **المخطِّط** (إنت + Claude): بيسألك، وبيكتب الـ spec والتذاكر والإعداد.
- **كاتب الاختبارات:** بيكتب اختبارات حمراء، وما بيلمس الكود.
- **المنفّذ:** تذكرة وحدة بكل تشغيل، ودورة أحمر ← أخضر ورا الثانية، و**الحَكَم** بيتأكد من كل دورة.
- **المُتحقِّق:** بيشغّل الفحوص بنفسه، وما بيصدّق حدا.
- **المراجع:** بيراجع الكود حسب الـ spec، وما بيكتب شي.

### كل شي موجود داخل الريبو
المصنع ومهارات Matt كلها داخل مجلد `.claude/`، وClaude Code بيحمّل هذا المجلد تلقائياً. يعني **انسخ الريبو وافتح Claude Code فيه، وبتلاقي الأوامر جاهزة**، بدون تثبيت وبدون plugin:
- `/factory-plan` و`/factory`: المصنع.
- 31 أمر من مهارات Matt، مثل `/improve-codebase-architecture` و`/tdd` و`/to-spec` و`/grill-me` و`/diagnosing-bugs`.
- `/matt-code-review`: هو `code-review` تبع Matt، بس بهذا الاسم عشان ما يتضارب مع أمر `/code-review` المدمج بـ Claude Code.

### الاستخدام بمشروع ثاني
```bash
./install.sh /path/to/repo  # بينسخ نفس محتوى .claude/ لمشروعك (اعمله commit)
./install.sh                # أو لـ ~/.claude، فيشتغل بكل مشاريعك
```

### الاستخدام
1. شغّل `/factory-plan` بمشروعك، بدون ما تكتب أي ملف. المخطِّط بيسألك شو بدك تبني، وبيستكشف المشروع بنفسه.
2. شغّل `/factory`.

ولتحديث مهارات Matt لآخر نسخة، مع الأوامر: `bash .claude/factory/update-matt-skills.sh`

الدليل الكامل بالعربي في [.claude/factory/README.md](.claude/factory/README.md)، والنتائج والتجارب في [docs/results.md](docs/results.md).

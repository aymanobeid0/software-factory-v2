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

## Install
```bash
git clone https://github.com/aymanobeid0/software-factory-v2.git
cd software-factory-v2
./install.sh                # user install into ~/.claude
./install.sh /path/to/repo  # or: project install into /path/to/repo/.claude
```
Needs: `claude` (Claude Code), `node`, `git`, `bash` (Git Bash on Windows), and a test runner that can write JUnit XML.

## Use
1. In your project, run `/factory-plan`. No brief file needed: the planner asks what you want, explores the repo, and grills you on the open decisions only. It then freezes the spec, tickets, config and seam stubs.
2. Run `/factory`. Tester → strict red check → per ticket (implementer with the referee → verifier) → green check → reviewer.

## Evidence
Measured on a fixed task with a hidden acceptance judge no agent can read ([docs/results.md](docs/results.md)):
- TypeScript: 7 runs; final runs 20/20 on the hidden judge, 0 guard violations.
- Python: 21/21 on a hidden pytest judge, with no change to the factory.
- Project install with no user install present: 20/20.
- Mutation testing with 14 planted bugs: the factory's tests caught **14/14**; a single self-testing agent caught 11/14.

Matt Pocock's skills are pinned in `factory/matt-skills` under their MIT license (see `factory/matt-skills/LICENSE` and `SOURCE.md`). Update them with `factory/update-matt-skills.sh`.

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

### التثبيت
```bash
./install.sh                # بـ ~/.claude
./install.sh /path/to/repo  # أو داخل مشروع معيّن (للكلاود و GitHub)
```

### الاستخدام
1. شغّل `/factory-plan` بمشروعك، بدون ما تكتب أي ملف. المخطِّط بيسألك شو بدك تبني، وبيستكشف المشروع بنفسه.
2. شغّل `/factory`.

الدليل الكامل بالعربي في [factory/README.md](factory/README.md)، والنتائج والتجارب في [docs/results.md](docs/results.md).

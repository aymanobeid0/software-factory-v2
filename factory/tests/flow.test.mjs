// The referee (checkpoint.mjs) and the verifier (verify.mjs) on a small fake project with two tickets.
// Run: node --test factory/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHECKPOINT = path.join(here, "..", "checkpoint.mjs");
const VERIFY = path.join(here, "..", "verify.mjs");
const RUNNER = path.join(here, "fake-runner.mjs").replace(/\\/g, "/");

function lab() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-"));
  const sh = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
  const git = (...a) => {
    const r = sh("git", a);
    assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const w = (f, s) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), s);
  };
  const state = (s) => w(".factory/state.json", JSON.stringify(s));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  w(".gitignore", ".factory/.junit-*\n");
  w(".factory/config.json", JSON.stringify({
    paths: { src: ["src/**"], tests: ["tests/**"] },
    testFile: "tests/{ticket}.json",
    commands: { test: `node "${RUNNER}" --all`, testFile: "x {file}", testOne: "x {file} {name}", junit: `node "${RUNNER}" {file} {out}`, typecheck: `node "${RUNNER}" --typecheck` },
  }));
  w("SPEC.md", "spec");
  w("tickets/01-a.md", "a");
  w("tickets/02-b.md", "b");
  w("src/impl.txt", "stub\n");
  git("add", "-A");
  git("commit", "-q", "-m", "plan: lab");
  const plan = git("rev-parse", "HEAD");
  w("tests/01-a.json", JSON.stringify([{ name: "first rule", needs: "A1" }, { name: "second rule", needs: "A2" }]));
  w("tests/02-b.json", JSON.stringify([{ name: "third rule", needs: "B1" }]));
  git("add", "-A");
  git("commit", "-q", "-m", "tests: all");
  const tests = git("rev-parse", "HEAD");
  state({ plan_commit: plan, tests_commit: tests, tickets: { "01-a": "pending", "02-b": "pending" } });
  git("add", "-A");
  git("commit", "-q", "-m", "factory: handoff");
  return {
    dir, git, w, state, plan, tests,
    impl: (s) => fs.appendFileSync(path.join(dir, "src/impl.txt"), s + "\n"),
    checkpoint: (...a) => sh("node", [CHECKPOINT, ...a]),
    verify: (...a) => sh("node", [VERIFY, ...a]),
  };
}

test("red: passes when every test fails; fails when one passes or errors", () => {
  const L = lab();
  let r = L.verify("red");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: PASS/);

  L.impl("A1");
  r = L.verify("red");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pass against the stub/);

  const E = lab();
  E.w("tests/02-b.json", JSON.stringify([{ name: "broken", needs: "!" }]));
  r = E.verify("red");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /could not run/);

  const M = lab();
  fs.rmSync(path.join(M.dir, "tests/02-b.json"));
  r = M.verify("red");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no test file/);
});

test("a full run: cycles, a fix, per-ticket verification, green", () => {
  const L = lab();
  const start1 = L.git("rev-parse", "HEAD");
  assert.equal(L.checkpoint("--start", "01-a").status, 0);

  // A cycle needs a source change, and a test that is green now.
  let r = L.checkpoint("01-a", "first rule");
  assert.equal(r.status, 1);
  L.impl("A1");
  r = L.checkpoint("01-a", "first rule");
  assert.equal(r.status, 0, r.stderr);
  assert.match(L.git("log", "-1", "--format=%s"), /^cycle\(01-a\) 1: first rule/);

  // A test that was already green can't be claimed as a cycle.
  L.impl("noise");
  r = L.checkpoint("01-a", "first rule");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already passing/);

  // ...and --fix can't be used to sneak a red test green.
  L.impl("A2");
  r = L.checkpoint("--fix", "01-a", "sneaky");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /may not turn a red test green/);
  r = L.checkpoint("01-a", "second rule");
  assert.equal(r.status, 0, r.stderr);

  // Verifier, ticket mode: PASS.
  r = L.verify("ticket", "--ticket", "01-a", "--ticket-start", start1);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /log matches git: yes/);

  // The deadlock this fixes: all tests green, but the typecheck is broken. No red test is left,
  // so only --fix can commit the repair, and only once the typecheck is clean.
  L.impl("TYPEERROR");
  r = L.checkpoint("--fix", "01-a", "wip");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /typecheck is not clean/);
  fs.writeFileSync(path.join(L.dir, "src/impl.txt"), "stub\nA1\nA2\ntidy\n");
  r = L.checkpoint("--fix", "01-a", "tidy rounding");
  assert.equal(r.status, 0, r.stderr);
  assert.match(L.git("log", "-1", "--format=%s"), /^fix\(01-a\) 3: tidy rounding/);
  r = L.verify("ticket", "--ticket", "01-a", "--ticket-start", start1);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 cycles, 1 fixes/);

  // Ticket 02: a change that breaks done ticket 01 is rejected at the checkpoint itself.
  L.state({ plan_commit: L.plan, tests_commit: L.tests, tickets: { "01-a": "green", "02-b": "pending" } });
  L.git("add", "-A");
  L.git("commit", "-q", "-m", "factory: handoff (01-a)");
  const start2 = L.git("rev-parse", "HEAD");
  assert.equal(L.checkpoint("--start", "02-b").status, 0);
  fs.writeFileSync(path.join(L.dir, "src/impl.txt"), "stub\nA1\nB1\n");
  r = L.checkpoint("02-b", "third rule");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /breaks earlier ticket 01-a/);
  fs.writeFileSync(path.join(L.dir, "src/impl.txt"), "stub\nA1\nA2\nB1\n");
  r = L.checkpoint("02-b", "third rule");
  assert.equal(r.status, 0, r.stderr);
  r = L.verify("ticket", "--ticket", "02-b", "--ticket-start", start2);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  r = L.verify("green");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERDICT: PASS/);
});

test("ticket mode fails on un-refereed work", () => {
  const L = lab();
  const start = L.git("rev-parse", "HEAD");
  L.checkpoint("--start", "01-a");
  L.impl("A1\nA2");
  assert.equal(L.checkpoint("01-a", "first rule").status, 0);

  // Source changed after the last checkpoint.
  L.impl("extra");
  let r = L.verify("ticket", "--ticket", "01-a", "--ticket-start", start);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /uncommitted source changes/);

  // A commit the referee didn't make.
  L.git("add", "-A");
  L.git("commit", "-q", "-m", "sneaky commit");
  r = L.verify("ticket", "--ticket", "01-a", "--ticket-start", start);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not made by the referee/);
});

test("ticket and green fail when a frozen test or plan file changed", () => {
  const L = lab();
  const start = L.git("rev-parse", "HEAD");
  L.checkpoint("--start", "01-a");
  L.impl("A1\nA2\nB1");
  assert.equal(L.checkpoint("01-a", "first rule").status, 0);

  // A weakened test, left on disk (as code run by a role could do).
  L.w("tests/01-a.json", JSON.stringify([{ name: "first rule", needs: "A1" }, { name: "second rule", needs: "A1" }]));
  let r = L.verify("ticket", "--ticket", "01-a", "--ticket-start", start);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tests changed since tests_commit: yes: tests\/01-a\.json/);
  L.git("checkout", "--", "tests/01-a.json");

  r = L.verify("green");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  L.w("SPEC.md", "an easier spec");
  r = L.verify("green");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /plan changed since plan_commit: yes: SPEC\.md/);
});

test("the referee and verifier read the config frozen in git, not the copy on disk", () => {
  const L = lab();
  L.checkpoint("--start", "01-a");
  const p = path.join(L.dir, ".factory/config.json");
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.commands.typecheck = null; // loosened on disk only
  fs.writeFileSync(p, JSON.stringify(c));
  L.impl("A1\nA2\nTYPEERROR");
  assert.equal(L.checkpoint("01-a", "first rule").status, 0);
  L.impl("more");
  const r = L.checkpoint("--fix", "01-a", "x");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /typecheck is not clean/);
});

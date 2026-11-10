// setup.sh into a project: the factory is installed, its own tests are not.
// (A project's test runner would pick them up and fail the project's full test run.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("setup.sh installs the factory into a project without its own tests", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "setup-"));
  const r = spawnSync("bash", [path.join(repo, "setup.sh"), "claude", proj], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const f = path.join(proj, ".claude", "factory");
  for (const p of ["verify.mjs", "checkpoint.mjs", "hooks/guard.mjs", "run-role.sh", "roles/test-reviewer.md", "runtime.conf"]) {
    assert.ok(fs.existsSync(path.join(f, p)), `missing ${p}`);
  }
  assert.equal(fs.existsSync(path.join(f, "tests")), false, "the factory's own tests were copied into the project");
  assert.ok(fs.existsSync(path.join(proj, ".claude", "skills", "factory", "SKILL.md")));
});

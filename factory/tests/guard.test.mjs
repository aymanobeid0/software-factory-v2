// Guard cases: what each role may and may not do. Run: node --test factory/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(here, "..", "hooks", "guard.mjs");

const CONFIGS = {
  ts: {
    paths: { src: ["src/**"], tests: ["tests/**"] },
    testFile: "tests/{ticket}.test.ts",
    commands: { test: "npx vitest run", testFile: "npx vitest run {file}", testOne: "npx vitest run {file} -t {name}", junit: "npx vitest run {file} --reporter=junit --outputFile={out}", typecheck: "npx tsc --noEmit" },
  },
  py: {
    paths: { src: ["cart/**"], tests: ["tests/**"] },
    testFile: "tests/test_{ticket_snake}.py",
    commands: { test: "python -m pytest -q", testFile: "python -m pytest -q {file}", testOne: "python -m pytest -q {file} -k {name}", junit: "python -m pytest -q {file} --junitxml={out}", typecheck: null },
  },
  go: {
    paths: { src: ["internal/**", "cmd/**"], tests: ["**/*_test.go"] },
    testFile: "internal/cart/t{ticket_snake}_test.go",
    commands: { test: "go test ./...", testFile: "go test ./internal/cart/", testOne: "go test ./internal/cart/ -run {name}", junit: "gotestsum --junitfile {out} -- ./internal/cart/", typecheck: "go vet ./..." },
  },
};

function project(lang) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  if (lang) {
    fs.mkdirSync(path.join(dir, ".factory"));
    fs.writeFileSync(path.join(dir, ".factory", "config.json"), JSON.stringify(CONFIGS[lang]));
  }
  return dir;
}
function guard(role, dir, tool_name, tool_input, extraArgs = []) {
  const r = spawnSync("node", [GUARD, role, ...extraArgs], { input: JSON.stringify({ cwd: dir, tool_name, tool_input }), encoding: "utf8" });
  return r.status;
}
const ALLOW = 0, BLOCK = 2;
const bash = (role, dir, command) => guard(role, dir, "Bash", { command });
const write = (role, dir, file_path) => guard(role, dir, "Write", { file_path });

const ts = project("ts"), py = project("py"), go = project("go");

test("writes: each role only in its own paths", () => {
  assert.equal(write("tester", ts, "tests/01-a.test.ts"), ALLOW);
  assert.equal(write("tester", ts, "src/cart.ts"), BLOCK);
  assert.equal(write("implementer", ts, "src/cart.ts"), ALLOW);
  assert.equal(write("implementer", ts, "tests/01-a.test.ts"), BLOCK);
  assert.equal(write("implementer", ts, "SPEC.md"), BLOCK);
  assert.equal(write("implementer", ts, ".factory/config.json"), BLOCK);
  assert.equal(write("implementer", ts, "package.json"), BLOCK);
  assert.equal(write("implementer", ts, "../outside.ts"), BLOCK);
  assert.equal(write("reviewer", ts, "src/cart.ts"), BLOCK);
  assert.equal(write("test-reviewer", ts, "tests/01-a.test.ts"), BLOCK);
});

test("writes: a test file inside a source path is a test file (Go)", () => {
  assert.equal(write("implementer", go, "internal/cart/cart.go"), ALLOW);
  assert.equal(write("implementer", go, "internal/cart/t01_a_test.go"), BLOCK);
  assert.equal(write("tester", go, "internal/cart/t01_a_test.go"), ALLOW);
  assert.equal(write("tester", go, "internal/cart/cart.go"), BLOCK);
});

test("codex apply_patch: every file in the patch is checked", () => {
  const patch = (...files) => ({ command: "*** Begin Patch\n" + files.map((f) => `*** Update File: ${f}\n@@\n-a\n+b`).join("\n") + "\n*** End Patch" });
  assert.equal(guard("implementer", ts, "apply_patch", patch("src/cart.ts")), ALLOW);
  assert.equal(guard("implementer", ts, "apply_patch", patch("src/cart.ts", "tests/01-a.test.ts")), BLOCK);
  assert.equal(guard("implementer", ts, "apply_patch", { command: "nothing here" }), BLOCK);
});

test("project commands: allowed exactly as the config writes them", () => {
  assert.equal(bash("tester", ts, "npx vitest run"), ALLOW);
  assert.equal(bash("tester", ts, "npx vitest run tests/01-a.test.ts"), ALLOW);
  assert.equal(bash("implementer", ts, 'npx vitest run tests/01-a.test.ts -t "empty cart"'), ALLOW);
  assert.equal(bash("implementer", ts, "npx vitest run tests/01-a.test.ts -t empty cart"), ALLOW);
  assert.equal(bash("implementer", ts, "npx tsc --noEmit"), ALLOW);
  assert.equal(bash("tester", ts, "npx tsc --noEmit"), BLOCK);
  assert.equal(bash("implementer", py, "python -m pytest -q tests/test_01_a.py -k empty"), ALLOW);
  assert.equal(bash("implementer", go, "go test ./internal/cart/ -run TestEmpty"), ALLOW);
  assert.equal(bash("reviewer", ts, "npx vitest run"), BLOCK);
  assert.equal(bash("test-reviewer", ts, "npx vitest run"), BLOCK);
});

test("project commands: no extra options, no paths outside the project", () => {
  assert.equal(bash("implementer", ts, "npx vitest run --reporter=json --outputFile=tests/01-a.test.ts"), BLOCK);
  assert.equal(bash("implementer", ts, "npx vitest run tests/01-a.test.ts --outputFile=src/x.ts"), BLOCK);
  assert.equal(bash("implementer", ts, "npx vitest run --root=../other"), BLOCK);
  assert.equal(bash("implementer", ts, "npx vitest run ../other/a.test.ts"), BLOCK);
  assert.equal(bash("implementer", ts, "npx vitest run tests/a.test.ts -t x --update"), BLOCK);
  assert.equal(bash("implementer", ts, "npx tsc --noEmit --outDir src"), BLOCK);
  assert.equal(bash("implementer", ts, "npx vitest"), BLOCK);
  assert.equal(bash("implementer", ts, "npm install left-pad"), BLOCK);
});

test("shell operators and line breaks are blocked", () => {
  for (const c of ["git status; rm -rf src", "git status && touch x", "git status | tee x", "git log > x", "git status `id`", "git status $(id)", "git status\ntouch src/pwned.ts", "git status\r\ntouch x"]) {
    assert.equal(bash("reviewer", ts, c), BLOCK, c);
  }
});

test("git: read-only subcommands only, without writing or outside-reading options", () => {
  assert.equal(bash("reviewer", ts, "git status"), ALLOW);
  assert.equal(bash("reviewer", ts, "git diff abc123 HEAD -- src"), ALLOW);
  assert.equal(bash("reviewer", ts, "git log --oneline"), ALLOW);
  assert.equal(bash("reviewer", ts, "git show HEAD:src/cart.ts"), ALLOW);
  assert.equal(bash("reviewer", ts, "git diff --output=tests/a.test.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "git diff --output tests/a.test.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "git diff --no-index /etc/passwd /dev/null"), BLOCK);
  assert.equal(bash("reviewer", ts, "git diff --ext-diff"), BLOCK);
  assert.equal(bash("reviewer", ts, "git commit -m x"), BLOCK);
  assert.equal(bash("reviewer", ts, "git checkout ."), BLOCK);
  assert.equal(bash("reviewer", ts, "git -C /tmp status"), BLOCK);
  assert.equal(bash("implementer", ts, "git add ."), BLOCK);
});

test("read-only file commands: inside the project, no writing or executing options", () => {
  assert.equal(bash("reviewer", ts, "cat src/cart.ts"), ALLOW);
  assert.equal(bash("reviewer", ts, "rg priceCart src"), ALLOW);
  assert.equal(bash("reviewer", ts, "sed -n 1,40p src/cart.ts"), ALLOW);
  assert.equal(bash("reviewer", ts, "sed -n '10,$p' src/cart.ts"), ALLOW);
  assert.equal(bash("reviewer", ts, "find src -name *.ts"), ALLOW);
  assert.equal(bash("reviewer", ts, "cat /etc/passwd"), BLOCK);
  assert.equal(bash("reviewer", ts, "cat ../other/secret"), BLOCK);
  assert.equal(bash("reviewer", ts, "cat ~/.ssh/id_rsa"), BLOCK);
  assert.equal(bash("reviewer", ts, "rg --pre=./src/x.sh foo"), BLOCK);
  assert.equal(bash("reviewer", ts, "rg --pre ./src/x.sh foo"), BLOCK);
  assert.equal(bash("reviewer", ts, "sed -i s/a/b/ src/cart.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "sed -n w.factory/config.json src/cart.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "sed -n '1e touch x' src/cart.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "sed s/a/b/ src/cart.ts"), BLOCK);
  assert.equal(bash("reviewer", ts, "find src -delete"), BLOCK);
  assert.equal(bash("reviewer", ts, "find src -exec rm {} +"), BLOCK);
  assert.equal(bash("reviewer", ts, "find src -fprint0 tests/x"), BLOCK);
  assert.equal(bash("reviewer", ts, "tree -o tests/x"), BLOCK);
  assert.equal(bash("reviewer", ts, "rm -rf src"), BLOCK);
});

test("codex shell wrappers: the inner command is judged", () => {
  assert.equal(guard("reviewer", ts, "shell", { command: ["bash", "-lc", "git status"] }), ALLOW);
  assert.equal(guard("reviewer", ts, "shell", { command: ["bash", "-lc", "git status; rm -rf src"] }), BLOCK);
  assert.equal(guard("reviewer", ts, "shell", { command: ["bash", "-lc", "rm -rf src"] }), BLOCK);
});

test("checkpoint: implementer only, cycle or --fix, never --start", () => {
  assert.equal(bash("implementer", ts, "factory-checkpoint 01-a empty cart"), ALLOW);
  assert.equal(bash("implementer", ts, "factory-checkpoint --fix 01-a typecheck error"), ALLOW);
  assert.equal(bash("implementer", ts, "factory-checkpoint --start 01-a"), BLOCK);
  assert.equal(bash("implementer", ts, "factory-checkpoint --fix --start 01-a"), BLOCK);
  assert.equal(bash("tester", ts, "factory-checkpoint 01-a empty cart"), BLOCK);
});

test("read tools: inside the project only", () => {
  assert.equal(guard("reviewer", ts, "Read", { file_path: "src/cart.ts" }), ALLOW);
  assert.equal(guard("reviewer", ts, "Read", { file_path: "/etc/passwd" }), BLOCK);
  assert.equal(guard("reviewer", ts, "Grep", { pattern: "x", path: "../other" }), BLOCK);
  assert.equal(guard("reviewer", ts, "Glob", { pattern: "src/**/*.ts" }), ALLOW);
  assert.equal(guard("reviewer", ts, "Glob", { pattern: "/etc/**" }), BLOCK);
  assert.equal(guard("reviewer", ts, "Glob", { pattern: "../**/*.env" }), BLOCK);
});

test("default deny: unknown tools, unknown roles, no config, bad input", () => {
  assert.equal(guard("reviewer", ts, "WebFetch", { url: "https://example.com" }), BLOCK);
  assert.equal(guard("reviewer", ts, "mcp__anything__do", {}), BLOCK);
  assert.equal(guard("verifier", ts, "Read", { file_path: "src/cart.ts" }), BLOCK);
  assert.equal(guard("boss", ts, "Read", { file_path: "src/cart.ts" }), BLOCK);
  assert.equal(guard("implementer", project(null), "Read", { file_path: "src/cart.ts" }), BLOCK);
  assert.equal(spawnSync("node", [GUARD, "implementer"], { input: "not json", encoding: "utf8" }).status, BLOCK);
});

test("the config snapshot wins over the file on disk", () => {
  const dir = project("ts");
  const snap = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "snap-")), "config.json");
  fs.copyFileSync(path.join(dir, ".factory", "config.json"), snap);
  // The role (or code it ran) loosens the config on disk: the guard must not follow it.
  const loose = { ...CONFIGS.ts, paths: { src: ["**"], tests: [] } };
  fs.writeFileSync(path.join(dir, ".factory", "config.json"), JSON.stringify(loose));
  assert.equal(guard("implementer", dir, "Write", { file_path: "tests/01-a.test.ts" }, [snap]), BLOCK);
  assert.equal(guard("implementer", dir, "Write", { file_path: "src/cart.ts" }, [snap]), ALLOW);
});

test("a block is logged to .factory/violations.log", () => {
  const dir = project("ts");
  write("implementer", dir, "tests/x.test.ts");
  assert.match(fs.readFileSync(path.join(dir, ".factory", "violations.log"), "utf8"), /implementer\tWrite/);
});

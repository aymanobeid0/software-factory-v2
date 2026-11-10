#!/usr/bin/env bash
# Run one factory role as its own isolated agent process, in the current project.
# Usage: bash <factory>/run-role.sh <tester|test-reviewer|implementer|reviewer> "<prompt>"
# (There is no verifier role: verification is a script, <factory>/verify.mjs.)
# Runtime: chosen by setup.sh and saved in <factory>/runtime.conf (runtime=claude|codex, optional
# codex_model=...). FACTORY_RUNTIME / FACTORY_CODEX_MODEL override it for one run.
# Output is printed and also saved to .factory/logs/<n>-<role>.txt
#
# Portable: the factory locates itself from this script; the project is the current directory and its
# language-specific commands come from .factory/config.json. Nothing is tied to one machine.
set -euo pipefail
role="$1"; prompt="$2"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
conf() { [ -f "$here/runtime.conf" ] && sed -n "s/^$1=//p" "$here/runtime.conf" | tr -d '\r' | head -1; }
runtime="${FACTORY_RUNTIME:-$(conf runtime)}"; runtime="${runtime:-claude}"
FACTORY_CODEX_MODEL="${FACTORY_CODEX_MODEL:-$(conf codex_model)}"
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ -f .factory/config.json ] || { echo "No .factory/config.json here. Run /factory-plan first." >&2; exit 1; }
[ -f "$here/roles/$role.md" ] || { echo "unknown role: $role" >&2; exit 1; }
mkdir -p .factory/logs
n=$(ls .factory/logs 2>/dev/null | wc -l | tr -d ' ')
log=".factory/logs/$(printf '%02d' "$n")-$role.txt"

case "$role" in
  tester)      skills="engineering/tdd/SKILL.md engineering/tdd/tests.md engineering/tdd/mocking.md"; tools="Read,Grep,Glob,Write,Edit,Bash" ;;
  implementer) skills="engineering/implement/SKILL.md engineering/tdd/SKILL.md"; tools="Read,Grep,Glob,Write,Edit,Bash" ;;
  reviewer)    skills="engineering/code-review/SKILL.md"; tools="Read,Grep,Glob,Bash" ;;
  test-reviewer) skills="engineering/tdd/tests.md engineering/tdd/mocking.md"; tools="Read,Grep,Glob,Bash" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
guard="$(native "$here/hooks/guard.mjs")"
# The role's rules come from the config as frozen in git, copied outside the project for this run, so
# nothing the role does or runs can loosen its own guard.
git show HEAD:.factory/config.json > "$tmp/config.json" 2>/dev/null || cp .factory/config.json "$tmp/config.json"
cfgsnap="$(native "$tmp/config.json")"
export FACTORY_CONFIG_SNAPSHOT="$cfgsnap"

# Instructions for the role: its definition, the project's setup, then its Matt skills.
{
  cat "$here/roles/$role.md"
  echo
  echo "# Project setup (from .factory/config.json, frozen with the plan)"
  echo
  node -e '
    const c = JSON.parse(require("fs").readFileSync(process.env.FACTORY_CONFIG_SNAPSHOT,"utf8"));
    const cmd = c.commands;
    const lines = [
      `Language: ${c.language || "unspecified"}`,
      `Source paths (implementer writes here): ${c.paths.src.join(", ")}`,
      `Test paths (tester writes here; a file matching these is a test file even inside a source path): ${c.paths.tests.join(", ")}`,
      `Test file for a ticket: ${c.testFile}   ({ticket} = ticket stem like 02-bulk-discount, {ticket_snake} = 02_bulk_discount)`,
      `Run all tests: ${cmd.test}`,
      `Run one test file: ${cmd.testFile}`,
      `Run one test: ${cmd.testOne}`,
      `Typecheck: ${cmd.typecheck || "none for this project"}`,
    ];
    console.log(lines.map(l => "- " + l).join("\n"));'
  if [ "$role" = implementer ]; then
    echo "- Checkpoint (the referee, already on your PATH): factory-checkpoint <ticket> <words from the test name>"
    echo "- Fix checkpoint (a change no red test asks for): factory-checkpoint --fix <ticket> <what was fixed>"
  fi
  if [ -n "$skills" ]; then
    echo
    echo "# Matt Pocock's skills for your role (included here: follow them, no need to open the files)"
    echo
    echo "These are the binding method for your work. Where they conflict with your role's boundaries"
    echo "(for example a step that belongs to another role), the role boundaries win."
    for s in $skills; do
      [ -f "$here/matt-skills/$s" ] || { echo "missing skill file: $here/matt-skills/$s" >&2; exit 1; }
      echo
      echo "======== MATT SKILL FILE: $s ========"
      cat "$here/matt-skills/$s"
    done
  fi
} > "$tmp/system.md"

# Role processes get the referee and any project tool dirs (e.g. a Python venv) on PATH.
# (bash builds PATH itself so the separator and path style are right on every OS)
while IFS= read -r d; do
  d="${d%$'\r'}"
  [ -n "$d" ] && [ -d "$d" ] && PATH="$(cd "$d" && pwd):$PATH"
done < <(node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.FACTORY_CONFIG_SNAPSHOT,"utf8"));for(const d of (c.env?.pathPrepend||[]))console.log(d)')
export PATH="$here/bin:$PATH"
export FACTORY_ROLE="$role"

case "$runtime" in
  claude)
    cat > "$tmp/settings.json" <<EOF
{ "hooks": { "PreToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node \"$guard\" $role \"$cfgsnap\"" } ] } ] } }
EOF
    # The prompt goes in on stdin: the tool flags are variadic and would swallow a trailing argument.
    printf '%s' "$prompt" | claude -p \
      --settings "$(native "$tmp/settings.json")" \
      --append-system-prompt-file "$(native "$tmp/system.md")" \
      --tools "$tools" \
      --allowedTools "$tools" \
      --disallowedTools "WebFetch,WebSearch,Agent,Task" \
      2>&1 | tee "$log"
    ;;
  codex)
    # Codex has no system-prompt file flag, so the role's instructions lead the prompt.
    { cat "$tmp/system.md"; printf '\n\n# Your task\n\n%s\n' "$prompt"; } > "$tmp/prompt.md"
    # The guard runs as a PreToolUse hook (Bash and apply_patch). It is injected for this one run, so it
    # needs --dangerously-bypass-hook-trust (it only skips the trust prompt; the hook is the factory's own).
    # workspace-write keeps writes inside the project (plus .git, so the referee can commit).
    model=(); [ -n "${FACTORY_CODEX_MODEL:-}" ] && model=(-m "$FACTORY_CODEX_MODEL")
    codex exec "${model[@]}" \
      --skip-git-repo-check --ephemeral \
      -s workspace-write --add-dir "$(native "$(pwd)/.git")" \
      --dangerously-bypass-hook-trust \
      -c "hooks.PreToolUse=[{matcher=\"*\",hooks=[{type=\"command\",command='node \"$guard\" $role \"$cfgsnap\"'}]}]" \
      -c 'shell_environment_policy.inherit="all"' \
      - < "$tmp/prompt.md" 2>&1 | tee "$log"
    ;;
  *) echo "unknown FACTORY_RUNTIME: $runtime (use claude or codex)" >&2; exit 1 ;;
esac

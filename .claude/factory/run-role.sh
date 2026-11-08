#!/usr/bin/env bash
# Run one factory role as its own isolated Claude Code process, in the current project.
# Usage: bash <factory>/run-role.sh <tester|implementer|verifier|reviewer> "<prompt>"
# Output is printed and also saved to .factory/logs/<n>-<role>.txt
#
# Portable: the factory locates itself from this script (user install ~/.claude/factory, or a project
# install .claude/factory committed to the repo for cloud/CI). The project is the current directory and
# its language-specific commands come from .factory/config.json. Nothing is tied to one machine.
set -euo pipefail
role="$1"; prompt="$2"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# A path node and the hook runner both understand on every OS (C:/... on Windows, /... elsewhere).
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ -f .factory/config.json ] || { echo "No .factory/config.json here. Run /factory-plan first." >&2; exit 1; }
mkdir -p .factory/logs
n=$(ls .factory/logs 2>/dev/null | wc -l | tr -d ' ')
log=".factory/logs/$(printf '%02d' "$n")-$role.txt"

case "$role" in
  tester)      skills="engineering/tdd/SKILL.md engineering/tdd/tests.md engineering/tdd/mocking.md" ;;
  implementer) skills="engineering/implement/SKILL.md engineering/tdd/SKILL.md" ;;
  reviewer)    skills="engineering/code-review/SKILL.md" ;;
  verifier)    skills="" ;;
  *) echo "unknown role: $role" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Guard settings, generated with this machine's real paths.
guard="$(native "$here/hooks/guard.mjs")"
cat > "$tmp/settings.json" <<EOF
{ "hooks": { "PreToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node \"$guard\" $role" } ] } ] } }
EOF

# System prompt addition: the project's setup, then the role's Matt skills.
{
  echo "# Project setup (from .factory/config.json, frozen with the plan)"
  echo
  node -e '
    const c = JSON.parse(require("fs").readFileSync(".factory/config.json","utf8"));
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
  fi
  if [ -n "$skills" ]; then
    echo
    echo "# Matt Pocock's skills for your role (already loaded: follow them, no need to open the files)"
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
done < <(node -e 'const c=JSON.parse(require("fs").readFileSync(".factory/config.json","utf8"));for(const d of (c.env?.pathPrepend||[]))console.log(d)')
export PATH="$here/bin:$PATH"

# The prompt goes in on stdin: the tool flags are variadic and would swallow a trailing argument.
printf '%s' "$prompt" | claude -p \
  --agent "factory-$role" \
  --settings "$(native "$tmp/settings.json")" \
  --append-system-prompt-file "$(native "$tmp/system.md")" \
  --allowedTools "Read,Grep,Glob,Write,Edit,Bash,Skill" \
  --disallowedTools "WebFetch,WebSearch,Agent" \
  2>&1 | tee "$log"

#!/usr/bin/env bash
# Install the software factory into ANOTHER place. (This repo itself needs no install: open Claude Code here
# and everything in .claude/ is already available.)
#   ./install.sh                 user install:    ~/.claude/{factory,agents,skills}
#   ./install.sh <project-dir>   project install: <project-dir>/.claude/{factory,agents,skills}
#                                (commit it, and the factory runs in the cloud and in CI too)
# Options:
#   --no-matt-commands           don't install Matt Pocock's skills as slash commands
#                                (/tdd, /improve-codebase-architecture, /matt-code-review, ...)
# Re-running updates an existing install in place. Nothing outside those folders is touched.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

matt=1
target=""
for a in "$@"; do
  case "$a" in
    --no-matt-commands) matt=0 ;;
    -*) echo "unknown option: $a" >&2; exit 1 ;;
    *) target="$a" ;;
  esac
done

if [ -n "$target" ]; then
  [ -d "$target" ] || { echo "No such folder: $target" >&2; exit 1; }
  dst="$(cd "$target" && pwd)/.claude"
else
  dst="$HOME/.claude"
fi

for tool in node git claude; do
  command -v "$tool" >/dev/null 2>&1 || echo "warning: '$tool' is not on PATH; the factory needs it to run" >&2
done

mkdir -p "$dst/agents" "$dst/skills"
rm -rf "$dst/factory.new"
cp -r "$src/.claude/factory" "$dst/factory.new"
rm -rf "$dst/factory"
mv "$dst/factory.new" "$dst/factory"
cp "$src"/.claude/agents/factory-*.md "$dst/agents/"
for s in factory factory-plan; do
  rm -rf "$dst/skills/$s"
  cp -r "$src/.claude/skills/$s" "$dst/skills/$s"
done
chmod +x "$dst/factory/bin/"* "$dst/factory/"*.sh 2>/dev/null || true
echo "Software factory installed in $dst"

if [ "$matt" = 1 ]; then
  bash "$dst/factory/install-matt-commands.sh" "$dst/skills"
fi

echo "Next: open a new Claude Code session in your project and run /factory-plan"

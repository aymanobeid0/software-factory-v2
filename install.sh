#!/usr/bin/env bash
# Install the software factory.
#   ./install.sh                 user install:    ~/.claude/{factory,agents,skills}
#   ./install.sh <project-dir>   project install: <project-dir>/.claude/{factory,agents,skills}
#                                (commit it, and the factory runs in the cloud and in CI too)
# Re-running updates an existing install in place. Nothing outside those folders is touched.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -ge 1 ]; then
  [ -d "$1" ] || { echo "No such folder: $1" >&2; exit 1; }
  dst="$(cd "$1" && pwd)/.claude"
else
  dst="$HOME/.claude"
fi

for tool in node git claude; do
  command -v "$tool" >/dev/null 2>&1 || echo "warning: '$tool' is not on PATH; the factory needs it to run" >&2
done

mkdir -p "$dst/agents" "$dst/skills"
rm -rf "$dst/factory.new"
cp -r "$src/factory" "$dst/factory.new"
rm -rf "$dst/factory"
mv "$dst/factory.new" "$dst/factory"
cp "$src"/agents/factory-*.md "$dst/agents/"
for s in factory factory-plan; do
  rm -rf "$dst/skills/$s"
  cp -r "$src/skills/$s" "$dst/skills/$s"
done
chmod +x "$dst/factory/bin/"* "$dst/factory/"*.sh 2>/dev/null || true

echo "Software factory installed in $dst"
echo "Next: open Claude Code in your project and run /factory-plan"

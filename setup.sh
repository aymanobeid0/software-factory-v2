#!/usr/bin/env bash
# Set up the software factory for Claude Code or Codex.
#
#   ./setup.sh                      asks you: Claude or Codex, and where to install
#   ./setup.sh claude               Claude Code, for all your projects (~/.claude)
#   ./setup.sh codex                Codex, for all your projects (~/.agents)
#   ./setup.sh claude <project>     Claude Code, inside one project (<project>/.claude, commit it)
#   ./setup.sh codex  <project>     Codex, inside one project (<project>/.agents, commit it)
#
# Installs: the factory, the /factory-plan and /factory commands ($factory-plan, $factory in Codex),
# and Matt Pocock's skills as commands. Re-running updates in place.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

runtime="${1:-}"
target="${2:-}"

interactive=0
if [ -z "$runtime" ]; then
  interactive=1
  echo "Which agent will run the factory?"
  echo "  1) Claude Code"
  echo "  2) Codex"
  read -r -p "Choose 1 or 2: " c
  case "$c" in 1) runtime=claude ;; 2) runtime=codex ;; *) echo "Please choose 1 or 2." >&2; exit 1 ;; esac
  echo
  echo "Where?"
  echo "  1) For all my projects (in my home folder)"
  echo "  2) Inside one project (committed with it, so it also works in the cloud)"
  read -r -p "Choose 1 or 2: " w
  case "$w" in
    1) target="" ;;
    2) read -r -p "Project folder: " target ;;
    *) echo "Please choose 1 or 2." >&2; exit 1 ;;
  esac
fi

case "$runtime" in
  claude) dir=".claude"; cli=claude ;;
  codex)  dir=".agents"; cli=codex ;;
  *) echo "Unknown agent '$runtime': use claude or codex." >&2; exit 1 ;;
esac

if [ -n "$target" ]; then
  target="${target/#\~/$HOME}"
  [ -d "$target" ] || { echo "No such folder: $target" >&2; exit 1; }
  dst="$(cd "$target" && pwd)/$dir"
else
  dst="$HOME/$dir"
fi

for tool in node git "$cli"; do
  command -v "$tool" >/dev/null 2>&1 || echo "warning: '$tool' is not on PATH; the factory needs it to run" >&2
done

# 1. The factory itself.
mkdir -p "$dst/skills"
rm -rf "$dst/factory.new"
cp -r "$src/factory" "$dst/factory.new"
# The factory's own tests stay in this repo: in a project, its test runner (vitest, jest...) would pick
# them up and fail the project's full test run.
rm -rf "$dst/factory.new/tests"
rm -rf "$dst/factory"
mv "$dst/factory.new" "$dst/factory"
chmod +x "$dst/factory/bin/"* "$dst/factory/"*.sh 2>/dev/null || true

# 2. The runtime choice: which CLI runs the roles.
codex_model=""
if [ "$runtime" = codex ] && [ "$interactive" = 1 ]; then
  read -r -p "Codex model for the roles (Enter = your Codex default): " codex_model
fi
{
  echo "runtime=$runtime"
  [ -n "$codex_model" ] && echo "codex_model=$codex_model"
} > "$dst/factory/runtime.conf"

# 3. The /factory-plan and /factory commands.
for s in factory factory-plan; do
  rm -rf "$dst/skills/$s"
  cp -r "$src/skills/$s" "$dst/skills/$s"
done

# 4. Matt Pocock's skills as commands.
if [ "$runtime" = codex ]; then
  bash "$dst/factory/install-matt-commands.sh" --codex "$dst/skills"
else
  bash "$dst/factory/install-matt-commands.sh" "$dst/skills"
fi

echo
echo "Done: the software factory is set up for $runtime in $dst"
if [ "$runtime" = codex ]; then
  echo "Next: open a new Codex session in your project and run \$factory-plan"
else
  echo "Next: open a new Claude Code session in your project and run /factory-plan"
fi

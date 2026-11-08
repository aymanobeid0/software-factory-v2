#!/usr/bin/env bash
# Install Matt Pocock's skills as slash commands (/tdd, /improve-codebase-architecture, ...) from the
# factory's pinned copy, so they work with or without the plugin.
#   bash <factory>/install-matt-commands.sh                 -> ~/.claude/skills
#   bash <factory>/install-matt-commands.sh <skills-dir>    -> e.g. <project>/.claude/skills
#
# - Installs the engineering, productivity and misc skills (not in-progress or deprecated).
# - Matt's `code-review` would clash with Claude Code's built-in /code-review, so it is installed as
#   /matt-code-review, and the references to it inside Matt's other skills are updated to match.
# - Re-running refreshes them. A manifest records what this script installed, so it only ever replaces
#   or removes its own folders, never a skill you made yourself.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/matt-skills"
dst="${1:-$HOME/.claude/skills}"
manifest="$dst/.matt-commands-manifest"
CATEGORIES="engineering productivity misc"
declare -A RENAME=([code-review]=matt-code-review)

[ -d "$src/engineering" ] || { echo "No pinned skills at $src. Run update-matt-skills.sh first." >&2; exit 1; }
mkdir -p "$dst"

# Remove what a previous run installed (and only that).
if [ -f "$manifest" ]; then
  while IFS= read -r n; do
    n="${n%$'\r'}"
    [ -n "$n" ] && [ -d "$dst/$n" ] && rm -rf "${dst:?}/$n"
  done < "$manifest"
fi

installed=()
skipped=()
for cat in $CATEGORIES; do
  for d in "$src/$cat"/*/; do
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    target="${RENAME[$name]:-$name}"
    if [ -e "$dst/$target" ]; then
      skipped+=("$target"); continue    # someone else's skill with that name: leave it alone
    fi
    cp -r "$d" "$dst/$target"
    rm -rf "$dst/$target/agents"          # Codex/OpenAI metadata, not used by Claude Code
    installed+=("$target")
  done
done

# Apply renames inside the installed copies (frontmatter name + references from other skills).
for n in "${installed[@]}"; do
  for from in "${!RENAME[@]}"; do
    to="${RENAME[$from]}"
    find "$dst/$n" -type f -name '*.md' -print0 | xargs -0 sed -i \
      -e "s/^name: $from\$/name: $to/" \
      -e "s/Skill tool with \"$from\"/Skill tool with \"$to\"/g" \
      -e "s#/$from\b#/$to#g" \
      -e "s/\`$from\` skill/\`$to\` skill/g"
  done
done

printf '%s\n' "${installed[@]}" > "$manifest"
echo "Installed ${#installed[@]} Matt Pocock commands into $dst"
[ ${#skipped[@]} -gt 0 ] && echo "Skipped (a skill with that name already exists there): ${skipped[*]}"
echo "Start a new Claude Code session to see them, e.g. /improve-codebase-architecture"

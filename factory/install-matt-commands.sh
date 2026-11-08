#!/usr/bin/env bash
# Install Matt Pocock's skills as commands from the factory's pinned copy, so they work with or
# without any plugin.
#   bash <factory>/install-matt-commands.sh                      -> ~/.claude/skills   (Claude Code: /tdd)
#   bash <factory>/install-matt-commands.sh <skills-dir>         -> e.g. <project>/.claude/skills
#   bash <factory>/install-matt-commands.sh --codex              -> ~/.agents/skills   (Codex: $tdd)
#   bash <factory>/install-matt-commands.sh --codex <skills-dir> -> e.g. <project>/.agents/skills
#
# - Installs the engineering, productivity and misc skills (not in-progress or deprecated).
# - Matt's `code-review` would clash with Claude Code's built-in /code-review, so it is installed as
#   matt-code-review (on both runtimes, to keep one name), and references to it are updated.
# - Discovery and planning skills get a closing "Send to the factory?" step (send-to-factory.md):
#   if the user agrees, the result lands in .factory/inbox/ and /factory-plan offers to start from it.
# - Re-running refreshes them. A manifest records what this script installed, so it only ever replaces
#   or removes its own folders, never a skill you made yourself.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/matt-skills"

runtime=claude
dst=""
for a in "$@"; do
  case "$a" in
    --codex) runtime=codex ;;
    -*) echo "unknown option: $a" >&2; exit 1 ;;
    *) dst="$a" ;;
  esac
done
if [ -z "$dst" ]; then
  if [ "$runtime" = codex ]; then dst="$HOME/.agents/skills"; else dst="$HOME/.claude/skills"; fi
fi
manifest="$dst/.matt-commands-manifest"
CATEGORIES="engineering productivity misc"
declare -A RENAME=([code-review]=matt-code-review)
# Skills whose result can become factory work. Building blocks used inside other skills (grilling,
# domain-modeling, codebase-design, tdd, implement...) are left out so the question isn't asked twice.
SEND_TO_FACTORY="improve-codebase-architecture grill-me grill-with-docs diagnosing-bugs triage prototype research wayfinder to-spec to-tickets matt-code-review"

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
    # agents/openai.yaml is Codex metadata (display name, implicit-invocation policy): keep it for Codex only.
    [ "$runtime" = claude ] && rm -rf "$dst/$target/agents"
    installed+=("$target")
  done
done

# Apply renames inside the installed copies (frontmatter name + references from other skills).
for n in "${installed[@]}"; do
  for from in "${!RENAME[@]}"; do
    to="${RENAME[$from]}"
    find "$dst/$n" -type f \( -name '*.md' -o -name '*.yaml' \) -print0 | xargs -0 sed -i \
      -e "s/^name: $from\$/name: $to/" \
      -e "s/Skill tool with \"$from\"/Skill tool with \"$to\"/g" \
      -e "s#/$from\b#/$to#g" \
      -e "s/\`$from\` skill/\`$to\` skill/g"
  done
done

# Add the closing "Send to the factory?" step.
for n in $SEND_TO_FACTORY; do
  [ -f "$dst/$n/SKILL.md" ] && printf '%s' " ${installed[*]} " | grep -q " $n " && cat "$here/send-to-factory.md" >> "$dst/$n/SKILL.md"
done

printf '%s\n' "${installed[@]}" > "$manifest"
echo "Installed ${#installed[@]} Matt Pocock commands for $runtime into $dst"
[ ${#skipped[@]} -gt 0 ] && echo "Skipped (a skill with that name already exists there): ${skipped[*]}"
if [ "$runtime" = codex ]; then
  echo "Start a new Codex session to see them, e.g. \$improve-codebase-architecture"
else
  echo "Start a new Claude Code session to see them, e.g. /improve-codebase-architecture"
fi

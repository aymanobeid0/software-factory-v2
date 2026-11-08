#!/usr/bin/env bash
# Replace the factory's pinned copy of Matt Pocock's skills with the latest from GitHub.
# Usage: bash <factory>/update-matt-skills.sh   (the factory folder setup.sh installed: .claude/factory or .agents/factory)
# Nothing from the download is executed: it is cloned into a fresh temp folder and only files are copied.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dst="$here/matt-skills"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone -q --depth 1 https://github.com/mattpocock/skills.git "$tmp/repo"
commit="$(git -C "$tmp/repo" log -1 --format='%H (%cd)' --date=short)"
test -f "$tmp/repo/skills/engineering/tdd/SKILL.md" || { echo "Unexpected repo layout, pinned copy left unchanged." >&2; exit 1; }

rm -rf "$dst.new"
mkdir -p "$dst.new"
cp -r "$tmp/repo/skills/." "$dst.new/"
cp "$tmp/repo/LICENSE" "$dst.new/LICENSE"
cat > "$dst.new/SOURCE.md" <<EOF
Pinned copy of Matt Pocock's skills (MIT, see LICENSE), used by the software factory.
Source: https://github.com/mattpocock/skills, commit $commit
Updated: $(date +%F) by update-matt-skills.sh
Roles read skills from here by absolute path, so the factory works whether or not the plugin is installed.
EOF

rm -rf "$dst.old"
[ -d "$dst" ] && mv "$dst" "$dst.old"
mv "$dst.new" "$dst"
rm -rf "$dst.old"
echo "matt-skills updated to $commit"

# Refresh the slash commands wherever install-matt-commands.sh put them before.
skills_dir="$(cd "$here/.." && pwd)/skills"
if [ -f "$skills_dir/.matt-commands-manifest" ]; then
  if grep -q '^runtime=codex' "$here/runtime.conf" 2>/dev/null; then
    bash "$here/install-matt-commands.sh" --codex "$skills_dir"
  else
    bash "$here/install-matt-commands.sh" "$skills_dir"
  fi
fi

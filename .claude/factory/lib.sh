# Shell helpers for the orchestrator. Usage: source <factory>/lib.sh  (from the project root).
# Locates the factory itself; the project's language comes from .factory/config.json.
CO="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
FACTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RR="$FACTORY/run-role.sh"
CP="$FACTORY/checkpoint.mjs"

state() { # state '<js mutating s>'
  node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('.factory/state.json'));$1;fs.writeFileSync('.factory/state.json',JSON.stringify(s,null,2)+'\n');"
}
handoff_commit() { # $1 label
  state "s.last_commit=require('child_process').execSync('git rev-parse --short HEAD').toString().trim()"
  git add .factory && git commit -q -m "factory: handoff ($1)

$CO" 2>&1 | grep -v warning || true
}
violations() { cat .factory/violations.log 2>/dev/null || echo "no violations"; }

# The test file for a ticket, from config.testFile.
test_file() { node "$FACTORY/lib/cli.mjs" testfile "$1"; }

run_ticket() { # $1 ticket  $2 done-list  $3 later-list  $4 plan  $5 tests_commit
  local t="$1" tf
  tf="$(test_file "$t")"
  handoff_commit "before $t"
  local S; S=$(git rev-parse --short HEAD); echo "### $t ticket_start=$S"
  node "$CP" --start "$t"
  bash "$RR" implementer "Plan commit: $4. Frozen tests commit: $5. Spec: SPEC.md. Glossary: GLOSSARY.md. YOUR ONE TICKET: $t (tickets/$t.md, test file $tf). Tickets already done (must stay green): $2. The checkpoint log for this ticket has been started." | tail -14
  echo "--- commits:"; git log --oneline "$S..HEAD"; git status --short; violations
  echo "--- verifier:"
  bash "$RR" verifier "mode: ticket. Ticket just done: $t ($tf). Earlier done tickets: $2. Later tickets: $3. tests_commit: $5. plan_commit: $4. ticket_start: $S." | grep -vE '^```$'
}

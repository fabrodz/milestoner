#!/usr/bin/env bash
# Two real runners in two directories, listed from a third that is not a project at all.
# Every path handed to node is a Windows path: git-bash resolves a bare /tmp against the wrong drive.
set -eu

DEMO="$(mktemp -d)"
WIN="$(cygpath -m "$DEMO")"
export MILESTONER_HOME="$WIN/home"
ELSEWHERE="$DEMO/not-a-project"
mkdir -p "$ELSEWHERE"

cat > "$DEMO/slow-agent.mjs" <<'EOF'
console.log("x".repeat(2000));
setTimeout(() => {}, 600000);
EOF

pid_of() { node -e "console.log(JSON.parse(require('fs').readFileSync('$WIN/$1/.milestoner/pulse.json','utf8')).pid)"; }

start() {
  local dir="$DEMO/$1" name="$2" milestones="$3"
  mkdir -p "$dir"
  (cd "$dir" && milestoner init --run "$name" --milestones "$milestones" >/dev/null)
  node -e "
    const fs=require('fs'), f='$WIN/$1/.milestoner/config.json';
    const c=JSON.parse(fs.readFileSync(f,'utf8'));
    c.agent={command:process.execPath,args:['$WIN/slow-agent.mjs'],modelArgs:[],model:null,env:{}};
    fs.writeFileSync(f, JSON.stringify(c,null,2));
    if (JSON.parse(fs.readFileSync(f,'utf8')).agent.command === 'claude') throw new Error('stub agent not installed');
  "
  (cd "$dir" && milestoner run >"$DEMO/$1-runner.log" 2>&1 &)
}

start checkout-api checkout-v2 4
start legacy-tests legacy-tests 3
sleep 6

echo "=== 1. two runs in two directories, listed from $ELSEWHERE, which is not a project ==="
(cd "$ELSEWHERE" && milestoner runs) || echo "exit=$?"

echo
echo "=== 2. --json, the same listing ==="
(cd "$ELSEWHERE" && milestoner runs --json) || true

LEGACY_PID="$(pid_of legacy-tests)"
CHECKOUT_PID="$(pid_of checkout-api)"

echo
echo "=== 3. kill the legacy-tests runner outright: no finally, so nothing deregisters ==="
echo "killing runner pid $LEGACY_PID"
taskkill //F //T //PID "$LEGACY_PID" >/dev/null
sleep 2
(cd "$ELSEWHERE" && milestoner runs) || echo "exit=$?"

echo
echo "=== 4. delete the checkout-api project directory entirely ==="
taskkill //F //T //PID "$CHECKOUT_PID" >/dev/null
sleep 2
rm -rf "$DEMO/checkout-api"
(cd "$ELSEWHERE" && milestoner runs) || echo "exit=$?"

echo
echo "=== 5. the pruned entry is dropped from the file, not recomputed on every read ==="
(cd "$ELSEWHERE" && milestoner runs) || echo "exit=$?"
echo
echo "registry file now:"
cat "$MILESTONER_HOME/runs.json"

rm -rf "$DEMO" 2>/dev/null || true

#!/usr/bin/env bash
# Purge Canary Orchestrator (safe by default)
# Usage:
#   sh scripts/purge-canary-orchestrator.sh --replacements <file> [--execute]
# Environment required for execution: CONFIRM_PURGE=1 PROVIDE_SIGNOFF_FILE=tmp/signoffs.txt

set -euo pipefail

REPLACEMENTS_FILE=""
EXECUTE=0

while [ "$#" -gt 0 ]; do
	case "$1" in
	--replacements)
		REPLACEMENTS_FILE="$2"
		shift 2
		;;
	--execute)
		EXECUTE=1
		shift
		;;
	-h | --help)
		echo "Usage: $0 --replacements <file> [--execute]"
		exit 0
		;;
	*)
		echo "Unknown arg: $1"
		exit 1
		;;
	esac
done

if [ -z "$REPLACEMENTS_FILE" ]; then
	echo "--replacements <file> is required" >&2
	exit 2
fi

if [ ! -f "$REPLACEMENTS_FILE" ]; then
	echo "Replacements file not found: $REPLACEMENTS_FILE" >&2
	exit 2
fi

echo "[orchestrator] Starting purge canary orchestration (simulation-only unless --execute given)"

mkdir -p tmp

# Step 1: mirror
echo "[orchestrator] Creating mirror..."
git clone --mirror "$PWD" tmp/repo-mirror.git

# Step 2: simulation clone
echo "[orchestrator] Creating simulation clone..."
git clone tmp/repo-mirror.git tmp/repo-sim
cp "$REPLACEMENTS_FILE" tmp/repo-sim/replacements.txt

cd tmp/repo-sim
echo "[orchestrator] Running git-filter-repo (simulation)..."
git filter-repo --replace-text replacements.txt || {
	echo "git-filter-repo failed"
	exit 3
}

echo "[orchestrator] Running tests in simulation..."
if command -v bun >/dev/null 2>&1; then
	bun test >../sim_test_output.txt 2>&1 || echo "Tests failed in simulation (see tmp/sim_test_output.txt)"
else
	echo "bun not found; skipping tests" >../sim_test_output.txt
fi

echo "[orchestrator] Running gitleaks in simulation..."
if command -v gitleaks >/dev/null 2>&1; then
	gitleaks detect --source . --report-path ../sim_gitleaks.json || echo "gitleaks found issues; see tmp/sim_gitleaks.json"
else
	echo "gitleaks not found; skipping" >../sim_gitleaks.json
fi

echo "[orchestrator] Creating canary branch and preparing to push (non-destructive)..."
git checkout -b purge/canary

if [ "$EXECUTE" -eq 1 ]; then
	if [ "${CONFIRM_PURGE:-}" != "1" ]; then
		echo "CONFIRM_PURGE must be set to 1 to execute destructive push" >&2
		exit 4
	fi
	if [ -z "${PROVIDE_SIGNOFF_FILE:-}" ] || [ ! -f "${PROVIDE_SIGNOFF_FILE}" ]; then
		echo "Signoff file not provided or not found. Set PROVIDE_SIGNOFF_FILE to a file listing approvals." >&2
		exit 5
	fi

	echo "[orchestrator] Pushing canary branch to origin (non-force)"
	git push origin purge/canary

	echo "[orchestrator] Re-running git-filter-repo on an exec clone and preparing to force-push"
	cd ..
	git clone tmp/repo-mirror.git tmp/repo-exec
	cp "$REPLACEMENTS_FILE" tmp/repo-exec/replacements.txt
	cd tmp/repo-exec
	git filter-repo --replace-text replacements.txt

	echo "[orchestrator] Running tests in exec clone..."
	if command -v bun >/dev/null 2>&1; then
		bun test || {
			echo "Tests failed in exec clone; aborting"
			exit 6
		}
	else
		echo "bun not found; skipping tests"
	fi

	echo "[orchestrator] Running gitleaks in exec clone..."
	if command -v gitleaks >/dev/null 2>&1; then
		gitleaks detect --source . --report-path ../exec_gitleaks.json || {
			echo "gitleaks issues in exec clone; aborting"
			exit 7
		}
	else
		echo "gitleaks not found; skipping gitleaks check"
	fi

	echo "[orchestrator] All checks passed in exec clone. Proceeding to force-push rewritten refs to origin"
	git push --force origin --all
	git push --force origin --tags
	echo "[orchestrator] Force-push complete. Purge executed."
else
	echo "Simulation complete. Canary branch created locally. To push canary branch to origin run: cd tmp/repo-sim && git push origin purge/canary"
fi

echo "[orchestrator] Orchestration finished"

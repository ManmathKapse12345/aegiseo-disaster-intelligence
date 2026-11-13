#!/usr/bin/env bash
# Builds the complete DiP submission for every team member from a clean slate.
#   bash make_submission.sh
# Member prefixes (Name_RollNumber) are listed below; author details come from paper/authors.json.
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-C:/Python314/python.exe}"
MEMBERS=(MANMATH_KAPSE_23CD3024 PRAVESH_KUMAR_PATEL_23CD3029)

rm -rf ../submission
node render_diagrams.cjs
for p in "${MEMBERS[@]}"; do
  PREFIX="$p" node build_paper.cjs
  PREFIX="$p" node build_components.cjs
  PREFIX="$p" "$PY" -W ignore prepare_submission.py
done

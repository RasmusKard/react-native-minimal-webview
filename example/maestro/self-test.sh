#!/bin/bash
# Usage: maestro/self-test.sh <android|ios> <device id>
# Proves that a failure fails a run: the mustFail suite fails a check, throws and throws in a cleanup, and the run must
# exit non-zero with exactly those counted. Needs what run.sh needs.
cd "$(dirname "$0")" || exit 1
out=$(./run.sh "$1" "$2" mustFail); status=$?
echo "$out"
[ $status -ne 0 ] && echo "$out" | grep -q '^1 checks passed, 3 failed, 1 skipped' && echo "self-test passed" && exit 0
echo "self-test FAILED: the run should fail with 1 passed, 3 failed, 1 skipped"; exit 1

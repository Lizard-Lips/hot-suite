#!/usr/bin/env bash
# Run the whole suite. Needs node + playwright (npm i playwright && npx playwright install chromium),
# and ffmpeg + ImageMagick for the fixtures. Exit code is non-zero if anything fails.
cd "$(dirname "$0")/.."
[ -d tests/fixtures/generated ] || bash tests/make_fixtures.sh
python3 sync_engine.py --check >/dev/null || { echo "ENGINE DRIFT — run python3 build_hub.py"; exit 1; }
status=0
for t in tests/*.test.js; do
  printf '\n━━ %s ━━\n' "$(basename "$t" .test.js)"
  node "$t" || status=1
done
printf '\n%s\n' "$([ $status = 0 ] && echo 'SUITE PASSED' || echo 'SUITE FAILED')"
exit $status

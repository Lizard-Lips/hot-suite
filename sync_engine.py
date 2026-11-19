"""
sync_engine.py — copy shared code into every tool that uses it.

Three shared files, each edited in one place only:
  lib_loader.js   loads outside libraries the first time they're needed
  audio_core.js   loudness measurement, and reading audio out of files
  engine_spec.js  spec parsing, media analysis, rule checks

Each consuming file has a marked block per shared file; this replaces whatever
is between the markers with the current source, so copies can never drift.
build_hub.py runs it first.

    python3 sync_engine.py          sync every consumer
    python3 sync_engine.py --check  report drift without changing anything
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SPEC = ["tool_speccheck.html", "tool_presetbuilder.html", "monday-app/index.html", "monday-app/settings.html"]
BLOCKS = [
    ("libs", "lib_loader.js", SPEC + ["tool_subsync.html", "tool_shotlogger.html", "tool_cutlogger.html"]),
    ("audio", "audio_core.js", SPEC + ["tool_loudness.html"]),
    ("spec", "engine_spec.js", SPEC),
]


def markers(key, src):
    return ("// @@ENGINE:%s BEGIN \u2014 generated from %s by sync_engine.py. Do not edit here." % (key, src),
            "// @@ENGINE:%s END" % key)


def sync(check_only=False):
    drift = []
    for key, src, consumers in BLOCKS:
        begin, end = markers(key, src)
        want = begin + "\n" + (ROOT / src).read_text(encoding="utf-8").rstrip() + "\n" + end
        for name in consumers:
            path = ROOT / name
            if not path.exists():
                print("  skip   %-28s %s (not found)" % (name, key))
                continue
            text = path.read_text(encoding="utf-8")
            a, b = text.find(begin), text.find(end)
            if a < 0 or b < 0 or b < a:
                raise SystemExit("  ERROR  %s: '%s' markers missing or out of order" % (name, key))
            if text[a:b + len(end)] == want:
                print("  ok     %-28s %s" % (name, key))
                continue
            drift.append(name)
            if check_only:
                print("  DRIFT  %-28s %s" % (name, key))
            else:
                path.write_text(text[:a] + want + text[b + len(end):], encoding="utf-8")
                print("  synced %-28s %s" % (name, key))
    return drift


if __name__ == "__main__":
    if sync(check_only="--check" in sys.argv) and "--check" in sys.argv:
        sys.exit(1)

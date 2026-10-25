#!/usr/bin/env python3
"""Run the full pipeline: fetch → translate → build static site."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable


def run(script: str, *extra: str) -> None:
    cmd = [PY, str(ROOT / script), *extra]
    print(f"\n$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="force re-download sources")
    parser.add_argument("--no-translate", action="store_true")
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--workers", default="6")
    args = parser.parse_args()

    if not args.skip_fetch:
        run("fetch.py", *(["--refresh"] if args.refresh else []))
    translate_args = ["--workers", args.workers]
    if args.no_translate:
        translate_args.append("--no-translate")
    run("translate.py", *translate_args)
    run("build_site.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

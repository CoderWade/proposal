#!/usr/bin/env python3
"""Sanity-check the generated static site before deploying."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DATA = SITE / "data"

REQUIRED_PAGES = ["index.html", "detail.html", "about.html"]
REQUIRED_ASSETS = [
    "assets/style.css",
    "assets/ui.js",
    "assets/app.js",
    "assets/detail.js",
]


def fail(message: str) -> None:
    print(f"[check] FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    for page in REQUIRED_PAGES:
        if not (SITE / page).is_file():
            fail(f"missing page {page}")
    for asset in REQUIRED_ASSETS:
        if not (SITE / asset).is_file():
            fail(f"missing asset {asset}")

    index_path = DATA / "index.json"
    if not index_path.is_file():
        fail("missing data/index.json")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if not isinstance(index, list) or len(index) < 100:
        fail(f"index.json looks wrong ({len(index) if isinstance(index, list) else '?'} rows)")

    required_fields = {
        "id",
        "family",
        "number",
        "title",
        "titleZh",
        "statusZh",
        "typeZh",
        "impactLevel",
        "tags",
    }
    for row in index[:200]:
        missing = required_fields - row.keys()
        if missing:
            fail(f"{row.get('id')} missing fields {sorted(missing)}")

    ids = {row["id"] for row in index}
    detail_files = list((DATA / "detail").glob("*.json"))
    if len(detail_files) != len(index):
        fail(f"detail count {len(detail_files)} != index count {len(index)}")

    for row in index[:100]:
        path = DATA / "detail" / f"{row['id'].lower()}.json"
        if not path.is_file():
            fail(f"missing detail file for {row['id']}")
        detail = json.loads(path.read_text(encoding="utf-8"))
        if detail.get("id") != row["id"]:
            fail(f"detail id mismatch for {row['id']}")
        if not isinstance(detail.get("sections"), dict):
            fail(f"{row['id']} has no sections object")

    stats = json.loads((DATA / "stats.json").read_text(encoding="utf-8"))
    if stats.get("counts", {}).get("total") != len(index):
        fail("stats total does not match index")

    build_path = DATA / "build.json"
    if not build_path.is_file():
        fail("missing data/build.json")
    build = json.loads(build_path.read_text(encoding="utf-8"))
    if not build.get("build"):
        fail("build.json has no build id")

    # Every page must carry the build id, otherwise the client cannot version
    # its data requests and a CDN could pair fresh HTML with stale JSON.
    for page in REQUIRED_PAGES:
        html = (SITE / page).read_text(encoding="utf-8")
        if f'content="{build["build"]}"' not in html:
            fail(f"{page} does not carry build id {build['build']}")
        if "assets/ui.js?v=" not in html:
            fail(f"{page} has unversioned asset references")

    translated = sum(1 for row in index if row.get("zhAvailable"))
    ratio = translated / max(1, len(index))
    print(f"[check] {len(index)} proposals, {translated} translated ({ratio:.1%})")
    if ratio < 0.5:
        print("[check] WARN: fewer than half of proposals have Chinese text", file=sys.stderr)

    unresolved = [i for i in ids if i.endswith("-None")]
    if unresolved:
        fail("malformed ids present")

    print("[check] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

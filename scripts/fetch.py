#!/usr/bin/env python3
"""Download and parse the official EIP/ERC/BIP repositories.

Outputs data/proposals_raw.json with English source content, plus data/meta.json
describing source commits and fetch time.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_parse import (  # noqa: E402
    download_repo,
    latest_commit,
    parse_bip,
    parse_eip,
)

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache"
DATA_DIR = ROOT / "data"

SOURCES = {
    "eips": {"repo": "ethereum/EIPs", "branch": "master", "prefix": "EIPS", "kind": "eip"},
    "ercs": {"repo": "ethereum/ERCs", "branch": "master", "prefix": "ERCS", "kind": "erc"},
    "bips": {"repo": "bitcoin/bips", "branch": "master", "prefix": "", "kind": "bip"},
}


def collect_eips(root: Path) -> list[dict]:
    proposals = []
    folder = root / "EIPS"
    for path in sorted(folder.glob("eip-*.md")):
        match = re.match(r"eip-(\d+)\.md$", path.name)
        if not match:
            continue
        number = int(match.group(1))
        item = parse_eip(
            path.read_text(encoding="utf-8"),
            "EIP",
            number,
            SOURCES["eips"]["repo"],
            SOURCES["eips"]["branch"],
            f"EIPS/{path.name}",
        )
        if item:
            proposals.append(item)
    return proposals


def collect_ercs(root: Path) -> list[dict]:
    proposals = []
    folder = root / "ERCS"
    for path in sorted(folder.glob("erc-*.md")):
        match = re.match(r"erc-(\d+)\.md$", path.name)
        if not match:
            continue
        number = int(match.group(1))
        item = parse_eip(
            path.read_text(encoding="utf-8"),
            "ERC",
            number,
            SOURCES["ercs"]["repo"],
            SOURCES["ercs"]["branch"],
            f"ERCS/{path.name}",
        )
        if item:
            proposals.append(item)
    return proposals


def collect_bips(root: Path) -> list[dict]:
    proposals = []
    for path in sorted(root.glob("bip-*")):
        if not path.is_file() or path.suffix not in (".mediawiki", ".md"):
            continue
        match = re.match(r"bip-(\d+)\.(mediawiki|md)$", path.name)
        if not match:
            continue
        number = int(match.group(1))
        item = parse_bip(
            path.read_text(encoding="utf-8"),
            number,
            SOURCES["bips"]["repo"],
            SOURCES["bips"]["branch"],
            path.name,
            mediawiki=path.suffix == ".mediawiki",
        )
        if item:
            proposals.append(item)
    return proposals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download repositories")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if args.refresh:
        for key in SOURCES:
            repo = SOURCES[key]["repo"].replace("/", "__")
            marker = CACHE_DIR / f"{repo}-{SOURCES[key]['branch']}" / ".extracted"
            if marker.exists():
                marker.unlink()

    started = time.time()
    meta = {"sources": {}, "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    proposals: list[dict] = []

    for key in ("eips", "ercs", "bips"):
        spec = SOURCES[key]
        print(f"[fetch] {spec['repo']} …", flush=True)
        root = Path(download_repo(spec["repo"], spec["branch"], str(CACHE_DIR)))
        if key == "eips":
            batch = collect_eips(root)
        elif key == "ercs":
            batch = collect_ercs(root)
        else:
            batch = collect_bips(root)
        print(f"[fetch] {spec['repo']}: {len(batch)} proposals", flush=True)
        meta["sources"][key] = {
            "repo": spec["repo"],
            "branch": spec["branch"],
            **latest_commit(spec["repo"], spec["branch"]),
            "count": len(batch),
        }
        proposals.extend(batch)

    # Drop duplicates: an EIP stub and its ERC successor share a number.
    deduped: dict[tuple[str, int], dict] = {}
    for item in proposals:
        family_group = "ETH" if item["family"] in ("EIP", "ERC") else "BTC"
        deduped[(family_group, item["number"])] = item
    proposals = sorted(deduped.values(), key=lambda x: (x["family"] != "EIP", x["number"]))

    # Reference graph within the Ethereum numbering space / BIP numbering space.
    eth_by_number = {
        p["number"]: p for p in proposals if p["family"] in ("EIP", "ERC")
    }
    bip_by_number = {p["number"]: p for p in proposals if p["family"] == "BIP"}
    for item in proposals:
        pool = bip_by_number if item["family"] == "BIP" else eth_by_number
        item["requiresLinks"] = [
            {"number": n, "id": pool[n]["id"]}
            for n in item["requires"]
            if n in pool and n != item["number"]
        ]

    counter: dict[tuple[str, int], int] = {}
    for item in proposals:
        for link in item["requiresLinks"]:
            key = ("BTC" if item["family"] == "BIP" else "ETH", link["number"])
            counter[key] = counter.get(key, 0) + 1
    for item in proposals:
        key = ("BTC" if item["family"] == "BIP" else "ETH", item["number"])
        item["requiredByCount"] = counter.get(key, 0)

    (DATA_DIR / "proposals_raw.json").write_text(
        json.dumps(proposals, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    meta["counts"] = {
        "EIP": sum(1 for p in proposals if p["family"] == "EIP"),
        "ERC": sum(1 for p in proposals if p["family"] == "ERC"),
        "BIP": sum(1 for p in proposals if p["family"] == "BIP"),
        "total": len(proposals),
    }
    meta["elapsedSeconds"] = round(time.time() - started, 1)
    (DATA_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        "[fetch] done: "
        + ", ".join(f"{k}={v}" for k, v in meta["counts"].items())
        + f" in {meta['elapsedSeconds']}s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

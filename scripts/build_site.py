#!/usr/bin/env python3
"""Split the translated dataset into static-site payloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SITE_DIR = ROOT / "site"
DETAIL_DIR = SITE_DIR / "data" / "detail"

# Curated editorial picks: the proposals that visibly changed how the chains run.
FEATURED = [
    {"id": "ERC-20", "why": "同质化代币的事实标准，几乎所有 ICO、DeFi 与稳定币都建立在它之上。"},
    {"id": "ERC-721", "why": "确立 NFT 的所有权与转移接口，直接催生了数字艺术与链上收藏品市场。"},
    {"id": "EIP-1559", "why": "引入基础费与手续费销毁，重写了以太坊的区块空间定价方式。"},
    {"id": "EIP-2718", "why": "引入类型化交易信封，让后续每一种新交易格式都能独立演进。"},
    {"id": "ERC-4337", "why": "在不改动共识层的前提下实现账户抽象，带来社交恢复与代付 gas 的钱包体验。"},
    {"id": "EIP-4844", "why": "用 blob 承载 L2 数据，把 Rollup 的结算成本压下一个数量级。"},
    {"id": "EIP-7702", "why": "让普通 EOA 临时委托给合约代码，是账户抽象路线上的关键一步。"},
    {"id": "EIP-3675", "why": "以太坊从工作量证明切换到权益证明，能耗下降约 99.9%。"},
    {"id": "BIP-32", "why": "分层确定性钱包的基础，一个种子派生整棵密钥树。"},
    {"id": "BIP-39", "why": "助记词标准，把人类可读的 12/24 个词变成钱包恢复凭据。"},
    {"id": "BIP-141", "why": "隔离见证，修复交易延展性，并为 Taproot 与闪电网络铺平道路。"},
    {"id": "BIP-341", "why": "Taproot 升级，让复杂脚本在链上看起来与普通转账无异。"},
]


def compact(item: dict) -> dict:
    abstract = (item.get("sections", {}).get("abstract", {}) or {}).get("zh", "") or ""
    if len(abstract) > 200:
        abstract = abstract[:200].rstrip() + "…"
    return {
        "id": item["id"],
        "family": item["family"],
        "number": item["number"],
        "title": item["title"],
        "titleZh": item.get("titleZh", ""),
        "description": item.get("description", ""),
        "descriptionZh": item.get("descriptionZh", ""),
        "abstractZh": abstract,
        "status": item["status"],
        "statusZh": item.get("statusZh", ""),
        "typeZh": item.get("typeZh", ""),
        "categoryZh": item.get("categoryZh", ""),
        "layer": item.get("layer", ""),
        "year": item.get("year"),
        "tags": item.get("tags", []),
        "impactLevel": item.get("impactLevel", ""),
        "impactReasons": item.get("impactReasons", ""),
        "requires": [link["number"] for link in item.get("requiresLinks", [])],
        "requiredByCount": item.get("requiredByCount", 0),
        "zhAvailable": item.get("zhAvailable", False),
    }


def compute_build_id() -> str:
    """Fingerprint the published dataset, ignoring volatile timestamps.

    Derived from content only: an unchanged sync keeps the same id, so CDN and
    browser caches stay warm, while any real data change produces a new id.
    """
    digest = hashlib.sha1()
    for name in ("index.json", "featured.json", "stats.json"):
        payload = json.loads((SITE_DIR / "data" / name).read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload.pop("generatedAt", None)
        digest.update(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        )
    return digest.hexdigest()[:10]


def inject_build_id(build_id: str) -> int:
    """Expose the build id to the page so scripts can version their fetches."""
    tag = f'<meta name="proposal-build" content="{build_id}" />'
    changed = 0
    for page in ("index.html", "detail.html", "about.html", "404.html"):
        path = SITE_DIR / page
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        text = re.sub(r'\s*<meta name="proposal-build"[^>]*>', "", text)
        if "</head>" not in text:
            continue
        text = text.replace("</head>", f"  {tag}\n</head>", 1)
        path.write_text(text, encoding="utf-8")
        changed += 1
    return changed


def stamp_assets() -> int:
    """Append a content hash to local asset URLs.

    GitHub Pages serves everything with a 10-minute cache. Without a
    fingerprint a returning visitor can pair freshly deployed HTML with a
    cached older script, which breaks the page. The hash changes whenever the
    file changes, so each deploy gets a clean URL.
    """
    assets = {}
    for path in sorted((SITE_DIR / "assets").iterdir()):
        if path.is_file():
            digest = hashlib.sha1(path.read_bytes()).hexdigest()[:8]
            assets[path.name] = digest

    pattern = re.compile(r'(assets/([A-Za-z0-9_.-]+))(\?v=[0-9a-f]+)?')

    def replace(match: re.Match[str]) -> str:
        name = match.group(2)
        digest = assets.get(name)
        return f"{match.group(1)}?v={digest}" if digest else match.group(0)

    stamped = 0
    for page in ("index.html", "detail.html", "about.html", "404.html"):
        path = SITE_DIR / page
        if not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        updated = pattern.sub(replace, original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            stamped += 1
    return stamped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DATA_DIR / "proposals.json"))
    parser.add_argument("--clean", action="store_true", default=True)
    args = parser.parse_args()

    proposals = json.loads(Path(args.input).read_text(encoding="utf-8"))
    meta_path = DATA_DIR / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    if args.clean and DETAIL_DIR.exists():
        shutil.rmtree(DETAIL_DIR)
    DETAIL_DIR.mkdir(parents=True, exist_ok=True)

    tags_by_item = {item["id"]: set(item.get("tags", [])) for item in proposals}
    by_id = {item["id"]: item for item in proposals}

    index = []
    for item in proposals:
        entry = compact(item)
        index.append(entry)

        tags = tags_by_item[item["id"]]
        related = []
        for other in proposals:
            if other["id"] == item["id"]:
                continue
            if other["family"] == "BIP" and item["family"] != "BIP":
                continue
            if item["family"] == "BIP" and other["family"] != "BIP":
                continue
            overlap = len(tags & tags_by_item[other["id"]])
            if overlap:
                related.append((overlap, other["requiredByCount"], other["number"], other["id"]))
        related.sort(reverse=True)
        related_ids = [row[3] for row in related[:6]]

        detail = dict(item)
        detail["sections"] = {
            name: value
            for name, value in item.get("sections", {}).items()
            if value.get("en") or value.get("zh")
        }
        detail["related"] = related_ids
        detail["requiresDetail"] = [
            {
                "id": link["id"],
                "titleZh": by_id.get(link["id"], {}).get("titleZh", ""),
                "title": by_id.get(link["id"], {}).get("title", ""),
            }
            for link in item.get("requiresLinks", [])
        ]
        (DETAIL_DIR / f"{item['id'].lower()}.json").write_text(
            json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    index.sort(key=lambda x: (x["family"] != "EIP", x["family"] != "ERC", x["number"]))
    (SITE_DIR / "data" / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    def count(field: str, items: list[dict]) -> list[dict]:
        counter = Counter(str(it.get(field) or "未知") for it in items)
        return [{"name": k, "count": v} for k, v in counter.most_common()]

    years = Counter(it["year"] for it in proposals if it.get("year"))
    stats = {
        "counts": {
            "EIP": sum(1 for p in proposals if p["family"] == "EIP"),
            "ERC": sum(1 for p in proposals if p["family"] == "ERC"),
            "BIP": sum(1 for p in proposals if p["family"] == "BIP"),
            "total": len(proposals),
        },
        "status": count("statusZh", proposals),
        "type": count("typeZh", proposals),
        "category": count("categoryZh", proposals),
        "impact": count("impactLevel", proposals),
        "years": [
            {"year": year, "count": years[year]}
            for year in range(min(years), max(years) + 1)
        ]
        if years
        else [],
        "translated": sum(1 for p in proposals if p.get("zhAvailable")),
        "tags": Counter(tag for p in proposals for tag in p.get("tags", [])).most_common(20),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    stats["tags"] = [{"name": k, "count": v} for k, v in stats["tags"]]
    (SITE_DIR / "data" / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    featured = [
        {"id": entry["id"], "whyZh": entry["why"]}
        for entry in FEATURED
        if entry["id"] in by_id
    ]
    (SITE_DIR / "data" / "featured.json").write_text(
        json.dumps(featured, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    meta["generatedAt"] = stats["generatedAt"]
    (SITE_DIR / "data" / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    stamped = stamp_assets()
    build_id = compute_build_id()
    (SITE_DIR / "data" / "build.json").write_text(
        json.dumps({"build": build_id, "generatedAt": stats["generatedAt"]}, ensure_ascii=False),
        encoding="utf-8",
    )
    injected = inject_build_id(build_id)

    print(
        f"[build] index={len(index)} details={len(list(DETAIL_DIR.glob('*.json')))} "
        f"translated={stats['translated']}/{len(proposals)} stamped_pages={stamped} "
        f"build={build_id} injected={injected}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

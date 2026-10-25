#!/usr/bin/env python3
"""Translate proposal metadata and key sections into Simplified Chinese.

Design notes
------------
* Two public Google Translate surfaces are used: ``clients5.google.com``
  (dict-chrome-ex client) as primary and ``translate.googleapis.com`` as
  secondary. They have independent quotas.
* Many text chunks are packed into a single request (multi-``q`` GET), which
  cuts the request count by an order of magnitude compared with one request
  per field and keeps us far away from rate limits.
* Results are cached by source-text hash, so a run that is interrupted (or
  partially rate-limited) resumes from where it stopped.
* A circuit breaker aborts a pass after repeated 429s and the output file is
  still written with whatever was translated, so the site degrades gracefully.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_parse import (  # noqa: E402
    USER_AGENT,
    _proxy_handler,
    impact_level,
    impact_summary,
    normalize_zh,
    protect_terms,
    restore_terms,
    zh_category,
    zh_status,
    zh_type,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_PATH = DATA_DIR / "cache" / "translations.json"

CACHE_VERSION = "v3"
REQUEST_TIMEOUT = 60
CHUNK_CHARS = 1800
BATCH_CHARS = 12000
BATCH_ITEMS = 20

PRIMARY = ("https://clients5.google.com/translate_a/t", "dict-chrome-ex")
SECONDARY = ("https://translate.googleapis.com/translate_a/t", "gtx")
FALLBACK = "https://api.mymemory.translated.net/get"

_lock = threading.Lock()
_opener = urllib.request.build_opener(_proxy_handler())
_cache: dict[str, str] = {}
_state = {
    "ok": 0,
    "fail": 0,
    "rate_limited": 0,
    "abort": False,
    "cooldown_until": 0.0,
    "last_error": "",
}


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------


def load_cache() -> dict[str, str]:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict[str, str]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp.replace(CACHE_PATH)


def cache_key(text: str) -> str:
    return hashlib.sha1(f"{CACHE_VERSION}\x00{text}".encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Chunking
# --------------------------------------------------------------------------


def split_chunks(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining[:limit]
        index = max(cut.rfind("\n\n"), cut.rfind("。"), cut.rfind(". "))
        if index < limit * 0.5:
            index = cut.rfind(" ")
        if index <= 0:
            index = limit
        chunks.append(remaining[:index].strip())
        remaining = remaining[index:].strip()
    if remaining:
        chunks.append(remaining)
    return [c for c in chunks if c]


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


def _throttle() -> None:
    wait = _state["cooldown_until"] - time.time()
    if wait > 0:
        time.sleep(min(wait, 180) + random.random())


def _note_rate_limit(retry_after: float) -> None:
    with _lock:
        _state["rate_limited"] += 1
        backoff = max(retry_after, min(300.0, 8.0 * (2 ** min(_state["rate_limited"] - 1, 5))))
        _state["cooldown_until"] = max(_state["cooldown_until"], time.time() + backoff)
        if _state["rate_limited"] >= 60:
            _state["abort"] = True


def _request(endpoint: tuple[str, str], texts: list[str]) -> list[str]:
    url_base, client = endpoint
    params = [("client", client), ("sl", "en"), ("tl", "zh-CN")]
    params += [("q", text) for text in texts]
    url = f"{url_base}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
        payload = resp.read().decode("utf-8", "replace")
    data = json.loads(payload)
    if isinstance(data, list) and data and isinstance(data[0], list):
        # Legacy nested shape: [[["translated","source",...]], ...]
        return ["".join(seg[0] for seg in group if seg and seg[0]) for group in data]
    if isinstance(data, list):
        return [str(part) for part in data]
    raise ValueError("unexpected translation payload")


def _mymemory(text: str) -> str:
    out = []
    for piece in split_chunks(text, 450):
        params = urllib.parse.urlencode({"q": piece, "langpair": "en|zh-CN"})
        req = urllib.request.Request(f"{FALLBACK}?{params}", headers={"User-Agent": USER_AGENT})
        with _opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
        if payload.get("responseStatus") != 200:
            raise RuntimeError(payload.get("responseDetails") or "mymemory error")
        translated = (payload.get("responseData") or {}).get("translatedText") or ""
        if not translated.strip():
            raise RuntimeError("empty translation")
        out.append(translated)
    return " ".join(out)


def translate_batch(texts: list[str]) -> list[str]:
    """Translate a batch of already-protected chunks, preserving order."""
    last_error: Exception | None = None
    attempts = 0
    while attempts < 5 and not _state["abort"]:
        _throttle()
        for endpoint in (PRIMARY, SECONDARY):
            try:
                result = _request(endpoint, texts)
                if len(result) != len(texts):
                    raise ValueError(f"got {len(result)} results for {len(texts)} inputs")
                return result
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 429:
                    _note_rate_limit(20)
                elif exc.code in (403, 500, 502, 503, 504):
                    time.sleep(1.5)
                else:
                    break
            except Exception as exc:
                last_error = exc
        attempts += 1
        time.sleep(min(2 ** attempts, 20) + random.random())

    # Last resort: per-text MyMemory (small daily quota, but better than nothing).
    if not _state["abort"]:
        try:
            return [_mymemory(text) for text in texts]
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"batch failed: {last_error}")


# --------------------------------------------------------------------------
# Scheduling
# --------------------------------------------------------------------------


def build_batches(entries: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
    """Entries are (cache_key, guarded_text); pack them into request batches."""
    batches, current, size = [], [], 0
    for key, text in entries:
        if current and (size + len(text) > BATCH_CHARS or len(current) >= BATCH_ITEMS):
            batches.append(current)
            current, size = [], 0
        current.append((key, text))
        size += len(text)
    if current:
        batches.append(current)
    return batches


def field_chunks(text: str) -> list[str]:
    return split_chunks(text)


def chunk_state(text: str) -> tuple[bool, list[str]]:
    chunks = field_chunks(text)
    keys = [cache_key(chunk) for chunk in chunks]
    return all(key in _cache for key in keys), chunks


def run_pass(tasks: list[tuple[str, str, str]], workers: int) -> int:
    """tasks are (name, index, original_text). Returns uncached chunk count."""
    missing_chunks: dict[str, str] = {}
    for _name, _index, text in tasks:
        for chunk in field_chunks(text):
            key = cache_key(chunk)
            if key not in _cache and key not in missing_chunks:
                missing_chunks[key] = chunk

    if not missing_chunks:
        return 0

    entries = []
    for key, chunk in missing_chunks.items():
        guarded, _ = protect_terms(chunk)
        entries.append((key, guarded))
    batches = build_batches(entries)
    print(
        f"[translate] pass: {len(tasks)} fields, {len(missing_chunks)} uncached chunks, "
        f"{len(batches)} batched requests, workers={workers}",
        flush=True,
    )

    started = time.time()
    done_batches = 0
    failed_batches = 0

    def work(batch: list[tuple[str, str]]):
        return batch, translate_batch([text for _, text in batch])

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, batch): batch for batch in batches}
        for future in concurrent.futures.as_completed(futures):
            done_batches += 1
            try:
                batch, results = future.result()
            except Exception as exc:
                failed_batches += 1
                _state["fail"] += 1
                _state["last_error"] = str(exc)
                continue
            with _lock:
                for (key, _), translated in zip(batch, results):
                    _cache[key] = translated
                    _state["ok"] += 1
                if done_batches % 5 == 0:
                    save_cache(_cache)
            if done_batches % 20 == 0 or done_batches == len(batches):
                elapsed = max(0.01, time.time() - started)
                print(
                    f"[translate] {done_batches}/{len(batches)} batches, "
                    f"{_state['ok']} chunks cached ({_state['ok'] / elapsed:.0f}/s), "
                    f"429={_state['rate_limited']} failed_batches={failed_batches}",
                    flush=True,
                )
            if _state["abort"]:
                for pending in futures:
                    pending.cancel()
                break

    save_cache(_cache)
    unresolved = sum(
        1
        for _name, _index, text in tasks
        if not all(cache_key(chunk) in _cache for chunk in field_chunks(text))
    )
    print(
        f"[translate] pass done: {len(tasks) - unresolved} fields resolved, "
        f"{unresolved} still missing, failed batches={failed_batches}",
        flush=True,
    )
    return unresolved


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DATA_DIR / "proposals_raw.json"))
    parser.add_argument("--output", default=str(DATA_DIR / "proposals.json"))
    parser.add_argument("--workers", type=int, default=int(os.environ.get("TRANSLATE_WORKERS", "4")))
    parser.add_argument("--no-translate", action="store_true")
    parser.add_argument("--max-items", type=int, default=0)
    parser.add_argument("--passes", type=int, default=3, help="retry passes for rate-limited runs")
    args = parser.parse_args()

    global _cache
    _cache = load_cache()
    proposals = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if args.max_items:
        proposals = proposals[: args.max_items]

    section_names = ["abstract", "motivation", "rationale", "backwards", "security"]

    print(f"[translate] cache entries={len(_cache)}", flush=True)
    if not args.no_translate:
        for pass_no in range(1, args.passes + 1):
            for name in ("title", "abstract", "description", "motivation", "security", "rationale", "backwards"):
                tier_tasks = []
                for index, item in enumerate(proposals):
                    if name == "title":
                        text = item["title"]
                    elif name == "description":
                        text = item.get("description", "")
                    else:
                        text = (item.get("sections") or {}).get(name, "")
                    if text:
                        tier_tasks.append((name, index, text))
                if tier_tasks:
                    run_pass(tier_tasks, args.workers)
                if _state["abort"]:
                    break

            missing = 0
            for item in proposals:
                fields = [item["title"], item.get("description", "")]
                fields += [
                    (item.get("sections") or {}).get(name, "")
                    for name in section_names
                ]
                for text in fields:
                    if text and not all(
                        cache_key(chunk) in _cache for chunk in field_chunks(text)
                    ):
                        missing += 1
            print(
                f"[translate] pass {pass_no} finished: missing fields={missing} "
                f"429={_state['rate_limited']} aborted={_state['abort']}",
                flush=True,
            )
            if missing == 0 or pass_no == args.passes:
                break
            _state["abort"] = False
            _state["rate_limited"] = 0
            _state["cooldown_until"] = 0.0
            cooldown = min(600, 90 * pass_no)
            print(f"[translate] cooling down {cooldown}s before retry", flush=True)
            time.sleep(cooldown)

    # Assemble final dataset.
    for item in proposals:
        sections_src = item.get("sections") or {}
        translated_sections = {}
        for name in section_names:
            original = sections_src.get(name, "")
            translated = ""
            if original and not args.no_translate:
                keys = [cache_key(chunk) for chunk in split_chunks(original)]
                if all(key in _cache for key in keys):
                    parts = []
                    for chunk in split_chunks(original):
                        _, mapping = protect_terms(chunk)
                        parts.append(restore_terms(_cache[cache_key(chunk)], mapping))
                    translated = "\n\n".join(parts)
            translated_sections[name] = {"en": original, "zh": normalize_zh(translated)}
        item["sections"] = translated_sections

        title_zh = ""
        if not args.no_translate:
            keys = [cache_key(chunk) for chunk in split_chunks(item["title"])]
            if all(key in _cache for key in keys):
                parts = []
                for chunk in split_chunks(item["title"]):
                    _, mapping = protect_terms(chunk)
                    parts.append(restore_terms(_cache[cache_key(chunk)], mapping))
                title_zh = "".join(parts)
        item["titleZh"] = normalize_zh(title_zh)

        description_zh = ""
        if item.get("description") and not args.no_translate:
            keys = [cache_key(chunk) for chunk in split_chunks(item["description"])]
            if all(key in _cache for key in keys):
                parts = []
                for chunk in split_chunks(item["description"]):
                    _, mapping = protect_terms(chunk)
                    parts.append(restore_terms(_cache[cache_key(chunk)], mapping))
                description_zh = "".join(parts)
        item["descriptionZh"] = normalize_zh(description_zh)

        item["statusZh"] = zh_status(item["status"])
        item["typeZh"] = zh_type(item["type"])
        item["categoryZh"] = zh_category(item["category"] or item.get("layer", ""))
        level, reasons = impact_level(
            item["status"],
            item["type"],
            item["category"],
            item.get("layer", ""),
            item.get("requiredByCount", 0),
        )
        item["impactLevel"] = level
        item["impactReasons"] = reasons
        item["impactZh"] = impact_summary(
            item["family"],
            item["typeZh"],
            item["categoryZh"],
            item["statusZh"],
            level,
            reasons,
            item.get("tags", []),
            item.get("year"),
            item.get("requires", []),
            item.get("requiredByCount", 0),
        )
        item["zhAvailable"] = bool(title_zh)
        item["searchText"] = " ".join(
            filter(
                None,
                [
                    item["id"],
                    item["title"],
                    title_zh,
                    item.get("description", ""),
                    description_zh,
                    " ".join(item.get("tags", [])),
                ],
            )
        ).lower()

    Path(args.output).write_text(
        json.dumps(proposals, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    translated = sum(1 for item in proposals if item.get("zhAvailable"))
    print(
        f"[translate] done: {translated}/{len(proposals)} proposals with Chinese titles, "
        f"cache={len(_cache)}, 429={_state['rate_limited']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

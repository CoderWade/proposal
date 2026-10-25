"""Shared parsing helpers for EIP/ERC and BIP proposal source files.

Only the Python standard library is used so the pipeline can run unchanged
on GitHub Actions runners without installing dependencies.
"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request


USER_AGENT = (
    "proposal-zh-indexer/1.0 (+https://github.com/; static standards archive)"
)

# --------------------------------------------------------------------------
# Network
# --------------------------------------------------------------------------


def _macos_system_proxy() -> dict[str, str]:
    """Parse `scutil --proxy` so the pipeline works behind a local proxy.

    urllib does not read the macOS system proxy settings, which means a machine
    behind Clash/Surge would otherwise fail on every outbound request.
    """
    try:
        output = subprocess.run(
            ["scutil", "--proxy"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return {}

    def field(name: str) -> str | None:
        match = re.search(rf"^\s*{name}\s*:\s*(\S+)\s*$", output, re.M)
        return match.group(1) if match else None

    proxies: dict[str, str] = {}
    for scheme, host_key, port_key, enable_key in (
        ("http", "HTTPProxy", "HTTPPort", "HTTPEnable"),
        ("https", "HTTPSProxy", "HTTPSPort", "HTTPSEnable"),
    ):
        if field(enable_key) == "1":
            host, port = field(host_key), field(port_key)
            if host and port:
                proxies[scheme] = f"http://{host}:{port}"
    if "https" not in proxies and "http" in proxies:
        proxies["https"] = proxies["http"]
    return proxies


def _proxy_handler() -> urllib.request.BaseHandler:
    """Honour HTTPS_PROXY / https_proxy, falling back to the macOS system proxy."""
    proxies = {}
    for scheme in ("http", "https"):
        value = os.environ.get(f"{scheme.upper()}_PROXY") or os.environ.get(
            f"{scheme}_proxy"
        )
        if value:
            proxies[scheme] = value
    if not proxies and sys.platform == "darwin":
        proxies = _macos_system_proxy()
    return urllib.request.ProxyHandler(proxies)


_OPENER = urllib.request.build_opener(_proxy_handler())


def http_get(url: str, timeout: int = 60, retries: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with _OPENER.open(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except Exception as exc:  # network hiccup
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} attempts: {url} ({last_error})")


def http_get_json(url: str, timeout: int = 60) -> dict:
    return json.loads(http_get(url, timeout=timeout).decode("utf-8"))


def download_repo(repo: str, branch: str, dest_dir: str) -> str:
    """Download a repository tarball and extract it. Returns extracted root."""
    os.makedirs(dest_dir, exist_ok=True)
    root = os.path.join(dest_dir, f"{repo.replace('/', '__')}-{branch}")
    marker = os.path.join(root, ".extracted")
    if os.path.exists(marker):
        return root

    url = f"https://codeload.github.com/{repo}/tar.gz/refs/heads/{branch}"
    payload = http_get(url, timeout=300, retries=3)
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tar:
        members = tar.getmembers()
        prefix = members[0].name.split("/")[0] if members else ""
        target = os.path.join(dest_dir, f"{repo.replace('/', '__')}-{branch}")
        for member in members:
            parts = member.name.split("/", 1)
            if len(parts) == 1:
                continue
            rel = parts[1]
            if not rel:
                continue
            member.name = rel
            tar.extract(member, target)
    with open(marker, "w", encoding="utf-8") as fh:
        fh.write(url)
    return root


def latest_commit(repo: str, branch: str = "master") -> dict:
    try:
        data = http_get_json(
            f"https://api.github.com/repos/{repo}/commits/{branch}", timeout=40
        )
        return {
            "sha": data.get("sha", ""),
            "date": data.get("commit", {}).get("committer", {}).get("date", ""),
            "message": (data.get("commit", {}).get("message") or "").splitlines()[0],
        }
    except Exception:
        return {"sha": "", "date": "", "message": ""}


# --------------------------------------------------------------------------
# Front matter / header parsing
# --------------------------------------------------------------------------


def _split_front_matter(text: str) -> tuple[dict, str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not match:
        return {}, text
    raw = match.group(1)
    meta: dict[str, str] = {}
    current_key: str | None = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        new_key = re.match(r"^\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if line[0] in " \t" and current_key and not new_key:
            meta[current_key] = (meta[current_key] + " " + line.strip()).strip()
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            current_key = key.strip()
            meta[current_key] = value.strip()
    for key, value in list(meta.items()):
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        meta[key.lower()] = value
    return meta, text[match.end() :]


def _split_pre_header(text: str) -> tuple[dict, str]:
    match = re.search(r"<pre>\s*(.*?)</pre>", text, re.S)
    if match:
        raw = match.group(1)
        body = text[: match.start()] + text[match.end() :]
    else:
        match = re.match(r"```[a-zA-Z]*\s*\n(.*?)\n```\s*\n", text, re.S)
        if not match:
            return {}, text
        raw = match.group(1)
        body = text[match.end() :]

    meta: dict[str, str] = {}
    current_key: str | None = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        new_key = re.match(r"^\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$", line)
        if line[0] in " \t" and current_key and not new_key:
            meta[current_key] = (meta[current_key] + " " + line.strip()).strip()
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            current_key = key.strip()
            meta[current_key] = value.strip()
    for key, value in list(meta.items()):
        meta[key.lower()] = value
    return meta, body


def split_csv(value: str) -> list[str]:
    if not value:
        return []
    parts = [p.strip() for p in re.split(r",", value)]
    return [p for p in parts if p]


def parse_numbers(value: str | None) -> list[int]:
    if not value:
        return []
    numbers = []
    for token in re.findall(r"\d+", value):
        try:
            numbers.append(int(token))
        except ValueError:
            continue
    return numbers


def parse_people(value: str) -> list[str]:
    if not value:
        return []
    value = re.sub(r"\s*\n\s*", " ", value)
    # BIP headers put each author on its own line, so continuation lines have no
    # comma. An email address followed by a new name is a reliable boundary.
    value = re.sub(r"(?<=>)\s+(?=[A-Z][\w.'-])", ", ", value)
    # Split on commas that are not inside parentheses.
    people, depth, buf = [], 0, ""
    for ch in value:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            people.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        people.append(buf.strip())
    cleaned = []
    for person in people:
        person = re.sub(r"<[^>]+>", "", person).strip()
        if person:
            cleaned.append(person)
    return cleaned


# --------------------------------------------------------------------------
# Section extraction and cleanup
# --------------------------------------------------------------------------


def extract_sections(body: str, mediawiki: bool) -> dict[str, str]:
    """Flat map: heading text -> that heading's own lines (nested headings excluded).

    Kept because many documents repeat a canonical heading (e.g. Abstract) at a
    nested level, and the flat map finds those.
    """
    lines = body.splitlines()
    sections: dict[str, list[str]] = {}
    heading_re = re.compile(r"^(=+)\s*(.+?)\s*\1\s*$") if mediawiki else re.compile(
        r"^(#{2,6})\s+(.+?)\s*$"
    )
    current_name: str | None = None
    buffer: list[str] = []
    for line in lines:
        match = heading_re.match(line)
        if match:
            if current_name is not None:
                sections.setdefault(current_name, []).extend(buffer)
            current_name = normalize_heading(match.group(2))
            buffer = []
        elif current_name is not None:
            buffer.append(line)
    if current_name is not None:
        sections.setdefault(current_name, []).extend(buffer)
    return {name: "\n".join(chunk) for name, chunk in sections.items() if chunk}


def extract_sections_hierarchical(body: str, mediawiki: bool) -> dict[str, str]:
    """Top-level sections with their nested subsections folded in.

    Without this, a section that only contains subsections (common for
    "Security Considerations" and "Rationale") would come back empty.
    """
    lines = body.splitlines()
    if mediawiki:
        heading_re = re.compile(r"^(=+)\s*(.+?)\s*\1\s*$")
    else:
        heading_re = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

    parsed: list[tuple[int, str, int]] = []
    for index, line in enumerate(lines):
        match = heading_re.match(line)
        if match:
            level = len(match.group(1))
            parsed.append((level, normalize_heading(match.group(2)), index))

    if not parsed:
        return {}

    levels = [level for level, _, _ in parsed]
    if not mediawiki and 1 in levels and any(level >= 2 for level in levels):
        # A leading "# Title" is a document title, not a section.
        levels = [level for level in levels if level >= 2]
    top_level = min(levels)

    tops = [(level, name, index) for level, name, index in parsed if level == top_level]
    sections: dict[str, list[str]] = {}
    for order, (_level, name, start) in enumerate(tops):
        end = tops[order + 1][2] if order + 1 < len(tops) else len(lines)
        chunk = []
        for line in lines[start + 1 : end]:
            nested = heading_re.match(line)
            if nested:
                nested_level = len(nested.group(1)) if not mediawiki else len(nested.group(1))
                if nested_level > top_level:
                    # Keep the subsection title as a plain line of the parent body.
                    chunk.append("")
                    chunk.append(nested.group(2).strip())
                    chunk.append("")
                    continue
            chunk.append(line)
        body_text = "\n".join(chunk).strip()
        if body_text:
            sections[name] = body_text
    return sections


def normalize_heading(name: str) -> str:
    name = re.sub(r"<[^>]+>", "", name)
    name = re.sub(r"[*_`']", "", name)
    return name.strip().lower()


SECTION_ALIASES = {
    "abstract": ["abstract", "summary", "simple summary", "overview"],
    "motivation": ["motivation", "motivation and rationale", "background"],
    "rationale": ["rationale", "design rationale", "design"],
    "backwards": [
        "backwards compatibility",
        "backward compatibility",
        "compatibility",
        "backwards-compatibility",
    ],
    "security": ["security considerations", "security", "risks"],
}


def find_section(
    hierarchical: dict[str, str], flat: dict[str, str], key: str
) -> str:
    for alias in SECTION_ALIASES[key]:
        if alias in hierarchical:
            return hierarchical[alias]
    for alias in SECTION_ALIASES[key]:
        if alias in flat:
            return flat[alias]
    return ""


def pick_section(sections: dict[str, str], key: str) -> str:
    for alias in SECTION_ALIASES[key]:
        if alias in sections:
            return sections[alias]
    return ""


def first_paragraph(body: str, cleaner) -> str:
    """Fallback for proposals without an Abstract section."""
    # Drop heading lines first: for process documents the first prose paragraph is
    # the meaningful summary, while "# What is an EIP?" is not.
    stripped = re.sub(r"^\s*#{1,6}\s+.*$", "", body, flags=re.M)
    stripped = re.sub(r"^\s*=+\s*[^=\n]+?\s*=+\s*$", "", stripped, flags=re.M)
    stripped = re.sub(r"^\s*<pre>.*?</pre>\s*$", "", stripped, flags=re.S | re.M)
    text = cleaner(stripped)
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if len(block) < 60:
            continue
        if block.startswith("•") or block.startswith("|"):
            continue
        return block
    return ""


def join_soft_wraps(text: str) -> str:
    """Collapse hard-wrapped source lines so sentences stay intact.

    Standards documents wrap at ~80 columns, which makes machine translation
    produce fragmented output ("the externally owned\\naccount" -> "外部交易 拥有的帐户").
    Paragraph breaks and bullet starts are preserved.
    """
    text = re.sub(r"\n(?!\n)(?!\s*[•*-]\s)", " ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def clean_markdown(text: str) -> str:
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"~~~.*?~~~", " ", text, flags=re.S)
    text = re.sub(r"^\s*\|.*\|\s*$", " ", text, flags=re.M)
    text = re.sub(r"^\s*\[\^[^\]]+\]:.*$", " ", text, flags=re.M)
    text = re.sub(r"\[\^[^\]]+\]", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^\s*[-*+]\s+", "• ", text, flags=re.M)
    text = re.sub(r"[`*_]{1,3}", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return join_soft_wraps(text)


def clean_mediawiki(text: str) -> str:
    text = re.sub(r"<ref[^>]*>.*?</ref>", " ", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\{\{.*?\}\}", " ", text, flags=re.S)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\]", " ", text)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"^\s*[*#:;]+\s*", "• ", text, flags=re.M)
    text = re.sub(r"^----+$", " ", text, flags=re.M)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return join_soft_wraps(text)


def clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in ("\n\n", ". ", "。"):
        index = cut.rfind(sep)
        if index > limit * 0.55:
            return cut[: index + len(sep)].strip()
    return cut.rstrip() + "…"


# --------------------------------------------------------------------------
# Translation term protection
# --------------------------------------------------------------------------

# Machine translation happily turns "EIP" into "生态产业园" (eco-industrial park).
# Wrap protocol vocabulary in opaque markers before translating and restore it
# afterwards so standard names survive untouched.
PROTECT_PATTERNS = [
    r"\b(?:EIP|ERC|BIP|RIP)-\d+\b",
    r"\b(?:EIP|ERC|BIP|RIP)s\b",
    r"\b(?:EIP|ERC|BIP|RIP)\b",
    r"\b(?:EVM|EOF|EOA|EOAs|ABI|RLP|SSZ|P2P|DEX|NFT|DeFi|DAO|MEV|RPC|API|JSON|YAML|KZG|BLS|ECDSA|ZK|SNARK|STARK|PoS|PoW)\b",
    r"\b(?:L1|L2|L3)\b",
    r"\b(?:Taproot|SegWit|Schnorr|Merkle|keccak256|secp256k1|Solidity|Vyper)\b",
    r"\b(?:calldata|opcode|mempool|nonce|gas|blob|blobs|rollup|rollups|testnet|mainnet)\b",
]

PROTECT_RE = re.compile("|".join(f"(?:{p})" for p in PROTECT_PATTERNS), re.I)


def protect_terms(text: str) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        token = f"XQX{len(mapping)}QXZ"
        mapping[token] = match.group(0)
        return token

    return PROTECT_RE.sub(replace, text), mapping


def restore_terms(text: str, mapping: dict[str, str]) -> str:
    for token, original in mapping.items():
        if token in text:
            text = text.replace(token, original)
            continue
        # Google sometimes re-spaces Latin tokens; tolerate that.
        pattern = re.escape(token[3:-3])
        text = re.sub(rf"X\s*Q\s*X\s*{pattern}\s*Q\s*X\s*Z", original, text)
    return text


# Curated fixes for terms the public MT engine renders inconsistently.
# Applied after translation, so updating it never requires re-requesting text.
ZH_GLOSSARY: list[tuple[str, str]] = [
    ("帐户", "账户"),
    ("打字交易", "类型化交易"),
    ("不可替代代币", "非同质化代币"),
    ("助记码", "助记词"),
    ("助记符", "助记词"),
    ("外部交易 拥有", "外部拥有"),
    ("外部拥有的帐户", "外部拥有账户"),
    ("生态产业园", "改进提案"),
    ("硬分叉变化", "硬分叉变更"),
    ("消费规则", "花费规则"),
    ("花费时间", "花费时"),
]


def normalize_zh(text: str) -> str:
    if not text:
        return text
    for source, target in ZH_GLOSSARY:
        if source != target and source in text:
            text = text.replace(source, target)
    return text


# --------------------------------------------------------------------------
# Tagging / impact heuristics
# --------------------------------------------------------------------------

TAG_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("账户抽象", ("account abstraction", "eoa", "delegation", "smart account", "paymaster", "useroperation", "user operation", "4337", "7702")),
    ("交易格式", ("transaction type", "transaction envelope", "2718", "calldata", "access list", "typed transaction", "transaction format")),
    ("费用市场", ("fee market", "base fee", "gas price", "priority fee", "1559", "blob fee", "gas cost", "gas limit", "transaction fee")),
    ("质押与共识", ("proof of stake", "validator", "staking", "beacon", "fork choice", "finality", "attestation", "proof-of-stake")),
    ("扩容与 L2", ("rollup", "layer 2", "layer-2", "blob", "sharding", "data availability", "danksharding", "scalability", "throughput")),
    ("密码学与签名", ("signature scheme", "schnorr", "bls ", "ecdsa", "secp256k1", "zero-knowledge", "zero knowledge", "kzg", "merkle tree", "cryptograph")),
    ("EVM 与操作码", ("opcode", "evm bytecode", "stack item", "memory expansion", "precompile", "evm interpreter")),
    ("P2P 网络", ("devp2p", "peer-to-peer", "p2p", "gossip", "discovery protocol", "message propagation", "encrypted transport")),
    ("钱包与密钥", ("hd wallet", "wallet", "mnemonic", "key derivation", "keystore", "hardware wallet", "seed phrase")),
    ("代币标准", ("erc-20", "erc-721", "erc-1155", "fungible token", "non-fungible", "nft", "token standard", "token contract", "tokenized vault")),
    ("DeFi 与金融", ("defi", "lending", "automated market maker", "oracle", "flash loan", "decentralized exchange", "liquidity pool", "stablecoin", "auction")),
    ("隐私", ("privacy", "anonymous", "anonymity", "stealth address", "confidential", "mixer", "ring signature")),
    ("跨链与互操作", ("cross-chain", "bridge", "message passing", "interoperab", "replay protection")),
    ("合约接口", ("interface standard", "abi", "function selector", "erc-165", "introspection")),
    ("安全与攻击面", ("reentrancy", "vulnerab", "attack surface", "denial of service", "exploit", "security vulnerability")),
    ("治理与流程", ("proposal process", "eip process", "bip process", "governance", "bip editors")),
    ("比特币脚本", ("bitcoin script", "opcode", "sighash", "taproot", "segwit", "psbt", "multisig", "timelock", "covenant", "scriptpubkey", "witness")),
    ("地址与格式", ("address format", "bech32", "base58", "checksum", "serialization format")),
]

STATUS_ZH = {
    "final": "已定稿",
    "draft": "草案",
    "review": "评审中",
    "last call": "最后征求意见",
    "stagnant": "已停滞",
    "withdrawn": "已撤回",
    "living": "持续更新",
    "moved": "已迁移",
    "deployed": "已部署",
    "closed": "已关闭",
    "complete": "已完成",
    "rejected": "已拒绝",
    "replaced": "已被替代",
    "superseded": "已被取代",
    "active": "活跃",
    "proposed": "已提议",
    "obsolete": "已废弃",
}

TYPE_ZH = {
    "standards track": "标准轨道",
    "meta": "元提案",
    "informational": "信息性",
    "specification": "规范",
    "process": "流程",
}

CATEGORY_ZH = {
    "core": "核心协议",
    "erc": "应用层标准",
    "interface": "接口",
    "networking": "网络",
    "applications": "应用层",
    "consensus (soft fork)": "共识（软分叉）",
    "consensus (hard fork)": "共识（硬分叉）",
    "peer services": "节点服务",
    "api/rpc": "API/RPC",
}


def zh_status(value: str) -> str:
    return STATUS_ZH.get((value or "").strip().lower(), value or "未知")


def zh_type(value: str) -> str:
    return TYPE_ZH.get((value or "").strip().lower(), value or "未分类")


def zh_category(value: str) -> str:
    return CATEGORY_ZH.get((value or "").strip().lower(), value or "")


BITCOIN_ONLY_TAGS = {"比特币脚本", "地址与格式"}
ETHEREUM_ONLY_TAGS = {"账户抽象", "EVM 与操作码", "质押与共识", "扩容与 L2", "代币标准", "合约接口"}

_TAG_REGEX_CACHE: dict[str, re.Pattern[str]] = {}


def _tag_pattern(needles: tuple[str, ...]) -> re.Pattern[str]:
    """Word-boundary matching so ``defi`` cannot hit ``define`` or ``abi`` hit ``ability``."""
    cached = _TAG_REGEX_CACHE.get(str(needles))
    if cached:
        return cached
    parts = []
    for needle in needles:
        escaped = re.escape(needle)
        if re.fullmatch(r"[A-Za-z0-9 ._-]+", needle):
            parts.append(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])")
        else:
            parts.append(escaped)
    pattern = re.compile("|".join(parts))
    _TAG_REGEX_CACHE[str(needles)] = pattern
    return pattern


def detect_tags(*texts: str, family: str = "") -> list[str]:
    haystack = " ".join(texts).lower()
    tags = []
    for label, needles in TAG_RULES:
        if family == "BIP" and label in ETHEREUM_ONLY_TAGS:
            continue
        if family in ("EIP", "ERC") and label in BITCOIN_ONLY_TAGS:
            continue
        if _tag_pattern(needles).search(haystack):
            tags.append(label)
    return tags[:6]


def impact_level(status: str, type_: str, category: str, layer: str, refs: int) -> tuple[str, str]:
    score = 0
    reasons = []
    status_l = (status or "").lower()
    type_l = (type_ or "").lower()
    category_l = (category or "").lower()
    layer_l = (layer or "").lower()

    if status_l in ("final", "deployed", "living", "complete", "active"):
        score += 2
        reasons.append("已落地或定稿")
    elif status_l in ("last call", "review", "draft", "proposed"):
        score += 1
        reasons.append("仍在推进中")
    if "core" in category_l or "consensus" in layer_l:
        score += 2
        reasons.append("触及核心协议/共识")
    if refs >= 10:
        score += 2
        reasons.append(f"被 {refs} 个提案引用")
    elif refs >= 3:
        score += 1
        reasons.append(f"被 {refs} 个提案引用")
    if type_l in ("standards track", "specification") and (
        "core" in category_l or "consensus" in layer_l
    ):
        score += 1
    if score >= 4:
        level = "高"
    elif score >= 2:
        level = "中"
    else:
        level = "低"
    return level, "、".join(reasons) if reasons else "影响范围相对局部"


def impact_summary(
    family: str,
    type_zh: str,
    category_zh: str,
    status_zh: str,
    level: str,
    reasons: str,
    tags: list[str],
    created_year: int | None,
    requires: list[int],
    required_by: int,
) -> str:
    scope = f"{type_zh}{('·' + category_zh) if category_zh else ''}"
    sentence = f"{family} 属于{scope}，当前状态为{status_zh}。"
    sentence += f"影响面评估为{level}级：{reasons}。"
    if tags:
        sentence += f"主要涉及{'、'.join(tags[:4])}。"
    if requires:
        sentence += f"依赖 {len(requires)} 个前置提案。"
    if created_year:
        sentence += f"提案创建于 {created_year} 年。"
    return sentence


# --------------------------------------------------------------------------
# Proposal builders
# --------------------------------------------------------------------------


def clean_inline(text: str) -> str:
    """Flatten markdown/HTML inline syntax for titles and one-line descriptions."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[`*_]{1,3}", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _base_proposal(
    *,
    family: str,
    number: int,
    title: str,
    description: str,
    status: str,
    type_: str,
    category: str,
    layer: str,
    authors: list[str],
    created: str,
    requires: list[int],
    source_url: str,
    source_path: str,
    license_: str,
    discussion: str,
    sections: dict[str, str],
    format_: str,
) -> dict:
    abstract = sections.get("abstract", "")
    title = clean_inline(title)
    description = clean_inline(description)
    tags = detect_tags(
        title, description, abstract, sections.get("motivation", ""), family=family
    )
    return {
        "family": family,
        "number": number,
        "id": f"{family}-{number}",
        "title": title,
        "description": description,
        "status": status,
        "type": type_,
        "category": category,
        "layer": layer,
        "authors": authors,
        "created": created,
        "year": int(created[:4]) if re.match(r"^\d{4}", created or "") else None,
        "requires": requires,
        "sourceUrl": source_url,
        "sourcePath": source_path,
        "license": license_,
        "discussion": discussion,
        "format": format_,
        "tags": tags,
        "sections": sections,
    }


def parse_eip(text: str, family: str, number: int, repo: str, branch: str, path: str) -> dict | None:
    meta, body = _split_front_matter(text)
    status = meta.get("status", "")
    if status.strip().lower() == "moved":
        return None
    title = meta.get("title", "")
    if not title:
        return None
    sections_raw = extract_sections(body, mediawiki=False)
    hierarchical = extract_sections_hierarchical(body, mediawiki=False)
    sections = {
        "abstract": clip(clean_markdown(find_section(hierarchical, sections_raw, "abstract")), 4000),
        "motivation": clip(clean_markdown(find_section(hierarchical, sections_raw, "motivation")), 4000),
        "rationale": clip(clean_markdown(find_section(hierarchical, sections_raw, "rationale")), 4000),
        "backwards": clip(clean_markdown(find_section(hierarchical, sections_raw, "backwards")), 2500),
        "security": clip(clean_markdown(find_section(hierarchical, sections_raw, "security")), 3000),
    }
    if not sections["abstract"]:
        sections["abstract"] = clip(first_paragraph(body, clean_markdown), 1200)
    created = meta.get("created", "")
    return _base_proposal(
        family=family,
        number=number,
        title=title,
        description=meta.get("description", ""),
        status=status,
        type_=meta.get("type", ""),
        category=meta.get("category", ""),
        layer="",
        authors=parse_people(meta.get("author", "")),
        created=created,
        requires=parse_numbers(meta.get("requires", "")),
        source_url=f"https://github.com/{repo}/blob/{branch}/{path}",
        source_path=path,
        license_=meta.get("license", ""),
        discussion=meta.get("discussions-to", ""),
        sections=sections,
        format_="markdown",
    )


def parse_bip(text: str, number: int, repo: str, branch: str, path: str, mediawiki: bool) -> dict | None:
    meta, body = _split_pre_header(text)
    # Some BIPs carry a second header block in markdown front matter style.
    if not meta:
        meta, body = _split_front_matter(text)
    title = meta.get("title", "")
    if not title:
        return None
    sections_raw = extract_sections(body, mediawiki=mediawiki)
    hierarchical = extract_sections_hierarchical(body, mediawiki=mediawiki)
    cleaner = clean_mediawiki if mediawiki else clean_markdown
    sections = {
        "abstract": clip(cleaner(find_section(hierarchical, sections_raw, "abstract")), 4000),
        "motivation": clip(cleaner(find_section(hierarchical, sections_raw, "motivation")), 4000),
        "rationale": clip(cleaner(find_section(hierarchical, sections_raw, "rationale")), 4000),
        "backwards": clip(cleaner(find_section(hierarchical, sections_raw, "backwards")), 2500),
        "security": clip(cleaner(find_section(hierarchical, sections_raw, "security")), 3000),
    }
    if not sections["abstract"]:
        sections["abstract"] = clip(first_paragraph(body, cleaner), 1200)
    return _base_proposal(
        family="BIP",
        number=number,
        title=title,
        description="",
        status=meta.get("status", ""),
        type_=meta.get("type", ""),
        category="",
        layer=meta.get("layer", ""),
        authors=parse_people(meta.get("authors", "")),
        created=meta.get("assigned", ""),
        requires=parse_numbers(meta.get("requires", "")),
        source_url=f"https://github.com/{repo}/blob/{branch}/{path}",
        source_path=path,
        license_=meta.get("license", ""),
        discussion=meta.get("discussion", ""),
        sections=sections,
        format_="mediawiki" if mediawiki else "markdown",
    )

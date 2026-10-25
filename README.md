# 链上提案库 · EIP / ERC / BIP 中文索引

把 Ethereum 的 **EIP / ERC** 与 Bitcoin 的 **BIP** 提案抓下来，解析元数据、翻译成中文、生成一个纯静态站点，并通过 GitHub Actions 每 6 小时自动同步与发布。

线上站点结构：

- `site/index.html` — 检索、筛选、排序、数据概览
- `site/detail.html` — 单个提案的中英对照详情、依赖关系、影响面评估
- `site/about.html` — 数据来源与方法论说明

## 数据源

| 家族 | 仓库 | 文件 |
| --- | --- | --- |
| EIP | [ethereum/EIPs](https://github.com/ethereum/EIPs) | `EIPS/eip-*.md`（YAML front matter） |
| ERC | [ethereum/ERCs](https://github.com/ethereum/ERCs) | `ERCS/erc-*.md`（YAML front matter） |
| BIP | [bitcoin/bips](https://github.com/bitcoin/bips) | `bip-*.mediawiki` / `bip-*.md`（`<pre>` 头部块） |

抓取使用 `codeload.github.com` 的仓库压缩包（一次全量，不消耗 API 配额），再用 GitHub API 记录每个仓库最新 commit 作为数据版本锚点。

当前收录规模：**EIP 605 + ERC 624 + BIP 214 = 1443 个提案**（EIP 仓库里 365 个 `status: Moved` 的占位文件已排除，其正文在 ERC 仓库中）。

## 本地运行

```bash
python3 scripts/pipeline.py            # 抓取 + 翻译 + 构建（首次约 15 分钟）
python3 scripts/pipeline.py --refresh  # 强制重新下载官方仓库
python3 scripts/check_site.py          # 产物自检

python3 -m http.server 8080 -d site    # 本地预览 → http://localhost:8080
```

无需安装任何第三方依赖，只使用 Python 标准库。

### 分步执行

```bash
python3 scripts/fetch.py               # → data/proposals_raw.json, data/meta.json
python3 scripts/translate.py           # → data/proposals.json（含中文）
python3 scripts/build_site.py          # → site/data/*.json
```

`translate.py` 支持 `--no-translate`（跳过网络，产出英文回填结构）、`--workers N`、`--max-items N`。

## 翻译机制

- 翻译标题、描述，以及摘要 / 动机 / 设计理由 / 向后兼容性 / 安全考量五个章节。
- 请求走 Google Translate 公共接口（`translate_a/t`，支持单次多段批量）；失败时回退 MyMemory。
- 结果按 **源文本哈希** 缓存到 `data/cache/translations.json`，命中即跳过，增量同步只翻译新增内容。
- 翻译前用占位符保护 `EIP-7702`、`EVM`、`EOA`、`Taproot`、`Schnorr`、`gas` 等协议术语，避免 Google 把 `EIP` 误译成「生态产业园」。
- 机器翻译只用于理解；详情页提供「中文 / EN」切换与官方原文链接。

> macOS 上脚本会自动读取 `scutil --proxy`；其他平台请设置 `HTTPS_PROXY`。GitHub Actions runner 位于公网，无需代理。

## 分类与影响面

**分类字段**：家族（EIP/ERC/BIP）、状态、类型（Standards Track / Meta / Informational / Specification / Process）、分类或层（Core / ERC / Interface / Networking / Consensus 等）。

**主题标签**：17 类规则式关键词匹配（账户抽象、交易格式、费用市场、质押与共识、扩容与 L2、密码学与签名、P2P 网络、钱包与密钥、代币标准、DeFi、隐私、跨链、合约接口、安全、治理、比特币脚本、地址格式）。

**影响面高/中/低**：综合「状态是否落地」「是否触及核心协议或共识层」「被其他提案引用次数」「提案类型」打分，纯启发式，非官方评级。详情页同时给出依赖 graph 的前置提案与入度引用数。

**依赖图**：解析 `requires` 字段，在同一编号空间（EIP+ERC 合并，BIP 独立）内建立双向引用，用于「被引用次数」和详情页的相关提案聚类。

## GitHub Pages 部署

仓库已包含 `.github/workflows/deploy.yml`：

1. `schedule: "0 */6 * * *"` 每 6 小时运行一次；也支持 `workflow_dispatch`（可勾选 `full_refresh` 清空翻译缓存）。
2. 运行 `scripts/pipeline.py --refresh`，然后提交 `data/` 与 `site/data/` 的变更。
3. 通过 `actions/deploy-pages` 发布 `site/` 目录。

启用步骤：

```bash
git init && git add . && git commit -m "feat: proposal zh index"
git branch -M main
git remote add origin git@github.com:<你的账号>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
如果站点部署在子路径（`https://<user>.github.io/<repo>/`），页面里全部使用相对路径，无需额外配置。

`validate.yml` 会在 PR 上跑一次无网络的解析 + 构建 + 自检，保证流水线不会因为格式变化而静默失败。

## 目录结构

```
scripts/
  lib_parse.py     # 元数据/章节解析、术语保护、标签与影响面打分
  fetch.py         # 下载官方仓库并解析 → data/proposals_raw.json
  translate.py     # 中英翻译 + 缓存 → data/proposals.json
  build_site.py    # 拆分列表/详情/统计 → site/data/*.json
  check_site.py    # 产物完整性自检
  pipeline.py      # 串联以上步骤
site/
  index.html detail.html about.html
  assets/style.css app.js detail.js favicon.svg
  data/            # 构建产物（index / stats / featured / detail/*.json）
.github/workflows/
  deploy.yml       # 每 6 小时同步 + 发布 Pages
  validate.yml     # PR 冒烟检查
```

## 版权

EIP/ERC 文档为 CC0 1.0；BIP 文档采用各文件头部声明的许可证。本站仅做索引、翻译与展示，原文版权归各提案作者所有，与 Ethereum Foundation / Bitcoin Core 无隶属关系。

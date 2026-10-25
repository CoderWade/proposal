/* 链上提案库 — detail page */
(() => {
  "use strict";

  const SECTION_META = [
    { key: "abstract", zh: "摘要", en: "Abstract" },
    { key: "motivation", zh: "动机", en: "Motivation" },
    { key: "rationale", zh: "设计理由", en: "Rationale" },
    { key: "backwards", zh: "向后兼容性", en: "Backwards Compatibility" },
    { key: "security", zh: "安全考量", en: "Security Considerations" },
  ];

  const FAMILY_COLOR = { EIP: "var(--eth)", ERC: "var(--erc)", BIP: "var(--btc)" };
  const IMPACT_COLOR = { 高: "var(--red)", 中: "var(--amber)", 低: "var(--muted)" };
  const LANG_KEY = "proposal-detail-lang";
  const UI = window.UI;

  const $ = (sel) => document.querySelector(sel);
  const esc = UI.esc;

  function statusClass(status) {
    const s = String(status || "").toLowerCase().replace(/\s+/g, "");
    if (["final", "deployed", "complete", "living", "active"].includes(s)) return "st-" + s;
    if (s === "lastcall") return "st-lastcall";
    if (["draft", "review", "proposed"].includes(s)) return "st-" + s;
    if (["stagnant", "closed", "obsolete"].includes(s)) return "st-" + s;
    if (["withdrawn", "rejected"].includes(s)) return "st-" + s;
    return "st-stagnant";
  }

  function lang() {
    try {
      return localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
    } catch (_) {
      return "zh";
    }
  }

  function setLang(value) {
    try {
      localStorage.setItem(LANG_KEY, value);
    } catch (_) {}
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().slice(0, 10);
  }

  function renderBadges(item) {
    const color = FAMILY_COLOR[item.family] || "var(--accent)";
    const badges = [
      `<span class="status-pill ${statusClass(item.status)}">${esc(item.statusZh || item.status)}</span>`,
      item.typeZh ? `<span class="meta-badge">类型 <b>${esc(item.typeZh)}</b></span>` : "",
      item.categoryZh ? `<span class="meta-badge">${esc(item.categoryZh)}</span>` : "",
      item.layer ? `<span class="meta-badge">${esc(item.layer)}</span>` : "",
      item.year ? `<span class="meta-badge"><b>${item.year}</b></span>` : "",
    ];
    $("#detailBadges").innerHTML = badges.filter(Boolean).join("");
    $("#detailId").textContent = item.id;
    $("#detailId").style.setProperty("--family-color", color);
    $("#detailId").style.color = color;
    $("#detailId").style.borderColor = `color-mix(in srgb, ${color} 32%, transparent)`;
    $("#detailId").style.background = `color-mix(in srgb, ${color} 9%, transparent)`;
    document.title = `${item.id} ${item.titleZh || item.title} · 链上提案库`;
  }

  function renderMeta(item) {
    const rows = [
      ["编号", item.id],
      ["家族", { EIP: "以太坊改进提案", ERC: "以太坊应用层标准", BIP: "比特币改进提案" }[item.family] || item.family],
      ["状态", item.statusZh || item.status],
      ["类型", item.typeZh || "—"],
      ["分类", item.categoryZh || item.layer || "—"],
      ["创建", formatDate(item.created)],
      ["被引用", `${item.requiredByCount || 0} 次`],
      ["许可证", item.license || "—"],
    ];
    $("#metaList").innerHTML = rows
      .map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`)
      .join("");
  }

  function renderSection(section, item, chosenLang) {
    const data = item.sections?.[section.key] || {};
    const zhText = data.zh || "";
    const enText = data.en || "";
    const hasZh = Boolean(zhText.trim());
    const active = chosenLang === "en" || !hasZh ? "en" : "zh";
    const body = active === "en" ? enText : zhText;
    const toggle =
      hasZh && enText
        ? `<div class="lang-toggle" data-section="${section.key}">
             <button type="button" data-lang="zh" class="${active === "zh" ? "active" : ""}">中文</button>
             <button type="button" data-lang="en" class="${active === "en" ? "active" : ""}">EN</button>
           </div>`
        : "";
    return `
      <section class="doc-section" id="sec-${section.key}">
        <div class="doc-section-head">
          <h2>${section.zh}<small>${section.en}</small></h2>
          ${toggle}
        </div>
        <div class="doc-body ${active === "en" ? "is-en" : "is-zh"}" data-section="${section.key}">${
          body ? esc(body) : "官方原文未提供此章节。"
        }</div>
      </section>`;
  }

  function renderSections(item) {
    const chosen = lang();
    const available = SECTION_META.filter((section) => {
      const data = item.sections?.[section.key];
      return data && ((data.zh && data.zh.trim()) || (data.en && data.en.trim()));
    });
    $("#sectionJump").innerHTML = available
      .map((section) => `<a href="#sec-${section.key}">${section.zh}</a>`)
      .join("");
    $("#sections").innerHTML = available.map((section) => renderSection(section, item, chosen)).join("");
    if (!available.length) {
      $("#sections").innerHTML = `<p class="muted">该提案没有可展示的结构化章节，请前往官方原文查看。</p>`;
    }

    $("#sections").addEventListener("click", (event) => {
      const button = event.target.closest(".lang-toggle button");
      if (!button) return;
      const key = button.closest(".lang-toggle").dataset.section;
      const value = button.dataset.lang;
      setLang(value);
      const data = item.sections?.[key] || {};
      const body = $("#sections").querySelector(`.doc-body[data-section="${key}"]`);
      if (!body) return;
      body.textContent = value === "en" ? data.en || data.zh : data.zh || data.en;
      body.classList.toggle("is-en", value === "en");
      body.classList.toggle("is-zh", value !== "en");
      button.parentElement
        .querySelectorAll("button")
        .forEach((el) => el.classList.toggle("active", el === button));
    });
  }

  function renderAside(item) {
    const authors = item.authors || [];
    $("#authorCard").hidden = !authors.length;
    $("#authorList").innerHTML = authors
      .map((author) => `<span>${esc(author)}</span>`)
      .join("");

    const requires = item.requiresDetail || [];
    $("#requiresCard").hidden = !requires.length;
    $("#requiresList").innerHTML = requires
      .map(
        (req) =>
          `<a class="requires-item" href="detail.html?id=${encodeURIComponent(req.id)}" data-tip="${esc(
            req.titleZh || req.title
          )}">${esc(req.id)}</a>`
      )
      .join("");

    const tags = item.tags || [];
    $("#tagCard").hidden = !tags.length;
    $("#tagList").innerHTML = tags
      .map((tag) => `<a class="chip" href="index.html?tag=${encodeURIComponent(tag)}">${esc(tag)}</a>`)
      .join("");

    $("#sourceLink").href = item.sourceUrl || "#";
    if (item.discussion) {
      const link = $("#discussionLink");
      link.href = item.discussion;
      link.hidden = false;
    }

    $("#impactLevel").textContent = item.impactLevel;
    $("#impactLevel").style.color = IMPACT_COLOR[item.impactLevel] || "var(--accent)";
    $("#impactCallout").style.setProperty(
      "--impact-color",
      IMPACT_COLOR[item.impactLevel] || "var(--accent)"
    );
    $("#impactText").textContent = item.impactZh || "暂无评估。";
  }

  function renderRelated(item) {
    const related = item.related || [];
    if (!related.length) return;
    const rows = related
      .map(
        (rel) => `
          <a class="related-item" href="detail.html?id=${encodeURIComponent(rel.id)}">
            <div class="ri-id">${esc(rel.id)} · ${esc(rel.statusZh)}</div>
            <div class="ri-title">${esc(rel.titleZh || rel.title)}</div>
          </a>`
      )
      .join("");
    if (!rows) return;
    $("#relatedGrid").innerHTML = rows;
    $("#relatedSection").hidden = false;
  }

  async function loadMeta() {
    try {
      const stats = await fetch(UI.dataUrl("data/stats.json"), { cache: "default" }).then((r) =>
        r.json()
      );
      if (stats.generatedAt) {
        $("#updatedAt").textContent = `数据生成于 ${new Date(stats.generatedAt).toLocaleString(
          "zh-CN",
          { hour12: false }
        )}`;
      }
    } catch (_) {}
  }

  function bindChrome() {
    UI.bindThemeToggle($("#themeToggle"));
    UI.initTooltips();
    UI.initIntentPrefetch();
    UI.initSearchBox($(".topbar-search"), () => {});

    $("#search").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const query = event.target.value.trim();
        location.href = query ? `index.html?q=${encodeURIComponent(query)}` : "index.html";
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        $("#search").focus();
      }
    });
  }

  async function init() {
    UI.initTheme();
    bindChrome();
    loadMeta();

    const params = new URLSearchParams(location.search);
    const id = (params.get("id") || "").trim().toUpperCase();
    if (!id) {
      $("#loading").hidden = true;
      $("#notFound").hidden = false;
      return;
    }

    try {
      const response = await fetch(UI.dataUrl(`data/detail/${id.toLowerCase()}.json`), {
        // The URL carries the build id, so a cached response can never be stale.
        cache: "default",
      });
      if (!response.ok) throw new Error(response.status);
      const item = await response.json();

      $("#crumbFamily").textContent = item.family;
      $("#crumbFamily").href = `index.html?family=${item.family}`;
      $("#crumbId").textContent = item.id;
      $("#detailTitle").textContent = item.titleZh || item.title;
      $("#detailTitleEn").textContent = item.titleZh ? item.title : "";
      $("#detailBadges").style.setProperty("--family-color", FAMILY_COLOR[item.family]);

      renderBadges(item);
      renderMeta(item);
      renderSections(item);
      renderAside(item);
      renderRelated(item);

      $("#loading").hidden = true;
      $("#detailWrap").hidden = false;
    } catch (error) {
      $("#loading").hidden = true;
      $("#notFound").hidden = false;
    }
  }

  init();
})();

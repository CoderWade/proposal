/* 链上提案库 — index page */
(() => {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    shown: 60,
    q: "",
    family: "all",
    status: "",
    type: "",
    impact: "",
    tag: "",
    year: "",
    sort: "number-asc",
  };

  const FAMILY_COLOR = { EIP: "var(--eth)", ERC: "var(--erc)", BIP: "var(--btc)" };
  const FAMILY_ORDER = { EIP: 0, ERC: 1, BIP: 2 };
  const IMPACT_RANK = { 高: 3, 中: 2, 低: 1 };
  const PAGE_SIZE = 60;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const debounce = (fn, wait) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  function statusClass(status) {
    const s = String(status || "").toLowerCase().replace(/\s+/g, "");
    if (["final", "deployed", "complete", "living", "active"].includes(s)) return "st-" + s;
    if (["lastcall"].includes(s)) return "st-lastcall";
    if (["draft", "review", "proposed"].includes(s)) return "st-" + s;
    if (["stagnant", "closed", "obsolete"].includes(s)) return "st-" + s;
    if (["withdrawn", "rejected"].includes(s)) return "st-" + s;
    return "st-stagnant";
  }

  function haystack(item) {
    if (!item._hay) {
      item._hay = [
        item.id,
        item.id.replace("-", ""),
        item.title,
        item.titleZh,
        item.description,
        item.descriptionZh,
        (item.tags || []).join(" "),
        item.statusZh,
        item.typeZh,
        item.categoryZh,
      ]
        .join(" ")
        .toLowerCase();
    }
    return item._hay;
  }

  function matchesQuery(item, query) {
    if (!query) return true;
    const hay = haystack(item);
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => hay.includes(token));
  }

  function sortItems(items) {
    const copy = items.slice();
    const byNumber = (a, b) =>
      (FAMILY_ORDER[a.family] ?? 9) - (FAMILY_ORDER[b.family] ?? 9) || a.number - b.number;
    switch (state.sort) {
      case "number-desc":
        return copy.sort((a, b) => b.number - a.number);
      case "newest":
        return copy.sort((a, b) => (b.year || 0) - (a.year || 0) || byNumber(a, b));
      case "impact":
        return copy.sort(
          (a, b) =>
            (IMPACT_RANK[b.impactLevel] || 0) - (IMPACT_RANK[a.impactLevel] || 0) ||
            (b.requiredByCount || 0) - (a.requiredByCount || 0) ||
            byNumber(a, b)
        );
      case "refs":
        return copy.sort(
          (a, b) => (b.requiredByCount || 0) - (a.requiredByCount || 0) || byNumber(a, b)
        );
      default:
        return copy.sort(byNumber);
    }
  }

  function applyFilters() {
    const query = state.q.trim();
    state.filtered = sortItems(
      state.all.filter((item) => {
        if (state.family !== "all" && item.family !== state.family) return false;
        if (state.status && item.statusZh !== state.status) return false;
        if (state.type && item.typeZh !== state.type) return false;
        if (state.impact && item.impactLevel !== state.impact) return false;
        if (state.tag && !(item.tags || []).includes(state.tag)) return false;
        if (state.year && String(item.year) !== state.year) return false;
        return matchesQuery(item, query);
      })
    );
    state.shown = PAGE_SIZE;
    renderResults();
    syncURL();
  }

  function cardHTML(item) {
    const color = FAMILY_COLOR[item.family] || "var(--accent)";
    const title = item.titleZh || item.title;
    const desc = item.descriptionZh || item.description || item.abstractZh || "";
    const tags = (item.tags || []).slice(0, 3)
      .map((tag) => `<span class="tag">${esc(tag)}</span>`)
      .join("");
    return `
      <a class="card" href="detail.html?id=${encodeURIComponent(item.id)}" style="--family-color:${color}">
        <div class="card-top">
          <span class="id-badge">${esc(item.id)}</span>
          <span class="status-pill ${statusClass(item.status)}">${esc(item.statusZh || item.status)}</span>
        </div>
        <h3>${esc(title)}</h3>
        ${item.titleZh ? `<p class="en-title">${esc(item.title)}</p>` : ""}
        ${desc ? `<p class="desc">${esc(desc)}</p>` : ""}
        <div class="card-tags">${tags}</div>
        <div class="card-foot">
          <div class="foot-left">
            <span class="impact impact-${esc(item.impactLevel)}"><i class="dot"></i>影响 ${esc(item.impactLevel)}</span>
            ${item.requiredByCount ? `<span class="refs">↗ ${item.requiredByCount} 次引用</span>` : ""}
          </div>
          <span class="year">${item.year || "—"}</span>
        </div>
      </a>`;
  }

  function renderResults() {
    const grid = $("#cardGrid");
    const slice = state.filtered.slice(0, state.shown);
    grid.innerHTML = slice.map(cardHTML).join("");
    $("#resultCount").textContent = state.filtered.length.toLocaleString("zh-CN");
    $("#emptyState").hidden = state.filtered.length !== 0;
    $("#loadMore").hidden = state.shown >= state.filtered.length;
    if (state.shown < state.filtered.length) {
      $("#loadMore").textContent = `加载更多（剩余 ${state.filtered.length - state.shown}）`;
    }
    const parts = [];
    if (state.q.trim()) parts.push(`“${state.q.trim()}”`);
    if (state.family !== "all") parts.push(state.family);
    if (state.status) parts.push(state.status);
    if (state.type) parts.push(state.type);
    if (state.impact) parts.push(`影响 ${state.impact}`);
    if (state.tag) parts.push(`#${state.tag}`);
    if (state.year) parts.push(`${state.year} 年`);
    $("#activeFilters").textContent = parts.length ? "· " + parts.join(" · ") : "";
  }

  function buildFilterOptions() {
    const familyScope =
      state.family === "all" ? state.all : state.all.filter((i) => i.family === state.family);
    const countBy = (arr, field) => {
      const map = new Map();
      arr.forEach((item) => {
        const value = item[field] || "未知";
        map.set(value, (map.get(value) || 0) + 1);
      });
      return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    };

    const statusSelect = $("#statusFilter");
    const statuses = countBy(familyScope, "statusZh");
    statusSelect.innerHTML =
      `<option value="">全部状态（${familyScope.length}）</option>` +
      statuses
        .map(([name, count]) => `<option value="${esc(name)}">${esc(name)}（${count}）</option>`)
        .join("");
    statusSelect.value = state.status;
    if (statusSelect.value !== state.status) {
      state.status = "";
      statusSelect.value = "";
    }

    const typeSelect = $("#typeFilter");
    const types = countBy(familyScope, "typeZh");
    typeSelect.innerHTML =
      `<option value="">全部类型</option>` +
      types
        .map(([name, count]) => `<option value="${esc(name)}">${esc(name)}（${count}）</option>`)
        .join("");
    typeSelect.value = state.type;
    if (typeSelect.value !== state.type) {
      state.type = "";
      typeSelect.value = "";
    }

    const tagCounts = new Map();
    familyScope.forEach((item) =>
      (item.tags || []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1))
    );
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    $("#tagFilter").innerHTML = topTags
      .map(
        ([tag, count]) =>
          `<button class="chip ${state.tag === tag ? "active" : ""}" data-tag="${esc(tag)}" type="button">${esc(tag)}<span class="n">${count}</span></button>`
      )
      .join("");

    $$("#impactFilter .chip").forEach((chip) => {
      chip.classList.toggle("active", state.impact === chip.dataset.impact);
      const count = state.all.filter(
        (i) =>
          i.impactLevel === chip.dataset.impact &&
          (state.family === "all" || i.family === state.family)
      ).length;
      const label = chip.dataset.impact;
      chip.innerHTML = `${label}<span class="n">${count}</span>`;
      chip.title = `${count} 个提案`;
    });

    $$("#familyFilter .seg").forEach((seg) => {
      const family = seg.dataset.family;
      const count =
        family === "all" ? state.all.length : state.all.filter((i) => i.family === family).length;
      const span = seg.querySelector("span");
      if (span) span.textContent = count.toLocaleString("zh-CN");
      seg.classList.toggle("active", state.family === family);
    });

    // Keep every active filter visible in the tag cloud.
    if (state.tag) {
      const cloud = $("#tagFilter");
      const exists = $$(".chip", cloud).some((chip) => chip.dataset.tag === state.tag);
      if (!exists) {
        cloud.insertAdjacentHTML(
          "afterbegin",
          `<button class="chip active" data-tag="${esc(state.tag)}" type="button">${esc(state.tag)}</button>`
        );
      }
    }
  }

  function renderStats(stats) {
    const counts = stats.counts || {};
    $$("#heroStats [data-stat]").forEach((el) => {
      const key = el.dataset.stat;
      const value = key === "translated" ? stats.translated : counts[key];
      el.textContent = (value ?? 0).toLocaleString("zh-CN");
    });
    const updated = stats.generatedAt
      ? new Date(stats.generatedAt).toLocaleString("zh-CN", { hour12: false })
      : "—";
    $("#updatedAt").textContent = `数据生成于 ${updated}`;

    const chart = (name, rows, field, limit = 8) => {
      const el = $(name);
      if (!el) return;
      const top = rows.slice(0, limit);
      const max = Math.max(...top.map((row) => row.count), 1);
      el.innerHTML = top
        .map(
          (row) => `
          <button class="bar-row" type="button" data-field="${field}" data-value="${esc(row.name)}">
            <span class="bar-name" title="${esc(row.name)}">${esc(row.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(row.count / max) * 100}%"></span></span>
            <span class="bar-value">${row.count}</span>
          </button>`
        )
        .join("");
    };

    chart("#statusChart", stats.status || [], "status");
    chart("#typeChart", stats.type || [], "type");
    chart("#tagChart", stats.tags || [], "tag", 9);

    const years = stats.years || [];
    if (years.length) {
      const max = Math.max(...years.map((y) => y.count), 1);
      $("#yearChart").innerHTML = years
        .map(
          (y) => `
          <button class="year-bar" type="button" data-year="${y.year}" title="${y.year} 年：${y.count} 个提案">
            <i style="height:${Math.max(3, (y.count / max) * 100)}%"></i>
            <span>${String(y.year).slice(2)}</span>
          </button>`
        )
        .join("");
    }
  }

  let featuredRendered = false;

  function renderFeatured(featured) {
    if (!featured || !featured.length) return;
    const byId = new Map(state.all.map((item) => [item.id, item]));
    const items = featured
      .map((entry) => ({ entry, item: byId.get(entry.id) }))
      .filter((row) => row.item);
    if (!items.length) return;
    $("#featuredGrid").innerHTML = items
      .map(({ entry, item }) => {
        const color = FAMILY_COLOR[item.family] || "var(--accent)";
        return `
          <a class="feature-card" href="detail.html?id=${encodeURIComponent(item.id)}" style="--family-color:${color}">
            <div class="fc-top">
              <span class="id-badge">${esc(item.id)}</span>
              <span class="status-pill ${statusClass(item.status)}">${esc(item.statusZh)}</span>
            </div>
            <h3>${esc(item.titleZh || item.title)}</h3>
            <p>${esc(entry.whyZh || "")}</p>
            <div class="fc-why">${esc(item.categoryZh || item.typeZh || "")} · ${item.year || ""}</div>
          </a>`;
      })
      .join("");
    $("#featuredSection").hidden = false;
    featuredRendered = true;
  }

  function syncURL() {
    const params = new URLSearchParams();
    if (state.q.trim()) params.set("q", state.q.trim());
    if (state.family !== "all") params.set("family", state.family);
    if (state.status) params.set("status", state.status);
    if (state.type) params.set("type", state.type);
    if (state.impact) params.set("impact", state.impact);
    if (state.tag) params.set("tag", state.tag);
    if (state.year) params.set("year", state.year);
    if (state.sort !== "number-asc") params.set("sort", state.sort);
    const query = params.toString();
    const url = query ? `${location.pathname}?${query}` : location.pathname;
    history.replaceState(null, "", url);
  }

  function readURL() {
    const params = new URLSearchParams(location.search);
    state.q = params.get("q") || "";
    state.family = params.get("family") || "all";
    state.status = params.get("status") || "";
    state.type = params.get("type") || "";
    state.impact = params.get("impact") || "";
    state.tag = params.get("tag") || "";
    state.year = params.get("year") || "";
    state.sort = params.get("sort") || "number-asc";
    const search = $("#search");
    if (search) search.value = state.q;
    const sort = $("#sortSelect");
    if (sort) sort.value = state.sort;
  }

  function resetFilters() {
    state.q = "";
    state.family = "all";
    state.status = "";
    state.type = "";
    state.impact = "";
    state.tag = "";
    state.year = "";
    state.sort = "number-asc";
    $("#search").value = "";
    $("#sortSelect").value = "number-asc";
    buildFilterOptions();
    applyFilters();
  }

  function bindEvents() {
    $("#search").addEventListener(
      "input",
      debounce((event) => {
        state.q = event.target.value;
        applyFilters();
      }, 110)
    );

    $("#familyFilter").addEventListener("click", (event) => {
      const button = event.target.closest(".seg");
      if (!button) return;
      state.family = button.dataset.family;
      state.status = "";
      state.type = "";
      state.tag = "";
      buildFilterOptions();
      applyFilters();
    });

    $("#statusFilter").addEventListener("change", (event) => {
      state.status = event.target.value;
      buildFilterOptions();
      applyFilters();
    });

    $("#typeFilter").addEventListener("change", (event) => {
      state.type = event.target.value;
      buildFilterOptions();
      applyFilters();
    });

    $("#impactFilter").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      state.impact = state.impact === chip.dataset.impact ? "" : chip.dataset.impact;
      buildFilterOptions();
      applyFilters();
    });

    $("#tagFilter").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      state.tag = state.tag === chip.dataset.tag ? "" : chip.dataset.tag;
      buildFilterOptions();
      applyFilters();
    });

    $("#sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      applyFilters();
    });

    $("#resetFilters").addEventListener("click", resetFilters);
    $("#emptyReset").addEventListener("click", resetFilters);

    $("#loadMore").addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      renderResults();
    });

    document.addEventListener("click", (event) => {
      const bar = event.target.closest(".bar-row");
      if (bar) {
        const field = bar.dataset.field;
        const value = bar.dataset.value;
        if (field === "status") state.status = state.status === value ? "" : value;
        if (field === "type") state.type = state.type === value ? "" : value;
        if (field === "tag") state.tag = state.tag === value ? "" : value;
        buildFilterOptions();
        applyFilters();
        $("#explorer").scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const yearBar = event.target.closest(".year-bar");
      if (yearBar) {
        const value = yearBar.dataset.year;
        state.year = state.year === value ? "" : value;
        buildFilterOptions();
        applyFilters();
        $("#explorer").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        $("#search").focus();
      }
      if (event.key === "Escape" && document.activeElement === $("#search")) {
        $("#search").blur();
      }
    });

    const themeToggle = $("#themeToggle");
    themeToggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("proposal-theme", next);
      } catch (_) {}
    });
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem("proposal-theme");
    } catch (_) {}
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  }

  async function loadJSON(path, fallback) {
    try {
      const response = await fetch(path, { cache: "no-cache" });
      if (!response.ok) throw new Error(response.status);
      return await response.json();
    } catch (error) {
      console.warn("load failed", path, error);
      return fallback;
    }
  }

  async function init() {
    initTheme();
    bindEvents();
    readURL();

    const [index, stats, featured] = await Promise.all([
      loadJSON("data/index.json", []),
      loadJSON("data/stats.json", null),
      loadJSON("data/featured.json", []),
    ]);

    state.all = Array.isArray(index) ? index : [];
    state.all.forEach((item) => {
      if (!item.statusZh) item.statusZh = item.status;
    });

    if (stats) renderStats(stats);
    renderFeatured(featured);
    buildFilterOptions();
    applyFilters();
    if (!featuredRendered) $("#featuredSection").hidden = true;
  }

  init();
})();

/* 链上提案库 — index page
 *
 * All interactive chrome comes from assets/ui.js (custom listbox, search
 * clear button, tooltips). No native <select>, native search decoration or
 * `title` bubbles are used anywhere on this page.
 */
(() => {
  "use strict";

  const UI = window.UI;
  const esc = UI.esc;

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

  const SORT_OPTIONS = [
    { value: "number-asc", label: "编号升序" },
    { value: "number-desc", label: "编号降序" },
    { value: "newest", label: "最新创建" },
    { value: "impact", label: "影响面优先" },
    { value: "refs", label: "被引用最多" },
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
    if (s === "lastcall") return "st-lastcall";
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
    // Sync the URL first: card links embed the current list URL as their
    // `from` context, so it has to be up to date before the cards are painted.
    syncURL();
    renderResults();
  }

  function listContext() {
    // `focus` is a return hint, not part of the list's own state.
    const params = new URLSearchParams(location.search);
    params.delete("focus");
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ""}`;
  }

  function cardHTML(item) {
    const color = FAMILY_COLOR[item.family] || "var(--accent)";
    const title = item.titleZh || item.title;
    const desc = item.descriptionZh || item.description || item.abstractZh || "";
    const tags = (item.tags || [])
      .slice(0, 3)
      .map((tag) => `<span class="tag">${esc(tag)}</span>`)
      .join("");
    const refs = item.requiredByCount
      ? `<span class="refs" data-tip="该提案被 ${item.requiredByCount} 个其他提案引用">↗ ${item.requiredByCount}</span>`
      : "";
    const href = `detail.html?id=${encodeURIComponent(item.id)}&from=${encodeURIComponent(
      listContext()
    )}`;
    return `
      <a class="card" data-id="${esc(item.id)}" href="${href}" style="--family-color:${color}">
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
            <span class="impact impact-${esc(item.impactLevel)}" data-tip="${esc(
      item.impactReasons || "影响面启发式评估"
    )}"><i class="dot"></i>影响 ${esc(item.impactLevel)}</span>
            ${refs}
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

  // ------------------------------------------------------------------
  // Selects
  // ------------------------------------------------------------------

  let statusSelect = null;
  let typeSelect = null;
  let sortSelect = null;

  function countBy(arr, field) {
    const map = new Map();
    arr.forEach((item) => {
      const value = item[field] || "未知";
      map.set(value, (map.get(value) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }

  function buildFilterOptions() {
    const familyScope =
      state.family === "all" ? state.all : state.all.filter((i) => i.family === state.family);

    const statuses = countBy(familyScope, "statusZh");
    // The app state is the source of truth: push it into the control before the
    // option labels are rebuilt, otherwise a stale control value would leak back.
    statusSelect.setValue(state.status);
    statusSelect.setOptions([
      { value: "", label: `全部状态（${familyScope.length}）` },
      ...statuses.map(([name, count]) => ({ value: name, label: `${name}（${count}）` })),
    ]);
    state.status = statusSelect.value;

    const types = countBy(familyScope, "typeZh");
    typeSelect.setValue(state.type);
    typeSelect.setOptions([
      { value: "", label: "全部类型" },
      ...types.map(([name, count]) => ({ value: name, label: `${name}（${count}）` })),
    ]);
    state.type = typeSelect.value;
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
          `<button class="chip ${state.tag === tag ? "active" : ""}" data-tag="${esc(tag)}" type="button" data-tip="${count} 个提案">${esc(
            tag
          )}<span class="n">${count}</span></button>`
      )
      .join("");

    $$("#impactFilter .chip").forEach((chip) => {
      chip.classList.toggle("active", state.impact === chip.dataset.impact);
      const count = familyScope.filter((i) => i.impactLevel === chip.dataset.impact).length;
      chip.innerHTML = `${esc(chip.dataset.impact)}<span class="n">${count}</span>`;
      chip.dataset.tip = `${count} 个提案`;
    });

    $$("#familyFilter .seg").forEach((seg) => {
      const family = seg.dataset.family;
      const count =
        family === "all" ? state.all.length : state.all.filter((i) => i.family === family).length;
      const span = seg.querySelector("span");
      if (span) span.textContent = count.toLocaleString("zh-CN");
      seg.classList.toggle("active", state.family === family);
    });

    if (state.tag) {
      const cloud = $("#tagFilter");
      const exists = $$(".chip", cloud).some((chip) => chip.dataset.tag === state.tag);
      if (!exists) {
        cloud.insertAdjacentHTML(
          "afterbegin",
          `<button class="chip active" data-tag="${esc(state.tag)}" type="button">${esc(
            state.tag
          )}</button>`
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Stats / charts
  // ------------------------------------------------------------------

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
          <button class="bar-row" type="button" data-field="${field}" data-value="${esc(
            row.name
          )}" data-tip="点击按「${esc(row.name)}」筛选">
            <span class="bar-name">${esc(row.name)}</span>
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
          <button class="year-bar" type="button" data-year="${y.year}" data-tip="${
            y.year
          } 年：${y.count} 个提案">
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
    // `focus` is a return anchor, not a filter; keep it so a reload or a
    // filter change does not silently lose which card we came back to.
    if (lastFocusId) params.set("focus", lastFocusId);
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
    if (search) search.dispatchEvent(new Event("input", { bubbles: true }));
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
    $("#search").dispatchEvent(new Event("input", { bubbles: true }));
    sortSelect.setValue("number-asc");
    buildFilterOptions();
    applyFilters();
  }

  // ------------------------------------------------------------------
  // Scroll memory + return-to-card
  //
  // bfcache restores scroll for free on a plain history.back(), but a fresh
  // load (new tab, hard refresh, expired bfcache) starts at the top. The list
  // therefore remembers how many cards were expanded and where the visitor
  // was, and a `?focus=<id>` link scrolls straight back to that proposal.
  // ------------------------------------------------------------------

  const SCROLL_KEY = "proposal-list-state";

  // The card the visitor left from. Two things overwrite the stored value with
  // an empty id if it only lives in sessionStorage: the `pagehide` that fires
  // right after a card click, and the scroll event triggered by restoring the
  // position on the next load. Keeping it in memory (and re-seeding it from
  // storage on load) makes every later save carry the id forward.
  let lastFocusId = "";

  function saveListState(focusId) {
    if (focusId) lastFocusId = focusId;
    // A restored or refreshed list keeps the anchor in its own URL; fall back to
    // it so a scroll-triggered save cannot erase which card we came from.
    if (!lastFocusId) {
      lastFocusId = new URLSearchParams(location.search).get("focus") || "";
    }
    try {
      sessionStorage.setItem(
        SCROLL_KEY,
        JSON.stringify({
          scrollY: Math.round(window.scrollY),
          shown: state.shown,
          url: location.search,
          focus: lastFocusId,
          at: Date.now(),
        })
      );
    } catch (_) {}
  }

  function readListState() {
    try {
      const raw = sessionStorage.getItem(SCROLL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Ignore stale state from an unrelated list session.
      if (Date.now() - (parsed.at || 0) > 6 * 60 * 60 * 1000) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function restoreScroll(saved) {
    if (!saved || !saved.scrollY) return;
    // Wait a frame so the restored cards are laid out before scrolling.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: "instant" }));
    });
  }

  // Highlight only — used when bfcache has already restored the exact scroll
  // offset, so scrolling again would fight the browser's own restoration.
  function highlightCard(id) {
    if (!id) return false;
    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return false;
    card.classList.add("is-returned");
    card.setAttribute("aria-current", "true");
    setTimeout(() => card.classList.remove("is-returned"), 2200);
    return true;
  }

  function focusCard(id) {
    if (!id) return false;
    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) return false;

    highlightCard(id);

    const top = card.getBoundingClientRect().top + window.scrollY - 90;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, top), behavior: "instant" }));
      card.focus({ preventScroll: true });
    });
    return true;
  }

  // Ensure a focused card is visible even if it sits past the first page.
  function ensureCardRendered(id) {
    if (!id) return;
    const index = state.filtered.findIndex((item) => item.id === id);
    if (index < 0) return;
    if (index >= state.shown) {
      state.shown = Math.min(
        state.filtered.length,
        Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE
      );
      renderResults();
    }
  }

  function bindEvents() {
    UI.initSearchBox($(".topbar-search"), () => {
      state.q = "";
      applyFilters();
    });

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
  }

  async function loadJSON(path, fallback) {
    try {
      // Versioned URL, so using the HTTP cache is safe and makes revisits free.
      const response = await fetch(UI.dataUrl(path), { cache: "default" });
      if (!response.ok) throw new Error(response.status);
      return await response.json();
    } catch (error) {
      console.warn("load failed", path, error);
      return fallback;
    }
  }

  function showUpdateBanner() {
    if (document.querySelector(".update-banner")) return;
    const bar = document.createElement("div");
    bar.className = "update-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML = `
      <span>数据已更新到新版本。</span>
      <button type="button" class="update-banner-btn">立即刷新</button>
      <button type="button" class="update-banner-dismiss" aria-label="暂不刷新">×</button>`;
    document.body.appendChild(bar);
    bar.querySelector(".update-banner-btn").addEventListener("click", () => location.reload());
    bar.querySelector(".update-banner-dismiss").addEventListener("click", () => bar.remove());
  }

  async function init() {
    UI.initTheme();
    UI.initTooltips();
    UI.initIntentPrefetch();
    UI.bindThemeToggle($("#themeToggle"));
    readURL();

    statusSelect = UI.createSelect($("#statusSelect"), {
      onChange: (value) => {
        state.status = value;
        buildFilterOptions();
        applyFilters();
      },
    });
    typeSelect = UI.createSelect($("#typeSelect"), {
      onChange: (value) => {
        state.type = value;
        buildFilterOptions();
        applyFilters();
      },
    });
    sortSelect = UI.createSelect($("#sortSelect"), {
      value: state.sort,
      onChange: (value) => {
        state.sort = value;
        applyFilters();
      },
    });
    sortSelect.setOptions(SORT_OPTIONS);

    bindEvents();

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

    // A returning visitor gets the same number of cards they had expanded,
    // then either the exact card they clicked (?focus=) or their scroll offset.
    const params = new URLSearchParams(location.search);
    const focusId = params.get("focus");
    const saved = readListState();
    if (saved?.focus) lastFocusId = saved.focus;

    applyFilters();

    // applyFilters resets pagination, so re-expand afterwards when returning.
    if (saved && !focusId && saved.shown > state.shown) {
      state.shown = Math.min(state.filtered.length, saved.shown);
      renderResults();
    }
    if (!featuredRendered) $("#featuredSection").hidden = true;

    if (focusId) {
      ensureCardRendered(focusId);
      if (focusCard(focusId)) {
        // Keep the anchor in the URL so a refresh or a copied link still lands
        // on this proposal.
        try {
          const keep = new URLSearchParams(location.search);
          keep.set("focus", focusId);
          history.replaceState(null, "", `${location.pathname}?${keep.toString()}`);
        } catch (_) {}
      } else {
        restoreScroll(saved);
      }
    } else if (saved) {
      restoreScroll(saved);
      // The document may be restored by bfcache (init never re-runs) or rebuilt
      // from scratch; highlight in both cases so the origin card is obvious.
      highlightCard(saved.focus);
    }

    // Returning through the browser's back button hits bfcache: the document is
    // restored as-is (scroll already correct) and init() never re-runs, so the
    // highlight has to be applied here.
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      const state2 = readListState();
      if (state2?.focus) highlightCard(state2.focus);
    });

    // Keep the last position when leaving for a proposal, and on unload.
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.("a.card");
        if (link) saveListState(link.dataset.id);
      },
      true
    );
    window.addEventListener("pagehide", () => saveListState());
    let scrollTimer = 0;
    window.addEventListener(
      "scroll",
      () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => saveListState(), 250);
      },
      { passive: true }
    );

    UI.watchBuild(showUpdateBanner);
  }

  init();
})();

/* 链上提案库 — shared UI primitives
 *
 * Every interactive control the visitor touches is drawn by the site itself:
 * custom listbox instead of <select>, custom clear affordance instead of the
 * native search-field decoration, custom tooltips instead of the native
 * `title` bubble, and themed scrollbars. Behaviour follows the ARIA
 * combobox/listbox pattern so keyboard and screen-reader use still works.
 */
(() => {
  "use strict";

  const THEME_KEY = "proposal-theme";
  const CHECK_ICON =
    '<svg class="select-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.2 8.6 6.5 11.9 12.8 4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CARET_ICON =
    '<svg class="select-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.4 4.4 6 8l3.6-3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CLEAR_ICON =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // ------------------------------------------------------------------
  // Theme
  // ------------------------------------------------------------------

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (_) {}
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  }

  function bindThemeToggle(button) {
    if (!button) return;
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (_) {}
    });
  }

  // ------------------------------------------------------------------
  // Custom select (ARIA combobox + listbox)
  // ------------------------------------------------------------------

  let openSelect = null;

  function createSelect(root, { onChange = () => {}, value = "" } = {}) {
    const trigger = root.querySelector(".select-trigger");
    const valueEl = root.querySelector(".select-value");
    if (!trigger || !valueEl) throw new Error("select markup incomplete");

    const uid = `sel-${Math.random().toString(36).slice(2, 8)}`;
    const menu = document.createElement("div");
    menu.className = "select-menu";
    menu.id = `${uid}-listbox`;
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    document.body.appendChild(menu);

    trigger.insertAdjacentHTML("beforeend", CARET_ICON);
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menu.id);

    let options = [];
    let current = value ?? "";
    let active = -1;
    let isOpen = false;
    let typeBuffer = "";
    let typeTimer = 0;

    function currentOption() {
      return options.find((option) => option.value === current);
    }

    function render() {
      const selected = currentOption();
      valueEl.textContent = selected ? selected.label : options[0]?.label ?? "";
      menu.innerHTML = options
        .map(
          (option, index) => `
          <div class="select-option${option.value === current ? " is-selected" : ""}"
               role="option"
               id="${uid}-opt-${index}"
               data-index="${index}"
               aria-selected="${option.value === current}">
            <span class="select-option-label">${esc(option.label)}</span>
            ${CHECK_ICON}
          </div>`
        )
        .join("");
      root.classList.toggle("is-empty-value", current === "");
    }

    function setActive(index) {
      if (!options.length) return;
      active = ((index % options.length) + options.length) % options.length;
      trigger.setAttribute("aria-activedescendant", `${uid}-opt-${active}`);
      Array.from(menu.children).forEach((el, i) => {
        el.classList.toggle("is-active", i === active);
      });
      const target = menu.children[active];
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest" });
      }
    }

    function position() {
      if (!isOpen) return;
      const rect = trigger.getBoundingClientRect();
      menu.style.minWidth = `${Math.max(168, Math.round(rect.width))}px`;
      menu.style.left = `${Math.round(rect.left)}px`;
      const menuHeight = menu.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow;
      const top = openUp ? rect.top - menuHeight - 6 : rect.bottom + 6;
      menu.style.top = `${Math.round(Math.max(8, top))}px`;
      menu.classList.toggle("opens-up", openUp);
    }

    function openMenu() {
      if (isOpen || !options.length) return;
      if (openSelect && openSelect !== api) openSelect.close();
      openSelect = api;
      isOpen = true;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
      const selectedIndex = options.findIndex((option) => option.value === current);
      setActive(selectedIndex >= 0 ? selectedIndex : 0);
      position();
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
    }

    function closeMenu({ focus = false } = {}) {
      if (!isOpen) return;
      isOpen = false;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      root.classList.remove("is-open");
      if (openSelect === api) openSelect = null;
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      if (focus) trigger.focus();
    }

    function choose(index) {
      const option = options[index];
      if (!option) return;
      const changed = option.value !== current;
      current = option.value;
      render();
      closeMenu({ focus: true });
      if (changed) onChange(current);
    }

    function typeahead(char) {
      clearTimeout(typeTimer);
      typeBuffer += char.toLowerCase();
      typeTimer = setTimeout(() => {
        typeBuffer = "";
      }, 700);
      const index = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(typeBuffer)
      );
      if (index >= 0) setActive(index);
    }

    trigger.addEventListener("click", () => {
      if (isOpen) closeMenu({ focus: true });
      else openMenu();
    });

    trigger.addEventListener("keydown", (event) => {
      const key = event.key;
      if (!isOpen) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
          event.preventDefault();
          openMenu();
          if (key === "ArrowUp") setActive(options.length - 1);
          return;
        }
        if (key.length === 1 && /\S/.test(key)) {
          event.preventDefault();
          openMenu();
          typeahead(key);
        }
        return;
      }
      switch (key) {
        case "ArrowDown":
          event.preventDefault();
          setActive(active + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive(active - 1);
          break;
        case "Home":
          event.preventDefault();
          setActive(0);
          break;
        case "End":
          event.preventDefault();
          setActive(options.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          choose(active);
          break;
        case "Escape":
          event.preventDefault();
          closeMenu({ focus: true });
          break;
        case "Tab":
          closeMenu();
          break;
        default:
          if (key.length === 1 && /\S/.test(key)) typeahead(key);
      }
    });

    menu.addEventListener("click", (event) => {
      const option = event.target.closest(".select-option");
      if (option) choose(Number(option.dataset.index));
    });

    menu.addEventListener("pointermove", (event) => {
      const option = event.target.closest(".select-option");
      if (!option) return;
      const index = Number(option.dataset.index);
      if (index !== active) setActive(index);
    });

    document.addEventListener("pointerdown", (event) => {
      if (!isOpen) return;
      if (root.contains(event.target) || menu.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (isOpen && event.key === "Escape") closeMenu({ focus: true });
    });

    const api = {
      get value() {
        return current;
      },
      setValue(next) {
        current = next ?? "";
        if (options.length && !options.some((option) => option.value === current)) {
          current = "";
        }
        render();
        return current;
      },
      setOptions(list) {
        options = list.slice();
        if (options.length && !options.some((option) => option.value === current)) {
          current = "";
        }
        render();
        return current;
      },
      close: closeMenu,
    };

    render();
    return api;
  }

  // ------------------------------------------------------------------
  // Search box with a custom clear affordance
  // ------------------------------------------------------------------

  function initSearchBox(root, { onClear } = {}) {
    const input = root.querySelector("input");
    if (!input) return null;
    if (!root.querySelector(".search-clear")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-clear";
      button.setAttribute("aria-label", "清空搜索内容");
      button.innerHTML = CLEAR_ICON;
      root.appendChild(button);
    }
    const clear = root.querySelector(".search-clear");

    const sync = () => {
      const hasValue = input.value.length > 0;
      root.classList.toggle("has-value", hasValue);
      clear.hidden = !hasValue;
    };

    input.addEventListener("input", sync);
    clear.addEventListener("click", () => {
      if (!input.value) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      if (onClear) onClear();
    });
    sync();
    return { sync };
  }

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  // GitHub Pages answers with `cache-control: max-age=600`, so a browser can
  // serve a ten-minute-old JSON payload after a deploy. Appending the build id
  // (injected by build_site.py) makes every fetch URL unique per build, which
  // also sidesteps caching in front of Pages (Cloudflare proxy, corporate
  // proxies, service workers) without needing any CDN configuration.
  const buildId = (() => {
    const meta = document.querySelector('meta[name="proposal-build"]');
    return meta ? meta.getAttribute("content") : "";
  })();

  function dataUrl(path) {
    return buildId ? `${path}${path.includes("?") ? "&" : "?"}v=${buildId}` : path;
  }

  // The dataset is replaced wholesale on each sync, so a page left open across
  // a deploy would keep showing stale counts. Polling the tiny build file keeps
  // an open tab honest; the caller decides how loudly to surface it.
  function watchBuild(onChange, intervalMs = 5 * 60 * 1000) {
    if (!buildId || !onChange) return () => {};
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`data/build.json?v=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.build && payload.build !== buildId) onChange(payload);
      } catch (_) {
        /* offline: try again on the next tick */
      }
    };
    const timer = setInterval(check, intervalMs);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  // ------------------------------------------------------------------
  // Intent prefetch
  // ------------------------------------------------------------------

  // Cards and "back to list" links are the only navigation targets. Fetching
  // the destination document plus its JSON on hover/focus hides the network
  // round trip behind the click, so the transition animation covers the parse
  // instead of the visitor staring at a loading placeholder.
  function initIntentPrefetch() {
    const started = new Set();

    const warm = (href) => {
      let url;
      try {
        url = new URL(href, location.href);
      } catch (_) {
        return;
      }
      if (url.origin !== location.origin) return;

      const jobs = [url.href];
      const params = new URLSearchParams(url.search);
      const id = (params.get("id") || "").trim().toLowerCase();
      if (url.pathname.endsWith("/detail.html") && id) {
        jobs.push(dataUrl(`data/detail/${id}.json`));
      }
      if (url.pathname.endsWith("/index.html") || url.pathname.endsWith("/")) {
        jobs.push(dataUrl("data/index.json"));
      }

      for (const job of jobs) {
        if (started.has(job)) continue;
        started.add(job);
        // Versioned URLs make force-cache safe: a hit is always the right build.
        fetch(job, { cache: "force-cache", priority: "low" }).catch(() => {});
      }
    };

    const onIntent = (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) return;
      warm(href);
    };

    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);
    document.addEventListener("touchstart", onIntent, { passive: true });
  }

  // ------------------------------------------------------------------
  // Tooltips
  // ------------------------------------------------------------------

  function initTooltips() {
    let node = null;
    let anchor = null;

    function ensure() {
      if (!node) {
        node = document.createElement("div");
        node.className = "ui-tip";
        node.setAttribute("role", "tooltip");
        document.body.appendChild(node);
      }
      return node;
    }

    function show(target) {
      const text = target.dataset.tip;
      if (!text) return;
      anchor = target;
      const tip = ensure();
      tip.textContent = text;
      tip.classList.add("is-visible");
      const rect = target.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          window.innerWidth - tipRect.width - 8,
          rect.left + rect.width / 2 - tipRect.width / 2
        )
      );
      let top = rect.top - tipRect.height - 8;
      if (top < 8) top = rect.bottom + 8;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    }

    function hide(target) {
      if (anchor && target && anchor !== target) return;
      anchor = null;
      if (node) node.classList.remove("is-visible");
    }

    document.addEventListener("pointerover", (event) => {
      const target = event.target.closest("[data-tip]");
      if (target) show(target);
    });
    document.addEventListener("pointerout", (event) => {
      const target = event.target.closest("[data-tip]");
      if (target) hide(target);
    });
    document.addEventListener("focusin", (event) => {
      const target = event.target.closest("[data-tip]");
      if (target) show(target);
    });
    document.addEventListener("focusout", (event) => {
      const target = event.target.closest("[data-tip]");
      if (target) hide(target);
    });
    window.addEventListener("scroll", () => hide(), true);
    window.addEventListener("resize", () => hide());
  }

  window.UI = {
    esc,
    initTheme,
    bindThemeToggle,
    createSelect,
    initSearchBox,
    initTooltips,
    initIntentPrefetch,
    dataUrl,
    watchBuild,
    buildId,
  };
})();

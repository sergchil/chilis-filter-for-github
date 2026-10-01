(() => {
  const HIDDEN = 'ghx-hidden';

  // After the extension is reloaded or updated, this copy of the script keeps running in open tabs
  // but loses its link to the extension. Detect that and step aside until the page is reloaded.
  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  let retired = false;
  function retire() {
    if (retired) return;
    retired = true;
    try { observer.disconnect(); } catch {}
    closeMenu();
    for (const host of [bar, floatBar]) if (host) host.remove();
    bar = floatBar = null;
  }

  function guard(fn) {
    return (...args) => {
      if (!alive()) { retire(); return; }
      try { return fn(...args); } catch (e) { if (!alive()) retire(); else throw e; }
    };
  }

  let shortcuts = [];
  let groups = [];
  let active = [];
  let bar = null;
  let lastHiddenCount = 0;
  let pagePaths = [];
  let menuGroup = null;

  // ---------- patterns ----------

  const basename = ghxBasename;
  const compileList = ghxCompileList;

  // Include shortcuts combine as "any of", exclude shortcuts always win.
  function buildPredicate() {
    const on = shortcuts.filter((s) => active.includes(s.id));
    const inc = on.filter((s) => s.mode === 'include').flatMap((s) => compileList(s.patterns));
    const exc = on.filter((s) => s.mode === 'exclude').flatMap((s) => compileList(s.patterns));
    if (!inc.length && !exc.length) return null;
    return (path) => {
      if (!path) return false;
      if (exc.some((m) => m(path))) return true;
      return inc.length > 0 && !inc.some((m) => m(path));
    };
  }

  // ---------- path extraction ----------

  const clean = (s) => (s || '').replace(/[‎‏‪-‮]/g, '').trim();
  const PATH_ATTRS = ['data-tagsearch-path', 'data-path', 'data-file-path'];

  function attrPath(el) {
    for (const a of PATH_ATTRS) if (el.hasAttribute(a)) return clean(el.getAttribute(a));
    return '';
  }

  function diffPath(el) {
    const direct = attrPath(el);
    if (direct) return direct;
    const inner = el.querySelector(PATH_ATTRS.map((a) => `[${a}]`).join(','));
    if (inner) return attrPath(inner);
    const link = el.querySelector('h3 a, a[href^="#diff-"], .file-info a');
    if (link) return clean(link.getAttribute('title') || link.textContent);
    const code = el.querySelector('h3 code, code');
    return code ? clean(code.textContent) : '';
  }

  // Top-level per-file diff containers in the classic and the new PR UI.
  function findDiffs() {
    const set = new Set();
    document.querySelectorAll('.js-diff-progressive-container .file, div.file[data-tagsearch-path], copilot-diff-entry').forEach((el) => set.add(el));
    document.querySelectorAll('[id^="diff-"]').forEach((el) => {
      if (el.tagName === 'A') return;
      if (!/^diff-[0-9a-f]{20,}$/.test(el.id)) return;
      for (let p = el.parentElement; p; p = p.parentElement) if (/^diff-[0-9a-f]{20,}$/.test(p.id)) return;
      set.add(el);
    });
    // The classic UI nests div.file inside copilot-diff-entry; keep only the inner one so each file counts once.
    // When changed files carry data-tagsearch-path, a div.file without it is a code preview, not a changed file.
    const tagged = !!document.querySelector('div.file[data-tagsearch-path]');
    return [...set].filter((el) => ![...set].some((o) => o !== el && el.contains(o)) &&
      !(tagged && el.matches('div.file:not([data-tagsearch-path])')));
  }

  function treeItemPath(li, diffPathById) {
    const a = li.querySelector('a[href*="#diff-"]');
    if (a) {
      const id = a.getAttribute('href').split('#')[1];
      if (diffPathById.has(id)) return diffPathById.get(id);
    }
    const attr = attrPath(li);
    if (attr) return attr;
    if (li.id && li.id.includes('.')) return clean(li.id);
    const label = li.querySelector('[class*="ItemLabel"], .ActionList-item-label, span');
    return clean(label ? label.textContent : li.getAttribute('aria-label') || '');
  }

  // ---------- apply ----------

  function apply() {
    const hideFn = buildPredicate();
    let hidden = 0;
    const diffPathById = new Map();

    for (const d of findDiffs()) {
      const p = diffPath(d);
      if (d.id && p) diffPathById.set(d.id, p);
      const hide = !!hideFn && hideFn(p);
      // The new PR UI wraps each diff in a spaced list entry; hide the wrapper so no gap is left.
      const parent = d.parentElement;
      const wrap = parent && (/diffEntry/.test(parent.className) || parent.tagName === 'COPILOT-DIFF-ENTRY') ? parent : d;
      wrap.classList.toggle(HIDDEN, hide);
      if (hide) hidden++;
    }

    const items = [...document.querySelectorAll('li[role="treeitem"]')];
    const folders = items.filter((li) =>
      li.getAttribute('data-tree-entry-type') === 'directory' || li.getAttribute('aria-expanded') !== null || li.querySelector('ul[role="group"]'));
    for (const li of items) {
      if (folders.includes(li)) continue;
      li.classList.toggle(HIDDEN, !!hideFn && hideFn(treeItemPath(li, diffPathById)));
    }
    // Innermost folders first so nested empty folders collapse upward.
    folders.reverse().forEach((f) => {
      const files = [...f.querySelectorAll('li[role="treeitem"]')].filter((x) => !folders.includes(x));
      f.classList.toggle(HIDDEN, !!hideFn && files.length > 0 && files.every((x) => x.classList.contains(HIDDEN)));
    });

    lastHiddenCount = hidden;
    pagePaths = collectPaths(diffPathById, items, folders);
    renderBar();
  }

  // Every changed file on the page, from the loaded diffs and the file tree (which lists files not rendered yet).
  function collectPaths(diffPathById, items, folders) {
    const set = new Set(diffPathById.values());
    for (const li of items) {
      if (folders.includes(li)) continue;
      const p = treeItemPath(li, diffPathById);
      if (p && (p.includes('/') || ![...set].some((x) => x.endsWith('/' + p)))) set.add(p);
    }
    return [...set];
  }

  // ---------- toolbar ----------

  function isDiffPage() {
    return /\/pull\/\d+\/(files|changes)|\/compare\/|\/commit\//.test(location.pathname);
  }

  function findFilterInput() {
    return document.querySelector('input[placeholder^="Filter files"], input[aria-label^="Filter files"], #file-tree-filter-field');
  }

  // Put the bar right after GitHub's own filter button, which follows the "Filter files…" input.
  function mountBar() {
    if (retired) return;
    if (bar && bar.isConnected) return;
    const input = findFilterInput();
    if (!input) { if (isDiffPage()) renderBar(); return; }

    bar = document.createElement('div');
    bar.className = 'ghx-bar';

    let placed = false;
    if (input) {
      let anc = input.parentElement;
      for (let depth = 0; anc && depth < 6 && !placed; depth++, anc = anc.parentElement) {
        const btn = [...anc.querySelectorAll('button')].find(
          (b) => !b.closest('.ghx-bar') && !b.contains(input) && (input.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        if (!btn) continue;
        let child = btn;
        while (child.parentElement !== anc) child = child.parentElement;
        child.after(bar);
        placed = true;
      }
      if (!placed) { input.after(bar); placed = true; }
    }
    if (!placed) { bar = null; }
    renderBar();
  }

  const FUNNEL = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.5 2h11a.75.75 0 0 1 .58 1.22L9.5 8.87v4.38a.75.75 0 0 1-1.13.65l-2-1.2a.75.75 0 0 1-.37-.64V8.87L1.92 3.22A.75.75 0 0 1 2.5 2Z"/></svg>';

  let menu = null;

  // One compact trigger button; the shortcuts live in a dropdown attached to <body> so the sidebar cannot clip it.
  let floatBar = null;

  const isShown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

  // When the file tree sidebar is collapsed the inline button disappears with it, so show a floating one instead.
  function syncFloating() {
    const need = isDiffPage() && !isShown(bar);
    if (need && !floatBar) {
      floatBar = document.createElement('div');
      floatBar.className = 'ghx-bar ghx-floating';
      document.body.appendChild(floatBar);
    } else if (!need && floatBar) {
      floatBar.remove();
      floatBar = null;
    }
  }

  function renderBar() {
    if (retired) return;
    syncFloating();
    for (const host of [bar, floatBar]) {
      if (!host) continue;
      host.textContent = '';
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'ghx-btn ghx-trigger' + (active.length ? ' ghx-on' : '');
      t.title = active.length ? `${lastHiddenCount} file(s) hidden` : 'File filter shortcuts';
      t.innerHTML = FUNNEL + (active.length ? `<span class="ghx-count">${lastHiddenCount}</span>` : '');
      t.addEventListener('click', guard((e) => { e.stopPropagation(); menu ? closeMenu() : openMenu(); }));
      host.appendChild(t);
    }
    if (menu) renderMenu();
  }

  function openMenu() {
    apply();
    menuGroup = null;
    menu = document.createElement('div');
    menu.className = 'ghx-menu';
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(menu);
    renderMenu();
  }

  function closeMenu() {
    if (menu) menu.remove();
    menu = null;
  }

  // Built-in languages are recognised by source extension; custom ones by how many files their shortcuts touch.
  const LANG_EXT = { go: /\.go$/, csharp: /\.(cs|csproj)$/, flutter: /\.dart$/ };

  function detectGroup() {
    let best = null, bestScore = 0;
    for (const g of groups) {
      const members = shortcuts.filter((s) => s.group === g.id);
      if (!members.length) continue;
      const score = LANG_EXT[g.id]
        ? pagePaths.filter((p) => LANG_EXT[g.id].test(p)).length * 2
        : pagePaths.filter(hiddenByOne(members)).length;
      if (score > bestScore) { best = g.id; bestScore = score; }
    }
    return best;
  }

  function hiddenByOne(list) {
    const inc = list.filter((s) => s.mode === 'include').flatMap((s) => compileList(s.patterns));
    const exc = list.filter((s) => s.mode === 'exclude').flatMap((s) => compileList(s.patterns));
    return (p) => exc.some((m) => m(p)) || (inc.length > 0 && !inc.some((m) => m(p)));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderMenu() {
    const withShortcuts = groups.filter((g) => shortcuts.some((s) => s.group === g.id));
    if (!withShortcuts.some((g) => g.id === menuGroup)) {
      menuGroup = detectGroup() || (withShortcuts[0] && withShortcuts[0].id);
    }
    const total = pagePaths.length;
    const scroll = menu.querySelector('.ghx-list') ? menu.querySelector('.ghx-list').scrollTop : 0;
    menu.textContent = '';

    // Header: what the filters are doing to this pull request right now.
    const head = el('div', 'ghx-head');
    const title = el('div', 'ghx-title');
    if (active.length && total) title.innerHTML = `<b>${lastHiddenCount}</b> of ${total} files hidden`;
    else if (total) title.innerHTML = `<b>${total}</b> files in this pull request`;
    else title.textContent = 'File filters';
    head.appendChild(title);
    const meter = el('div', 'ghx-meter');
    const fill = el('span');
    fill.style.width = total && active.length ? `${(lastHiddenCount / total) * 100}%` : "0%";
    meter.appendChild(fill);
    head.appendChild(meter);
    menu.appendChild(head);

    // Language tabs, with a dot on any language that has a shortcut switched on.
    if (withShortcuts.length > 1) {
      const tabs = el('div', 'ghx-tabs');
      tabs.setAttribute('role', 'tablist');
      for (const g of withShortcuts) {
        const t = el('button', 'ghx-tab', g.name);
        t.type = 'button';
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(g.id === menuGroup));
        if (shortcuts.some((s) => s.group === g.id && active.includes(s.id))) t.appendChild(el('span', 'ghx-tab-dot'));
        t.addEventListener('click', () => { menuGroup = g.id; renderMenu(); });
        tabs.appendChild(t);
      }
      menu.appendChild(tabs);
    }

    const list = el('div', 'ghx-list');
    for (const s of shortcuts.filter((x) => x.group === menuGroup)) {
      const on = active.includes(s.id);
      const n = total ? pagePaths.filter(hiddenByOne([s])).length : 0;
      const row = el('button', 'ghx-row' + (on ? ' is-on' : ''));
      row.type = 'button';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(on));
      row.title = `${s.mode === 'include' ? 'Show only' : 'Hide'}: ${ghxPatternSummary(s.patterns)}`;
      row.appendChild(el('span', 'ghx-switch'));
      const text = el('span', 'ghx-row-text');
      text.appendChild(el('span', 'ghx-row-label', s.label || ghxPatternSummary(s.patterns)));
      text.appendChild(el('span', 'ghx-row-sub', s.mode === 'include' ? 'Show only matching files' : 'Hide matching files'));
      row.appendChild(text);
      const count = el('span', 'ghx-row-count' + (n ? '' : ' is-zero'));
      count.textContent = !total ? '' : s.mode === 'include' ? `keeps ${total - n}` : n ? `hides ${n}` : 'none here';
      row.appendChild(count);
      row.addEventListener('click', () => toggle(s.id));
      list.appendChild(row);
    }
    menu.appendChild(list);

    const foot = el('div', 'ghx-foot');
    const reset = el('button', 'ghx-foot-btn', active.length ? `Reset ${active.length === 1 ? 'filter' : `${active.length} filters`}` : 'No filters on');
    reset.type = 'button';
    reset.disabled = !active.length;
    reset.addEventListener('click', () => setActive([]));
    const edit = el('button', 'ghx-foot-btn ghx-foot-settings');
    edit.type = 'button';
    edit.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg><span>Settings</span>';
    edit.addEventListener('click', guard(() => { closeMenu(); chrome.runtime.sendMessage({ type: 'ghx-open-options' }); }));
    foot.append(reset, edit);
    menu.appendChild(foot);

    menu.querySelector('.ghx-list').scrollTop = scroll;
    positionMenu();
  }

  function positionMenu() {
    const anchor = isShown(bar) ? bar : floatBar;
    if (!menu || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = 320;
    menu.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
    const h = menu.offsetHeight;
    menu.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + 'px';
  }

  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', positionMenu, true);

  function toggle(id) {
    setActive(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);
  }

  function setActive(ids) {
    if (!alive()) { retire(); return; }
    active = ids;
    chrome.storage.local.set({ [GHX_ACTIVE_KEY]: active }).catch(() => retire());
    apply();
  }

  // ---------- boot ----------

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[GHX_SHORTCUTS_KEY] || changes[GHX_GROUPS_KEY]) {
      ghxLoadConfig().then((cfg) => { shortcuts = cfg.shortcuts; groups = cfg.groups; apply(); });
    }
    if (changes[GHX_ACTIVE_KEY]) active = changes[GHX_ACTIVE_KEY].newValue || [];
    if (changes[GHX_ACTIVE_KEY]) apply();
  });

  let scheduled = false;
  const observer = new MutationObserver((mutations) => {
    if (mutations.every((m) => m.target.closest && (m.target.closest('.ghx-bar') || m.target.closest('.ghx-menu')))) return;
    schedule();
  });

  // Collapsing the sidebar may only flip a class, so also re-check after clicks.
  document.addEventListener('click', () => setTimeout(schedule, 300), true);

  function schedule() {
    if (retired) return;
    if (!alive()) { retire(); return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (retired || !alive()) { retire(); return; }
      mountBar();
      if (active.length || document.querySelector('.' + HIDDEN)) apply();
      else if (!!floatBar !== (isDiffPage() && !isShown(bar))) renderBar();
    }, 200);
  }

  Promise.all([ghxLoadConfig(), chrome.storage.local.get(GHX_ACTIVE_KEY)]).then(([cfg, a]) => {
    shortcuts = cfg.shortcuts;
    groups = cfg.groups;
    active = a[GHX_ACTIVE_KEY] || [];
    mountBar();
    apply();
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();

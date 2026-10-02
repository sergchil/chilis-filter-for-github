// Live demo: the extension's own default shortcuts and pattern matcher (shared.js) applied to sample pull requests.
(() => {
  const SAMPLES = {
    go: {
      source: { label: 'temporalio/temporal #12206', href: 'https://github.com/temporalio/temporal/pull/12206' },
      files: [
        'api/historyservice/v1/request_response.pb.go',
        'api/historyservice/v1/service_grpc.pb.go',
        'chasm/lib/activity/activity_tasks.go',
        'chasm/lib/activity/activity_tasks_test.go',
        'client/history/client_gen.go',
        'client/history/client_test.go',
        'cmd/tools/genrpcwrappers/main.go',
        'proto/internal/temporal/server/api/historyservice/v1/request_response.proto',
        'proto/internal/temporal/server/api/historyservice/v1/service.proto',
        'service/history/handler.go',
        'service/history/handler_test.go',
        'service/matching/task_validation.go',
        'service/matching/task_validation_test.go',
        'tests/mixedbrain/go.mod',
        'tests/mixedbrain/go.sum',
        'tests/mixedbrain/mixed_brain_test.go',
        'tests/worker_deployment_version_test.go',
      ],
    },
    csharp: {
      source: { label: 'an example ASP.NET pull request' },
      files: [
        'src/Orders.Api/Controllers/OrdersController.cs',
        'src/Orders.Api/packages.lock.json',
        'src/Orders.Domain/Order.cs',
        'src/Orders.Domain/OrderStatus.cs',
        'src/Orders.Infrastructure/Migrations/20261001_AddOrderStatus.cs',
        'src/Orders.Infrastructure/Migrations/20261001_AddOrderStatus.Designer.cs',
        'src/Orders.Infrastructure/Migrations/OrdersDbContextModelSnapshot.cs',
        'src/Orders.Infrastructure/OrdersDbContext.cs',
        'tests/Orders.Tests/OrderStatusTests.cs',
        'tests/Orders.Tests/OrdersControllerTests.cs',
      ],
    },
    flutter: {
      source: { label: 'an example Flutter pull request' },
      files: [
        'lib/features/cart/cart_page.dart',
        'lib/features/cart/cart_state.dart',
        'lib/features/cart/cart_state.freezed.dart',
        'lib/features/cart/cart_state.g.dart',
        'lib/features/cart/widgets/cart_item_tile.dart',
        'assets/images/empty_cart.png',
        'pubspec.lock',
        'pubspec.yaml',
        'test/features/cart/cart_page_test.dart',
        'test/features/cart/goldens/cart_page_empty.png',
        'test/features/cart/goldens/cart_page_full.png',
      ],
    },
  };

  const shortcuts = GHX_DEFAULT_SHORTCUTS;
  const groups = GHX_DEFAULT_GROUPS;
  const active = new Set(GHX_DEFAULT_SHORTCUTS.map((s) => s.id));
  let group = 'go';
  let custom = '';

  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs');
  const rowsEl = $('rows');
  const filesEl = $('files');
  const customEl = $('custom');

  // Same rule as the extension: "Show only" shortcuts combine as "any of", "Hide" always wins.
  function predicate() {
    const on = shortcuts.filter((s) => s.group === group && active.has(s.id));
    const exc = on.filter((s) => s.mode === 'exclude').flatMap((s) => ghxCompileList(s.patterns)).concat(ghxCompileList(custom));
    const inc = on.filter((s) => s.mode === 'include').flatMap((s) => ghxCompileList(s.patterns));
    return (path) => exc.some((m) => m(path)) || (inc.length > 0 && !inc.some((m) => m(path)));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderTabs() {
    tabsEl.textContent = '';
    for (const g of groups) {
      const t = el('button', 'tab', g.name);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(g.id === group));
      t.addEventListener('click', () => { group = g.id; renderFiles(true); render(); });
      tabsEl.appendChild(t);
    }
  }

  function renderFiles(fresh) {
    if (!fresh && filesEl.childElementCount) return;
    filesEl.textContent = '';
    for (const path of SAMPLES[group].files) {
      const li = el('li', 'file');
      li.dataset.path = path;
      const slash = path.lastIndexOf('/');
      li.appendChild(el('span', 'file-dir', slash >= 0 ? path.slice(0, slash + 1) : ''));
      li.appendChild(el('span', 'file-name', path.slice(slash + 1)));
      filesEl.appendChild(li);
    }
    const src = SAMPLES[group].source;
    const link = $('demo-source');
    link.textContent = src.label;
    if (src.href) link.href = src.href; else link.removeAttribute('href');
  }

  function render() {
    renderTabs();
    const files = SAMPLES[group].files;
    const hide = predicate();
    let hidden = 0;
    for (const li of filesEl.children) {
      const h = hide(li.dataset.path);
      li.classList.toggle('is-hidden', h);
      li.setAttribute('aria-hidden', String(h));
      if (h) hidden++;
    }
    $('count-hidden').textContent = hidden;
    $('count-total').textContent = files.length;
    $('meter').style.width = `${(hidden / files.length) * 100}%`;

    // Rows are built once per language and then updated in place, so the switches can animate.
    const list = shortcuts.filter((x) => x.group === group);
    if (rowsEl.dataset.group !== group) {
      rowsEl.dataset.group = group;
      rowsEl.textContent = '';
      for (const s of list) {
        const row = el('button', 'row');
        row.type = 'button';
        row.setAttribute('role', 'switch');
        row.title = ghxPatternSummary(s.patterns);
        row.appendChild(el('span', 'switch'));
        const text = el('span', 'row-text');
        text.appendChild(el('span', 'row-label', s.label));
        text.appendChild(el('span', 'row-sub', s.mode === 'include' ? 'Show only matching files' : 'Hide matching files'));
        row.appendChild(text);
        row.appendChild(el('span', 'row-count'));
        row.addEventListener('click', () => { active.has(s.id) ? active.delete(s.id) : active.add(s.id); render(); });
        rowsEl.appendChild(row);
      }
    }
    list.forEach((s, i) => {
      const row = rowsEl.children[i];
      const on = active.has(s.id);
      const matcher = ghxCompileList(s.patterns);
      const n = files.filter((p) => matcher.some((m) => m(p))).length;
      row.classList.toggle('is-on', on);
      row.setAttribute('aria-checked', String(on));
      const count = row.lastChild;
      count.className = 'row-count' + (n ? '' : ' is-zero');
      count.textContent = n ? `hides ${n}` : 'none here';
    });
  }

  customEl.addEventListener('input', () => { custom = customEl.value; render(); });

  renderFiles(true);
  render();
})();

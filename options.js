const $ = (sel, root = document) => root.querySelector(sel);
const groupsEl = $('#groups');
const cardTpl = $('#card-tpl');
const groupTpl = $('#group-tpl');
const savebar = $('#savebar');

let saved = { shortcuts: [], groups: [] };
let draft = { shortcuts: [], groups: [] };
let active = [];
let current = null;
const open = new Set();

const cloneState = (st) => ({ shortcuts: st.shortcuts.map((s) => ({ ...s })), groups: st.groups.map((g) => ({ ...g })) });
const isDirty = () => JSON.stringify(draft) !== JSON.stringify(saved);

// Older versions stored "a, b, c"; the editor wants one pattern per line.
function toLines(patterns) {
  const p = patterns || '';
  return p.includes('\n') ? p : p.split(',').map((x) => x.trim()).filter(Boolean).join('\n');
}

// ---------- syntax highlighting ----------

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function tokenClass(t) {
  if (t.startsWith('#')) return 't-com';
  if (/[*?]/.test(t)) return 't-glob';
  if (t.includes('/')) return 't-dir';
  if (/^[._]/.test(t)) return 't-ext';
  if (/_$/.test(t)) return 't-pre';
  return 't-name';
}

function highlightLine(line) {
  if (!line.trim()) return esc(line);
  const cls = tokenClass(line.trim());
  let body = esc(line);
  if (cls === 't-glob') body = body.replace(/\*\*|\*|\?/g, (m) => `<span class="t-star">${m}</span>`);
  return `<span class="${cls}">${body}</span>`;
}

function renderHighlight(card, s) {
  card.querySelector('.hl').innerHTML = s.patterns.split('\n')
    .map((line, i) => `<span class="ln" data-n="${i + 1}">${highlightLine(line) || ' '}</span>`)
    .join('');
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

// ---------- shortcut cards ----------

function updateCardMeta(card, s) {
  card.dataset.mode = s.mode;
  card.querySelectorAll('.mode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === s.mode)));
  const n = ghxCompileList(s.patterns).length;
  card.querySelector('.count').innerHTML = `<b>${n}</b> pattern${n === 1 ? '' : 's'}`;
  card.querySelector('.switch').setAttribute('aria-checked', String(active.includes(s.id)));
}

function setOpen(card, id, isOpen) {
  card.classList.toggle('open', isOpen);
  card.querySelector('.expand').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) open.add(id); else open.delete(id);
  if (isOpen) requestAnimationFrame(() => autosize(card.querySelector('.code')));
}

function buildCard(s) {
  const card = cardTpl.content.firstElementChild.cloneNode(true);
  card.dataset.id = s.id;
  const label = card.querySelector('.label');
  const code = card.querySelector('.code');
  const hl = card.querySelector('.hl');

  label.value = s.label;
  code.value = s.patterns;
  renderHighlight(card, s);
  updateCardMeta(card, s);
  setOpen(card, s.id, open.has(s.id));

  label.addEventListener('input', () => { s.label = label.value; changed(); });
  code.addEventListener('input', () => {
    s.patterns = code.value;
    renderHighlight(card, s);
    autosize(code);
    updateCardMeta(card, s);
    changed();
  });
  code.addEventListener('scroll', () => { hl.scrollLeft = code.scrollLeft; });
  card.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => {
    s.mode = b.dataset.mode;
    updateCardMeta(card, s);
    changed();
  }));
  card.querySelector('.expand').addEventListener('click', () => setOpen(card, s.id, !card.classList.contains('open')));
  card.querySelector('.switch').addEventListener('click', () => {
    active = active.includes(s.id) ? active.filter((x) => x !== s.id) : [...active, s.id];
    chrome.storage.local.set({ [GHX_ACTIVE_KEY]: active });
    updateCardMeta(card, s);
    renderTabs();
  });
  card.querySelector('.remove').addEventListener('click', () => {
    draft.shortcuts = draft.shortcuts.filter((x) => x !== s);
    active = active.filter((x) => x !== s.id);
    renderAll();
    changed();
  });
  return card;
}

// ---------- language sections ----------

function renderTabs() {
  const tabs = $('#lang-tabs');
  tabs.textContent = '';
  for (const g of draft.groups) {
    const n = draft.shortcuts.filter((s) => s.group === g.id).length;
    const on = draft.shortcuts.filter((s) => s.group === g.id && active.includes(s.id)).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g.id === current));
    b.innerHTML = `<span class="tab-name"></span><span class="tab-count${on ? ' live' : ''}">${n}</span>`;
    b.querySelector('.tab-name').textContent = g.name || 'Untitled';
    b.title = on ? `${on} of ${n} shortcuts on` : `${n} shortcuts`;
    b.addEventListener('click', () => { current = g.id; renderAll(); });
    tabs.appendChild(b);
  }
}

function renderAll() {
  if (!draft.groups.some((g) => g.id === current)) current = draft.groups[0] ? draft.groups[0].id : null;
  renderTabs();
  groupsEl.textContent = '';
  const g = draft.groups.find((x) => x.id === current);
  if (!g) {
    groupsEl.innerHTML = '<p class="empty">No languages yet. Add one to start hiding files.</p>';
    return;
  }
  const sec = groupTpl.content.firstElementChild.cloneNode(true);
  sec.dataset.group = g.id;
  const name = sec.querySelector('.group-name');
  name.value = g.name;
  name.addEventListener('input', () => { g.name = name.value; renderTabs(); changed(); });

  const members = draft.shortcuts.filter((s) => s.group === g.id);
  sec.querySelector('.group-count').textContent = `${members.length} shortcut${members.length === 1 ? '' : 's'}`;
  const list = sec.querySelector('.group-list');
  for (const s of members) list.appendChild(buildCard(s));
  if (!members.length) list.innerHTML = '<p class="empty">No shortcuts for this language yet. Add one, or copy the AI prompt and ask your assistant to suggest some.</p>';

  sec.querySelector('.add-shortcut').addEventListener('click', () => addShortcut(g.id));
  sec.querySelector('.copy-prompt').addEventListener('click', () => copyPrompt(g));
  sec.querySelector('.remove-group').addEventListener('click', () => {
    const ids = draft.shortcuts.filter((s) => s.group === g.id).map((s) => s.id);
    draft.shortcuts = draft.shortcuts.filter((s) => s.group !== g.id);
    draft.groups = draft.groups.filter((x) => x !== g);
    active = active.filter((id) => !ids.includes(id));
    renderAll();
    changed();
    toast(`Removed ${g.name || 'the language'}. Discard to bring it back.`);
  });
  groupsEl.appendChild(sec);
}

function addShortcut(groupId) {
  const s = { id: ghxNewId(), group: groupId, label: '', mode: 'exclude', patterns: '' };
  draft.shortcuts.push(s);
  open.add(s.id);
  renderAll();
  changed();
  const card = groupsEl.querySelector(`.card[data-id="${s.id}"]`);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.label').focus({ preventScroll: true });
}

$('#add-group').addEventListener('click', () => {
  const g = { id: ghxNewId(), name: '' };
  draft.groups.push(g);
  current = g.id;
  renderAll();
  changed();
  groupsEl.querySelector('.group-name').focus();
});

// ---------- AI prompt ----------

function buildPrompt(g) {
  const lang = g.name.trim() || 'my';
  const current = draft.shortcuts.filter((s) => s.group === g.id)
    .map((s) => `## ${s.label || 'Untitled'} (${s.mode === 'include' ? 'show only' : 'hide'})\n${s.patterns.trim() || '(empty)'}`)
    .join('\n\n');
  return `I use a Chrome extension that hides files from GitHub pull request diffs, so reviewers only read code that a person wrote. Please suggest filter patterns for my ${lang} repository.

Look at the repository first: run \`git ls-files\`, and if you can, read the file lists of the last 20 merged pull requests (for example \`gh pr list --state merged --limit 20 --json files\`). Find the files that no reviewer needs to read line by line:
- generated code (check for headers such as "Code generated", "GENERATED CODE - DO NOT MODIFY" or "<auto-generated>")
- lock and checksum files
- snapshot, golden and screenshot test output
- test fixtures and recorded data
- binary assets such as images and fonts

Do not hide hand-written source code, tests, translations or other text users see, configuration, feature flags, database migrations, CI workflows, or API contracts such as .proto files.

Pattern syntax, one pattern per line:
- \`.ext\` or \`_suffix.ext\` matches the end of the file name
- \`prefix_\` matches the start of the file name
- \`folder/\` matches a folder anywhere in the path
- \`*\` and \`**\` are globs: \`*\` stays inside one folder, \`**\` crosses folders
- \`# note\` is a comment

Reply with one code block I can paste straight into the extension, grouped under # comments. After the code block, list each pattern with how many files it matched and why it is safe to hide.

My current ${lang} shortcuts:

${current || '(none yet)'}`;
}

async function copyPrompt(g) {
  try {
    await navigator.clipboard.writeText(buildPrompt(g));
    toast('Prompt copied. Paste it into your AI assistant.');
  } catch {
    toast('Could not copy. Allow clipboard access for this page and try again.');
  }
}

function refreshCards() {
  groupsEl.querySelectorAll('.card').forEach((card) => {
    const s = draft.shortcuts.find((x) => x.id === card.dataset.id);
    if (s) updateCardMeta(card, s);
  });
  renderTabs();
}

// ---------- save ----------

function changed() {
  savebar.hidden = !isDirty();
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function save() {
  if (!isDirty()) return;
  draft.shortcuts = draft.shortcuts
    .map((s) => ({ ...s, label: s.label.trim(), patterns: s.patterns.replace(/\s+$/, '') }))
    .filter((s) => ghxCompileList(s.patterns).length);
  draft.shortcuts.forEach((s) => { if (!s.label) s.label = ghxPatternSummary(s.patterns).slice(0, 24); });
  draft.groups.forEach((g) => { g.name = g.name.trim() || 'Untitled'; });
  await chrome.storage.sync.set({
    [GHX_SHORTCUTS_KEY]: draft.shortcuts,
    [GHX_GROUPS_KEY]: draft.groups,
    [GHX_SEED_KEY]: GHX_SEED_VERSION,
  });
  saved = cloneState(draft);
  renderAll();
  changed();
  toast('Saved. Open pull requests update right away.');
}

$('#save').addEventListener('click', save);
$('#discard').addEventListener('click', () => {
  draft = cloneState(saved);
  renderAll();
  changed();
});
$('#reset').addEventListener('click', () => {
  draft = { shortcuts: GHX_DEFAULT_SHORTCUTS.map((s) => ({ ...s })), groups: GHX_DEFAULT_GROUPS.map((g) => ({ ...g })) };
  renderAll();
  changed();
  toast('Defaults restored. Save to keep them.');
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
});
addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[GHX_ACTIVE_KEY]) {
    active = changes[GHX_ACTIVE_KEY].newValue || [];
    refreshCards();
  }
});

Promise.all([ghxLoadConfig(), chrome.storage.local.get(GHX_ACTIVE_KEY)]).then(([cfg, a]) => {
  saved = {
    shortcuts: cfg.shortcuts.map((s) => ({ ...s, patterns: toLines(s.patterns) })),
    groups: cfg.groups,
  };
  draft = cloneState(saved);
  active = a[GHX_ACTIVE_KEY] || [];
  if (draft.shortcuts[0]) open.add(draft.shortcuts[0].id);
  renderAll();
});

// ---------- theme picker ----------

function syncPicker() {
  const t = ghxTheme.get();
  document.querySelectorAll('#style-picker button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === t.style)));
  document.querySelectorAll('#mode-picker button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === t.mode)));
}
document.querySelectorAll('#style-picker button').forEach((b) => b.addEventListener('click', () => ghxTheme.set({ style: b.dataset.style })));
document.querySelectorAll('#mode-picker button').forEach((b) => b.addEventListener('click', () => ghxTheme.set({ mode: b.dataset.mode })));
addEventListener('ghx-theme', syncPicker);
syncPicker();

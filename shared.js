// Shared by the content script and the options page.
const GHX_SHORTCUTS_KEY = 'ghxShortcuts';
const GHX_ACTIVE_KEY = 'ghxActive';
const GHX_SEED_KEY = 'ghxSeedVersion';
const GHX_SEED_VERSION = 5;
const GHX_GROUPS_KEY = 'ghxGroups';

// Files no human needs to read in a Go PR: generated code, lock/sum files, golden snapshots and screenshot fixtures.
const GHX_NOISE = [
  '# generated code',
  '_gen.go',
  '.pb.go',
  '_mock.go',
  'mock_',
  '/mock/',
  '/mocks/',
  '# lock and checksum files',
  'go.sum',
  '.lock',
  '# golden output and fixtures',
  '__snapshots__/',
  '__screenshots__/',
  'testdata/',
  '.golden',
  '.golden.json',
  '# images',
  '.jpg',
  '.png',
].join('\n');

const GHX_CSHARP_NOISE = [
  '# generated code',
  '.Designer.cs',
  '.g.cs',
  '.g.i.cs',
  '.AssemblyInfo.cs',
  'ModelSnapshot.cs',
  '/Generated/',
  '# lock files',
  'packages.lock.json',
  '# snapshot tests',
  '.verified.txt',
  '.verified.json',
  '.received.txt',
  '/snapshots/',
  '__snapshots__/',
  '# test data',
  'TestData/',
].join('\n');

const GHX_FLUTTER_NOISE = [
  '# generated code',
  '.g.dart',
  '.freezed.dart',
  '.mocks.dart',
  '.config.dart',
  '.module.dart',
  '.gr.dart',
  '/generated/',
  '# lock files',
  'pubspec.lock',
  'Podfile.lock',
  'Package.resolved',
  '# golden images',
  'goldens/',
  'failures/',
  '# images and fonts',
  '.png',
  '.jpg',
  '.webp',
  '.svg',
  '.ttf',
  '.otf',
].join('\n');

const GHX_DEFAULT_GROUPS = [
  { id: 'go', name: 'Go' },
  { id: 'csharp', name: 'C#' },
  { id: 'flutter', name: 'Flutter' },
];

const GHX_DEFAULT_SHORTCUTS = [
  { id: 'no-noise', group: 'go', label: 'No noise', mode: 'exclude', patterns: GHX_NOISE },
  { id: 'no-tests', group: 'go', label: 'No tests', mode: 'exclude', patterns: '_test.go' },
  { id: 'cs-noise', group: 'csharp', label: 'No noise', mode: 'exclude', patterns: GHX_CSHARP_NOISE },
  { id: 'cs-tests', group: 'csharp', label: 'No tests', mode: 'exclude', patterns: 'Tests/\nTest.cs\nTests.cs' },
  { id: 'dart-noise', group: 'flutter', label: 'No noise', mode: 'exclude', patterns: GHX_FLUTTER_NOISE },
  { id: 'dart-tests', group: 'flutter', label: 'No tests', mode: 'exclude', patterns: '_test.dart\n/test/\nintegration_test/\ntest_driver/' },
];

// ---------- pattern matching (used by the PR page and the settings preview) ----------

function ghxGlobToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return re;
}

const ghxBasename = (p) => p.split('/').pop();

// ".go" / "_test.go" match the end of the name, "vendor/" matches anywhere in the path, "*" and "**" are globs.
function ghxCompilePattern(p) {
  if (/[*?]/.test(p)) {
    if (p.includes('/')) {
      const re = new RegExp('(^|/)' + ghxGlobToRegex(p.replace(/^\//, '')) + '$');
      return (path) => re.test(path);
    }
    const re = new RegExp('^' + ghxGlobToRegex(p) + '$');
    return (path) => re.test(ghxBasename(path));
  }
  if (p.includes('/')) return (path) => path.includes(p);
  return (path) => ghxBasename(path).endsWith(p) || ghxBasename(path).startsWith(p);
}

function ghxCompileList(text) {
  return (text || '').split(/[\n,]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map(ghxCompilePattern);
}

function ghxNewId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Patterns without comments, for compact one-line display.
function ghxPatternSummary(text) {
  return (text || '').split(/[\n,]/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#')).join(', ');
}

// Loads saved shortcuts and groups; adds defaults introduced after the user first saved, once per seed version.
async function ghxLoadShortcuts() {
  return (await ghxLoadConfig()).shortcuts;
}

async function ghxLoadConfig() {
  const res = await chrome.storage.sync.get([GHX_SHORTCUTS_KEY, GHX_GROUPS_KEY, GHX_SEED_KEY]);
  const fresh = () => GHX_DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
  let shortcuts = res[GHX_SHORTCUTS_KEY] || fresh();
  let groups = res[GHX_GROUPS_KEY] || GHX_DEFAULT_GROUPS.map((g) => ({ ...g }));
  const seed = res[GHX_SEED_KEY] || 1;

  if (res[GHX_SHORTCUTS_KEY] && seed < GHX_SEED_VERSION) {
    for (const d of GHX_DEFAULT_SHORTCUTS) if (!shortcuts.some((s) => s.id === d.id)) shortcuts.push({ ...d });
    for (const g of GHX_DEFAULT_GROUPS) if (!groups.some((x) => x.id === g.id)) groups.push({ ...g });
    await chrome.storage.sync.set({ [GHX_SHORTCUTS_KEY]: shortcuts, [GHX_GROUPS_KEY]: groups, [GHX_SEED_KEY]: GHX_SEED_VERSION });
  }
  // Shortcuts saved before groups existed were Go shortcuts.
  shortcuts.forEach((s) => { if (!s.group || !groups.some((g) => g.id === s.group)) s.group = groups[0] ? groups[0].id : 'go'; });
  return { shortcuts, groups };
}

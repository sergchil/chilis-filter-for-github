// Applies the saved theme before first paint, then keeps it in sync with the picker and the OS setting.
(() => {
  const KEY = 'ghxTheme';
  const STYLES = ['liquid', 'github', 'shadcn'];
  const MODES = ['system', 'light', 'dark'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;

  // localStorage is read synchronously so the page never flashes the wrong theme.
  let pref = { style: 'liquid', mode: 'system' };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}

  function apply() {
    const style = STYLES.includes(pref.style) ? pref.style : 'liquid';
    const mode = MODES.includes(pref.mode) ? pref.mode : 'system';
    root.dataset.style = style;
    root.dataset.mode = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    root.dataset.pref = mode;
    dispatchEvent(new CustomEvent('ghx-theme', { detail: { style, mode: root.dataset.mode } }));
  }

  function set(next) {
    pref = { ...pref, ...next };
    localStorage.setItem(KEY, JSON.stringify(pref));
    if (window.chrome && chrome.storage) chrome.storage.sync.set({ [KEY]: pref });
    apply();
  }

  media.addEventListener('change', () => { if (pref.mode === 'system') apply(); });
  apply();

  // Settings saved on another device arrive through sync storage.
  if (window.chrome && chrome.storage) {
    chrome.storage.sync.get(KEY).then((res) => {
      const synced = res[KEY];
      if (synced && JSON.stringify(synced) !== JSON.stringify(pref)) {
        pref = { ...pref, ...synced };
        localStorage.setItem(KEY, JSON.stringify(pref));
        apply();
      }
    });
  }

  window.ghxTheme = { get: () => ({ ...pref }), set };
})();

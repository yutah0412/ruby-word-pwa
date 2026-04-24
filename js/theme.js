/**
 * Theme & Appearance Controller
 * Manages theme selection (wafu/minimal/pop) and light/dark mode.
 * Persisted via localStorage.
 */

window.ThemeManager = (function() {
  const VALID_THEMES = ['wafu', 'minimal', 'pop'];
  const VALID_MODES = ['light', 'dark'];

  const KEY_THEME = 'rubyword.theme';
  const KEY_MODE = 'rubyword.mode';

  function getSavedTheme() {
    const v = localStorage.getItem(KEY_THEME);
    return VALID_THEMES.includes(v) ? v : 'wafu';
  }

  function getSavedMode() {
    const v = localStorage.getItem(KEY_MODE);
    if (VALID_MODES.includes(v)) return v;
    // Honor OS preference for first run
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function applyTheme(theme) {
    if (!VALID_THEMES.includes(theme)) theme = 'wafu';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY_THEME, theme);
    updateActiveButtons();
  }

  function applyMode(mode) {
    if (!VALID_MODES.includes(mode)) mode = 'light';
    document.documentElement.setAttribute('data-mode', mode);
    localStorage.setItem(KEY_MODE, mode);
    updateActiveButtons();
  }

  function updateActiveButtons() {
    const curTheme = document.documentElement.getAttribute('data-theme');
    const curMode = document.documentElement.getAttribute('data-mode');

    document.querySelectorAll('[data-theme-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeBtn === curTheme);
    });
    document.querySelectorAll('[data-mode-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modeBtn === curMode);
    });
  }

  function init() {
    // Apply saved values
    applyTheme(getSavedTheme());
    applyMode(getSavedMode());

    // Bind click handlers
    document.querySelectorAll('[data-theme-btn]').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.themeBtn));
    });
    document.querySelectorAll('[data-mode-btn]').forEach(btn => {
      btn.addEventListener('click', () => applyMode(btn.dataset.modeBtn));
    });

    // Follow OS dark mode changes if user hasn't manually chosen
    if (window.matchMedia && !localStorage.getItem(KEY_MODE)) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        // Only update if still default
        if (!localStorage.getItem(KEY_MODE)) {
          applyMode(e.matches ? 'dark' : 'light');
          localStorage.removeItem(KEY_MODE); // keep it auto
        }
      });
    }
  }

  return { init, applyTheme, applyMode };
})();

// Apply theme ASAP so there's no flash of wrong theme
(function earlyApply() {
  try {
    const theme = localStorage.getItem('rubyword.theme') || 'wafu';
    const mode = localStorage.getItem('rubyword.mode')
               || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
  } catch (e) {}
})();

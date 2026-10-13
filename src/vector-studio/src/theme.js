/**
 * Theme: 'system' follows prefers-color-scheme live; 'light' and 'dark'
 * force a theme. The resolved theme is on <html data-theme-resolved>.
 */
let media = null;
let current = 'system';

function resolve() {
  const dark = current === 'dark' || (current === 'system' && media?.matches);
  const root = document.documentElement;
  root.dataset.theme = current;
  root.dataset.themeResolved = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('vector-studio:theme', current);
  } catch {
    // Storage unavailable: the theme still applies for this session.
  }
}

export function applyTheme(theme = 'system') {
  current = theme;
  if (!media && typeof matchMedia !== 'undefined') {
    media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', () => {
      if (current === 'system') {
        resolve();
        window.dispatchEvent(new CustomEvent('themechange'));
      }
    });
  }
  resolve();
  window.dispatchEvent(new CustomEvent('themechange'));
}

export function resolvedTheme() {
  return document.documentElement.dataset.themeResolved || 'light';
}

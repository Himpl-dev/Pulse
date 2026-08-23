import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pulse-theme';

// Resolved hex fallback for the handful of call sites that read a color as a
// raw SVG attribute (RadialProgress's <circle stroke=...>, Recharts
// tick/axisLine/cursor props) rather than through a real style={{}} object —
// CSS custom properties don't resolve there, so those spots need real hex.
export const THEME_HEX = {
  dark: {
    bg: '#14171C',
    surface: '#1B1F27',
    surface2: '#21262F',
    border: '#2A303B',
    text: '#EDEFF2',
    textMuted: '#8B93A1',
    textFaint: '#5C6472',
  },
  light: {
    bg: '#F4F5F7',
    surface: '#FFFFFF',
    surface2: '#EEF0F3',
    border: '#DBDFE6',
    text: '#171A1F',
    textMuted: '#5B6270',
    textFaint: '#8891A0',
  },
};

// Surface colors resolve through CSS custom properties (see src/index.css) so
// the same TOKENS.xxx call sites work under both themes with zero changes.
// Accent hues stay literal hex — they encode meaning (priority/status), not
// surface aesthetics, and some (e.g. member colors) get persisted to Supabase,
// so a var(...) string would write broken color data into the DB.
export const TOKENS = {
  bg: 'var(--token-bg)',
  surface: 'var(--token-surface)',
  surface2: 'var(--token-surface2)',
  border: 'var(--token-border)',
  text: 'var(--token-text)',
  textMuted: 'var(--token-text-muted)',
  textFaint: 'var(--token-text-faint)',
  blue: '#5B8DEF',
  teal: '#45C4A0',
  amber: '#F2A93B',
  coral: '#F2665E',
  violet: '#9B8CF2',
  magenta: '#E85DA0',
};

export function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // localStorage unavailable (private browsing, etc.) — fall through to default
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore write failures
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return { theme, toggleTheme };
}

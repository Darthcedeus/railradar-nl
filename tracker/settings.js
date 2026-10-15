import { createContext, useContext, useEffect, useState } from 'react';
import { translate, pickLanguage } from './i18n.mjs';
// Remembered per browser; storage can be unavailable (private mode), so never rely on it.
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
export const LanguageContext = createContext({ lang: 'en', t: (text, vars) => translate('en', text, vars) });
export const useT = () => useContext(LanguageContext);
export function useLanguage() {
  const [lang, setLang] = useState(() => pickLanguage(read('rr-lang'), typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]));
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const choose = next => { setLang(next); write('rr-lang', next); };
  return { lang, setLang: choose, t: (text, vars) => translate(lang, text, vars) };
}
const THEMES = ['auto', 'light', 'dark'];
export function useTheme() {
  const [mode, setMode] = useState(() => THEMES.includes(read('rr-theme')) ? read('rr-theme') : 'auto');
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemDark, setSystemDark] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const update = e => setSystemDark(e.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  const dark = mode === 'dark' || (mode === 'auto' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1726' : '#10243c');
  }, [dark]);
  const cycle = () => { const next = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length]; setMode(next); write('rr-theme', next); };
  return { mode, dark, cycle };
}

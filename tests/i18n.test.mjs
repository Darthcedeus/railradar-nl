import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { NL, translate, pickLanguage, compass } from '../tracker/i18n.mjs';
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
test('Dutch strings keep every placeholder of the English original', () => {
  for (const [en, nl] of Object.entries(NL)) assert.deepEqual(placeholders(nl), placeholders(en), en);
});
test('every literal t() string in the interface has a Dutch translation', () => {
  const missing = [];
  for (const file of readdirSync(new URL('../tracker/', import.meta.url)).filter(f => f.endsWith('.jsx'))) {
    const source = readFileSync(new URL(`../tracker/${file}`, import.meta.url), 'utf8');
    for (const [, text] of source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) if (!(text in NL)) missing.push(`${file}: ${text}`);
  }
  assert.deepEqual(missing, []);
});
test('translation falls back to English and fills placeholders', () => {
  assert.equal(translate('nl', 'Trains around {place}', { place: 'Delft' }), 'Treinen rond Delft');
  assert.equal(translate('en', 'Trains around {place}', { place: 'Delft' }), 'Trains around Delft');
  assert.equal(translate('nl', 'Den Haag Centraal'), 'Den Haag Centraal');
  assert.equal(compass('nl', 1), 'NO'); assert.equal(compass('en', 6), 'W');
});
test('language follows a saved choice, then the browser', () => {
  assert.equal(pickLanguage('en', ['nl-NL']), 'en');
  assert.equal(pickLanguage(null, ['nl-NL', 'en']), 'nl');
  assert.equal(pickLanguage(null, ['nl-BE']), 'nl');
  assert.equal(pickLanguage('xx', ['de-DE', 'en-GB']), 'en');
  assert.equal(pickLanguage(null, []), 'en');
});

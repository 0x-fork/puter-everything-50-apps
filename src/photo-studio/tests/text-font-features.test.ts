import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFont, fontTables } from '../src/imaging/text/sfnt';
import { featureOn, featureSettings, featureSupport, normalizeFeatures, toggleFeature } from '../src/imaging/text/font-features';

const bytes = (rel: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'fonts', rel)));
const crimsonBytes = bytes('crimson-pro/CrimsonPro-Variable.woff');
const interBytes = bytes('inter/Inter-Variable.woff');


describe('sfnt cmap and GSUB helpers', () => {
  it('enumerates mapped code points', () => {
    const f = parseFont(interBytes);
    const cps = f.codePoints();
    expect(cps).toContain(0x41);
    expect(cps).toContain(0xe9);
    expect(cps).not.toContain(0x4e2d);
    expect(cps.every((cp) => f.glyphIndex(cp) > 0)).toBe(true);
    expect([...cps].sort((a, b) => a - b)).toEqual(cps);
    expect(new Set(cps).size).toBe(cps.length);
  });
  it('lists GSUB features', () => {
    expect(parseFont(crimsonBytes).gsubFeatures()).toEqual(expect.arrayContaining(['onum', 'frac', 'dlig', 'liga', 'locl']));
    expect(parseFont(interBytes).gsubFeatures()).not.toContain('liga');
    expect(fontTables(interBytes).has('glyf')).toBe(true);
  });
});

describe('OpenType feature lists', () => {
  it('reports the menu features a font implements', () => {
    expect([...featureSupport(crimsonBytes)].sort()).toEqual(['dlig', 'frac', 'liga', 'onum']);
    expect([...featureSupport(interBytes)].sort()).toEqual(['calt', 'dlig', 'frac']);
  });
  it('normalizes, toggles and converts feature lists', () => {
    expect(normalizeFeatures('onum  dlig onum -calt liga -dlig bogus x')).toBe('-calt dlig onum');
    expect(toggleFeature('', 'onum', true)).toBe('onum');
    expect(toggleFeature('onum', 'onum', false)).toBe('');
    expect(toggleFeature('onum', 'calt', false)).toBe('-calt onum');
    expect(toggleFeature('-calt onum', 'calt', true)).toBe('onum');
    expect(featureOn('', 'calt')).toBe(true);
    expect(featureOn('-calt', 'calt')).toBe(false);
    expect(featureOn('frac', 'frac')).toBe(true);
    expect(featureSettings('-calt frac onum')).toBe('"calt" 0, "onum" 1');
    expect(featureSettings(undefined)).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../src/commands/registry.js';
import { comboFor, shortcutListText, KEY_ROWS } from '../src/ui/shortcuts-dialog.js';

describe('shortcuts dialog helpers', () => {
  it('builds combos in a fixed modifier order', () => {
    expect(comboFor('S', new Set(['Shift', 'Mod']))).toBe('Mod+Shift+S');
    expect(comboFor('F1', new Set())).toBe('F1');
  });

  it('lists every bound command as text', () => {
    const store = {};
    const C = new CommandRegistry({ prefs: { get: (k) => store[k], set: (k, v) => (store[k] = v) } });
    C.register([{ id: 'a.one', label: 'Beta', shortcut: 'B', run() {} }, { id: 'a.two', label: 'Alpha', shortcut: 'A', run() {} }, { id: 'a.three', label: 'None', run() {} }]);
    expect(shortcutListText(C, (id) => C.label(id))).toBe('Alpha\tA\nBeta\tB');
  });

  it('switches whole keymaps', () => {
    const store = {};
    const C = new CommandRegistry({ prefs: { get: (k) => store[k], set: (k, v) => (store[k] = v) } });
    C.register({ id: 'x.play', label: 'Play', shortcut: 'Space', run() {} });
    C.replaceOverrides({ 'x.play': ['Enter'] });
    expect(C.commandFor('Enter')).toBe('x.play');
    expect(C.commandFor('Space')).toBe(null);
    C.replaceOverrides({});
    expect(C.commandFor('Space')).toBe('x.play');
    expect(store.shortcuts).toEqual({});
  });

  it('draws every key once', () => {
    const keys = KEY_ROWS.flat().map((k) => k[0]).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

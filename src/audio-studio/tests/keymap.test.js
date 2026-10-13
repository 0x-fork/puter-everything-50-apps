import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../src/commands/registry.js';
import { installKeymap, DEFAULT_KEYS } from '../src/commands/keymap.js';

function fakeApp() {
  const store = {};
  const app = { prefs: { get: (k) => store[k], set: (k, v) => (store[k] = v) }, active: null };
  app.commands = new CommandRegistry(app);
  return app;
}

describe('keymap', () => {
  it('rebinds existing commands and adds navigation commands', () => {
    const app = fakeApp();
    app.commands.register([
      { id: 'transport.previous', label: 'Previous', shortcut: 'Home', run: () => {} },
      { id: 'transport.toStart', label: 'Start', shortcut: 'Mod+ArrowLeft', run: () => {} },
      { id: 'view.zoomFull', label: 'Full', shortcut: '\\', run: () => {} },
      { id: 'view.zoomResetTime', label: 'Reset', run: () => {} },
    ]);
    installKeymap(app);
    const C = app.commands;
    expect(C.commandFor('Home')).toBe('transport.toStart');
    expect(C.commandFor('Mod+ArrowLeft')).toBe('transport.toStart');
    expect(C.commandFor('Alt+ArrowLeft')).toBe('transport.previous');
    expect(C.commandFor('\\')).toBe('view.zoomResetTime');
    expect(C.commandFor('Mod+\\')).toBe('view.zoomFull');
    expect(C.commandFor('Q')).toBe('transport.toInPoint');
    expect(C.commandFor('O')).toBe('edit.setOutPoint');
  });

  it('keeps user remappings over the defaults', () => {
    const app = fakeApp();
    app.prefs.set('shortcuts', { 'transport.toStart': ['Mod+Home'] });
    app.commands = new CommandRegistry(app);
    app.commands.register({ id: 'transport.toStart', label: 'Start', run: () => {} });
    installKeymap(app);
    expect(app.commands.commandFor('Mod+Home')).toBe('transport.toStart');
    expect(app.commands.commandFor('Home')).toBe(null);
  });

  it('gives every key to one command only', () => {
    const keys = Object.values(DEFAULT_KEYS).flat();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

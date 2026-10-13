// Edit > Keyboard Shortcuts: every command with its keys, searchable, each
// key changed by pressing the new combination (a key taken by another
// command moves here). Named shortcut sets save and restore whole keymaps;
// the Keyboard view draws a keyboard showing what each key does with the
// chosen modifiers (click a key to find its command in the list); Copy List
// puts every shortcut on the clipboard as text.

import { h } from '../lib/dom.js';
import { icon } from './icons.js';
import { openDialog, promptDialog, confirmDialog } from './dialog.js';
import { formatShortcut, eventShortcut, normalizeShortcut, IS_MAC } from '../commands/registry.js';
import { commandMenuPaths, contextLabel } from './menus.js';

const GROUP_NAMES = { file: 'File', edit: 'Edit', tool: 'Tools', view: 'View', transport: 'Transport', marker: 'Markers', window: 'Window', mt: 'Multitrack', clip: 'Clip', fx: 'Effects', gen: 'Generate', snap: 'Snapping', help: 'Help', theme: 'Theme', fav: 'Favorites', export: 'Export', spectral: 'Spectral', prefs: 'Preferences', zero: 'Zero Crossings', meter: 'Metering', status: 'Status Bar', workspace: 'Workspace' };

/** Keyboard rows for the Keyboard view: [key as in shortcuts, cap label, width in units]. */
export const KEY_ROWS = [
  [['Escape', 'Esc', 1.2], ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12']],
  [['`', '`'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['0', '0'], ['-', '-'], ['=', '='], ['Backspace', '⌫', 1.6]],
  [['Tab', 'Tab', 1.4], ['Q', 'Q'], ['W', 'W'], ['E', 'E'], ['R', 'R'], ['T', 'T'], ['Y', 'Y'], ['U', 'U'], ['I', 'I'], ['O', 'O'], ['P', 'P'], ['[', '['], [']', ']'], ['\\', '\\', 1.2]],
  [[null, '', 1.7], ['A', 'A'], ['S', 'S'], ['D', 'D'], ['F', 'F'], ['G', 'G'], ['H', 'H'], ['J', 'J'], ['K', 'K'], ['L', 'L'], [';', ';'], ["'", "'"], ['Enter', '↵', 1.9]],
  [[null, '', 2.2], ['Z', 'Z'], ['X', 'X'], ['C', 'C'], ['V', 'V'], ['B', 'B'], ['N', 'N'], ['M', 'M'], [',', ','], ['.', '.'], ['/', '/'], [null, '', 2.4]],
  [[null, '', 3.6], ['Space', 'Space', 6], [null, '', 0.6], ['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→']],
  [['Home', 'Home', 1.3], ['End', 'End', 1.3], ['PageUp', 'PgUp', 1.3], ['PageDown', 'PgDn', 1.3], ['Delete', 'Del', 1.3]],
];

/** Shortcut text for a key with modifiers ('Mod', 'Shift', 'Alt', 'Ctrl'). */
export function comboFor(key, mods) {
  return [...['Mod', 'Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+');
}

/** Tab-separated list of every command that has keys, grouped like the menus. */
export function shortcutListText(C, label) {
  const lines = [];
  for (const id of C.commands.keys()) {
    const keys = C.keysFor(id);
    if (keys.length) lines.push(`${label(id)}\t${keys.map(formatShortcut).join(', ')}`);
  }
  return lines.sort((a, b) => a.localeCompare(b)).join('\n');
}

export function shortcutsDialog(app) {
  const C = app.commands;
  const prefs = app.prefs;
  const paths = commandMenuPaths();
  const label = (id) => contextLabel(id, C.label(id), paths);
  const search = h('input.input', { type: 'search', placeholder: 'Search commands or shortcuts', 'aria-label': 'Search shortcuts', style: { width: '100%' } });
  const status = h('div.shortcut-status', { role: 'status' });
  const list = h('div.shortcut-list');
  const keyboard = h('div.kb-view', { hidden: true });
  let capturing = null;

  // ------------------------------------------------------------ sets
  const sets = () => ({ ...(prefs.get('shortcutSets') || {}) });
  const setSel = h('select.select', { 'aria-label': 'Shortcut set' });
  const fillSets = () => {
    const current = prefs.get('shortcutSet') || '';
    setSel.replaceChildren(h('option', { value: '' }, 'Default'), ...Object.keys(sets()).map((n) => h('option', { value: n }, n)));
    setSel.value = sets()[current] ? current : '';
    delSet.disabled = !setSel.value;
  };
  setSel.addEventListener('change', () => {
    const name = setSel.value;
    C.replaceOverrides(name ? sets()[name] : {});
    prefs.set('shortcutSet', name);
    status.textContent = name ? `Using the "${name}" shortcuts.` : 'Using the default shortcuts.';
    fillSets();
    render();
  });
  const saveSet = h('button.icon-btn', { type: 'button', title: 'Save as a New Set', 'aria-label': 'Save these shortcuts as a new set' }, icon('save', 15));
  saveSet.addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Save Shortcut Set', label: 'Name:', value: setSel.value || 'My Shortcuts', confirm: 'Save', validate: (v) => (v.trim() ? (v.trim().toLowerCase() === 'default' ? 'Choose another name.' : '') : 'Enter a name.') });
    if (!name) return;
    prefs.set('shortcutSets', { ...sets(), [name.trim()]: Object.fromEntries(C.overrides) });
    prefs.set('shortcutSet', name.trim());
    fillSets();
    status.textContent = `Saved the "${name.trim()}" set.`;
  });
  const delSet = h('button.icon-btn', { type: 'button', title: 'Delete Set', 'aria-label': 'Delete this shortcut set' }, icon('trash-2', 15));
  delSet.addEventListener('click', async () => {
    const name = setSel.value;
    if (!name || !(await confirmDialog({ title: 'Delete Shortcut Set', message: `Delete the "${name}" set? The shortcuts in use now stay as they are.`, confirm: 'Delete', danger: true }))) return;
    const next = sets();
    delete next[name];
    prefs.set('shortcutSets', next);
    prefs.set('shortcutSet', '');
    fillSets();
  });
  const copyBtn = h('button.btn', { type: 'button' }, icon('copy', 14), 'Copy List');
  copyBtn.addEventListener('click', async () => {
    const text = shortcutListText(C, label);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Every shortcut was copied to the clipboard.';
    } catch {
      status.textContent = 'The clipboard is not available here.';
    }
  });

  // ------------------------------------------------------------ views
  const viewBtns = h('div.seg', { role: 'radiogroup', 'aria-label': 'Show' });
  let view = prefs.get('shortcutView') === 'keyboard' ? 'keyboard' : 'list';
  const syncView = () => {
    for (const b of viewBtns.children) b.setAttribute('aria-checked', String(b.dataset.view === view));
    list.hidden = view !== 'list';
    search.hidden = view !== 'list';
    keyboard.hidden = view !== 'keyboard';
    if (view === 'keyboard') renderKeyboard();
  };
  for (const [v, text] of [['list', 'List'], ['keyboard', 'Keyboard']]) {
    viewBtns.append(h('button.seg-btn', { type: 'button', role: 'radio', dataset: { view: v }, onclick: () => {
      view = v;
      prefs.set('shortcutView', v);
      syncView();
    } }, text));
  }

  // Keyboard view: modifier toggles and the key caps.
  const mods = new Set();
  const modBar = h('div.kb-mods', h('span.muted', 'With:'));
  const modNames = IS_MAC ? [['Mod', '⌘ Command'], ['Shift', '⇧ Shift'], ['Alt', '⌥ Option'], ['Ctrl', '⌃ Control']] : [['Mod', 'Ctrl'], ['Shift', 'Shift'], ['Alt', 'Alt']];
  for (const [m, text] of modNames) {
    const b = h('button.btn.sm', { type: 'button', 'aria-pressed': 'false' }, text);
    b.addEventListener('click', () => {
      if (mods.has(m)) mods.delete(m);
      else mods.add(m);
      b.setAttribute('aria-pressed', String(mods.has(m)));
      renderKeyboard();
    });
    modBar.append(b);
  }
  const caps = h('div.kb-rows');
  keyboard.append(modBar, caps, h('p.faint', 'Click a key to find its command in the list.'));
  function renderKeyboard() {
    caps.replaceChildren(
      ...KEY_ROWS.map((row) =>
        h(
          'div.kb-row',
          row.map(([key, cap, w = 1]) => {
            if (!key) return h('span.kb-gap', { style: { flexGrow: String(w) } });
            const combo = comboFor(key, mods);
            const id = C.commandFor(combo);
            // Key caps are small: the command's own name, without its menu path.
            const name = id ? String(C.label(id)).replace(/\.\.\.$/, '') : '';
            return h(
              `button.kb-key${id ? '.on' : ''}`,
              { type: 'button', style: { flexGrow: String(w) }, title: id ? `${formatShortcut(combo)}: ${name}` : `${formatShortcut(combo)}: not assigned`, 'aria-label': `${formatShortcut(combo)}${id ? `, ${name}` : ', not assigned'}`, onclick: () => {
                view = 'list';
                search.value = formatShortcut(combo);
                syncView();
                render();
              } },
              h('span.kb-cap', cap),
              h('span.kb-cmd', name),
            );
          }),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ list
  const capture = (id, button) => {
    capturing?.cancel();
    button.textContent = 'Press keys...';
    button.classList.add('capturing');
    const onKey = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      if (e.key === 'Escape') return render(id);
      const keys = eventShortcut(e);
      const other = C.commandFor(keys);
      C.setShortcuts(id, [keys, ...C.keysFor(id).slice(1).filter((k) => normalizeShortcut(k) !== keys)]);
      status.textContent = other && other !== id ? `${formatShortcut(keys)} was moved from "${label(other)}" to "${label(id)}".` : `${label(id)}: ${formatShortcut(keys)}`;
      render(id);
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      capturing = null;
    };
    window.addEventListener('keydown', onKey, true);
    capturing = { cancel: () => {
      cleanup();
      render(id);
    } };
  };

  // Rebuilds the list; `focusId` puts keyboard focus back on that command's row.
  function render(focusId) {
    const q = search.value.trim().toLowerCase();
    const groups = new Map();
    let shown = 0;
    for (const id of C.commands.keys()) {
      const keys = C.keysFor(id).map(formatShortcut).join(', ');
      if (q && !label(id).toLowerCase().includes(q) && !keys.toLowerCase().includes(q)) continue;
      if (++shown > 400) break;
      const g = id.split('.')[0];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ id, keys });
    }
    list.replaceChildren();
    for (const [g, items] of groups) {
      list.append(
        h('h3.shortcut-group', GROUP_NAMES[g] || g),
        h(
          'table.data-table.shortcut-table',
          h(
            'tbody',
            items.map(({ id, keys }) => {
              const edit = h('button.btn.shortcut-edit', { type: 'button', 'aria-label': `Change shortcut for ${label(id)}`, dataset: { id } }, keys ? h('kbd', keys) : 'Add');
              edit.addEventListener('click', () => capture(id, edit));
              const custom = C.overrides.has(id);
              return h(
                'tr',
                h('td', label(id)),
                h(
                  'td.kbd-cell',
                  edit,
                  keys ? h('button.icon-btn', { type: 'button', 'aria-label': `Remove shortcut for ${label(id)}`, title: 'Remove', onclick: () => {
                    C.setShortcuts(id, []);
                    render(id);
                  } }, icon('x', 14)) : null,
                  custom ? h('button.icon-btn', { type: 'button', 'aria-label': `Reset ${label(id)} to default`, title: 'Reset to default', onclick: () => {
                    C.resetShortcuts(id);
                    render(id);
                  } }, icon('rotate-ccw', 14)) : null,
                ),
              );
            }),
          ),
        ),
      );
    }
    if (!groups.size) list.append(h('p.muted', 'No matching commands.'));
    if (typeof focusId === 'string') list.querySelector(`.shortcut-edit[data-id="${focusId}"]`)?.focus();
  }
  search.addEventListener('input', () => render());
  fillSets();
  render();
  syncView();
  return openDialog({
    title: 'Keyboard Shortcuts',
    wide: true,
    body: h('div.shortcuts', h('div.shortcut-bar', h('label.muted', 'Set:'), setSel, saveSet, delSet, h('div.spacer'), viewBtns, copyBtn), search, status, list, keyboard),
    footerStart: h('button.btn', { type: 'button', onclick: () => {
      C.resetShortcuts();
      prefs.set('shortcutSet', '');
      fillSets();
      status.textContent = 'All shortcuts restored to their defaults.';
      render();
      if (view === 'keyboard') renderKeyboard();
    } }, 'Reset All'),
    buttons: [{ label: 'Close', value: true, primary: true }],
  }).finally(() => capturing?.cancel());
}

/**
 * Keyboard shortcuts dialog: browse every command by group, search, and
 * rebind keys. Rebinding records the next key combination pressed; a key
 * another command uses can be taken over after confirming.
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { isMac, shortcutLabel } from '../lib/platform.js';
import { SHORTCUT_GROUPS, RESERVED_KEYS } from './commands.js';
import { openDialog, confirmDialog } from './dialog.js';

const CODE_NAMES = {
  Space: 'Space', Period: 'Period', Slash: 'Slash', Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Comma: 'Comma',
  Semicolon: 'Semicolon', Quote: 'Quote', Backquote: 'Backquote', Backslash: 'Backslash',
};
const KEY_NAMES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Tab',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);

/**
 * Shortcut spec ("Mod+Shift+K") for a keydown, or null for a lone modifier
 * or a key the editor can't match.
 */
export function specFromEvent(e) {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return null;
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code];
  else if (KEY_NAMES.has(e.key)) key = e.key;
  if (!key) return null;
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function openShortcutsDialog(commands) {
  let group = 'All';
  let query = '';
  let recording = null; // { id, chip, onKey }
  const search = h('input.input.shortcut-search', { type: 'search', placeholder: 'Search commands or keys', 'aria-label': 'Search shortcuts' });
  const groupNames = ['All', ...SHORTCUT_GROUPS.filter((g) => commands.list.some((c) => c.group === g))];
  const tabList = h('div.shortcut-tabs', { role: 'tablist', 'aria-label': 'Shortcut groups' });
  const list = h('div.shortcut-list', { role: 'region', 'aria-live': 'polite' });
  const status = h('p.shortcut-status', { role: 'status' });

  const renderTabs = () => {
    tabList.replaceChildren(...groupNames.map((g) => {
      const b = h('button.shortcut-tab', { type: 'button', role: 'tab', 'aria-selected': String(g === group) }, g);
      b.addEventListener('click', () => {
        group = g;
        renderTabs();
        renderList();
      });
      return b;
    }));
  };

  const stopRecording = () => {
    if (!recording) return;
    document.removeEventListener('keydown', recording.onKey, true);
    recording.chip.classList.remove('recording');
    recording = null;
  };

  const record = (cmd, chip, index) => {
    stopRecording();
    chip.classList.add('recording');
    chip.textContent = 'Press keys...';
    status.textContent = `Press the new shortcut for "${cmd.label}". Escape cancels.`;
    const onKey = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        stopRecording();
        status.textContent = '';
        renderList();
        return;
      }
      const spec = specFromEvent(e);
      if (!spec) return;
      stopRecording();
      if (RESERVED_KEYS.includes(spec)) {
        status.textContent = `${shortcutLabel(spec)} is reserved by the browser or the editor.`;
        renderList();
        return;
      }
      const clash = commands.conflicts(spec, cmd.id);
      if (clash.length) {
        const ok = await confirmDialog({ title: 'Shortcut in use', message: `${shortcutLabel(spec)} is used by "${clash.map((c) => c.label).join('", "')}". Use it for "${cmd.label}" instead?`, confirm: 'Reassign' });
        if (!ok) {
          renderList();
          return;
        }
        for (const c of clash) commands.setKeys(c.id, c.keys.filter((k) => k !== spec));
      }
      const keys = [...cmd.keys];
      if (index < keys.length) keys[index] = spec;
      else keys.push(spec);
      commands.setKeys(cmd.id, [...new Set(keys)]);
      status.textContent = `${cmd.label}: ${shortcutLabel(spec)}`;
      announce(status.textContent);
      renderList();
    };
    recording = { id: cmd.id, chip, onKey };
    document.addEventListener('keydown', onKey, true);
  };

  const row = (cmd) => {
    const chips = cmd.keys.map((k, i) => {
      const chip = h('button.kbd-chip', { type: 'button', 'aria-label': `Change shortcut ${shortcutLabel(k)} for ${cmd.label}` }, shortcutLabel(k));
      chip.addEventListener('click', () => record(cmd, chip, i));
      const remove = h('button.icon-btn.small.kbd-remove', { type: 'button', 'aria-label': `Remove ${shortcutLabel(k)} from ${cmd.label}`, 'data-tip': 'Remove' }, icon('close', 12));
      remove.addEventListener('click', () => {
        commands.setKeys(cmd.id, cmd.keys.filter((x) => x !== k));
        renderList();
      });
      return h('span.kbd-pair', chip, remove);
    });
    const add = h('button.kbd-chip.add', { type: 'button', 'aria-label': `Add a shortcut for ${cmd.label}` }, cmd.keys.length ? '+' : 'Add shortcut');
    add.addEventListener('click', () => record(cmd, add, cmd.keys.length));
    const reset = commands.isCustom(cmd.id) ? h('button.btn.ghost.small', { type: 'button', 'aria-label': `Reset ${cmd.label} to its default`, 'data-tip': 'Default: ' + (cmd.defaultKeys.map(shortcutLabel).join(', ') || 'none') }, icon('reset', 14)) : null;
    reset?.addEventListener('click', () => {
      commands.setKeys(cmd.id, null);
      renderList();
    });
    return h('div.shortcut-row', h('span.shortcut-label', cmd.label, commands.isCustom(cmd.id) ? h('span.shortcut-custom', 'Custom') : null), h('span.shortcut-keys', chips, add, reset));
  };

  const renderList = () => {
    const q = query.trim().toLowerCase();
    const groups = group === 'All' ? SHORTCUT_GROUPS : [group];
    const sections = groups.map((g) => {
      const items = commands.list.filter((c) => c.group === g && (!q || c.label.toLowerCase().includes(q) || c.keys.some((k) => shortcutLabel(k).toLowerCase().includes(q) || k.toLowerCase().includes(q))));
      if (!items.length) return null;
      return h('section.shortcut-group', h('h3', g), items.map(row));
    }).filter(Boolean);
    list.replaceChildren(...(sections.length ? sections : [h('p.empty-note', 'No commands match.')]));
  };

  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  renderTabs();
  renderList();

  const resetAll = h('button.btn', { type: 'button' }, 'Reset all to defaults');
  const done = h('button.btn.primary', { type: 'button' }, 'Done');
  const d = openDialog({
    title: 'Keyboard shortcuts',
    body: h('div.shortcuts-editor', h('div.shortcut-top', tabList, search), list, status),
    actions: [resetAll, h('span.spacer'), done],
    wide: true,
    className: 'shortcuts-dialog',
    onClose: stopRecording,
  });
  resetAll.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset shortcuts?', message: 'Every shortcut goes back to its default.', confirm: 'Reset' });
    if (!ok) return;
    commands.resetKeys();
    renderList();
  });
  done.addEventListener('click', () => d.close());
  return d;
}

// Workspace management: Save Changes to this Workspace, Save as New
// Workspace, and the Edit Workspaces dialog (order, which ones appear as
// toolbar tabs, rename and delete custom workspaces).
//
// Storage (prefs):
//   layouts            name -> current layout, updated as panels are moved
//   savedLayouts       name -> layout saved with "Save Changes" (Reset returns here)
//   customWorkspaces   name -> layout of a user workspace as first saved
//   workspaceOrder     names in menu order (missing names follow in default order)
//   workspaceTabs      names shown as toolbar tabs

import { h } from '../lib/dom.js';
import { icon } from './icons.js';
import { openDialog, promptDialog, confirmDialog } from './dialog.js';
import { WORKSPACES, DEFAULT_TABS } from './workspaces.js';

const TAB_LIMIT = 6;

/** Workspace names in the user's order: known names first, then any others in default order. */
export function orderedNames(all, order = []) {
  const known = order.filter((n) => all.includes(n));
  return [...known, ...all.filter((n) => !known.includes(n))];
}

/** Names shown as toolbar tabs: the saved choice, else the default set. */
export function tabNames(app) {
  const all = app.workspaceNames();
  const saved = app.prefs.get('workspaceTabs');
  const tabs = (Array.isArray(saved) ? saved : DEFAULT_TABS).filter((n) => all.includes(n));
  return tabs.length ? tabs : all.slice(0, 1);
}

/** Problem with a new workspace name, or ''. */
export function workspaceNameProblem(name, existing, current = null) {
  const n = name.trim();
  if (!n) return 'Enter a name.';
  if (n.length > 40) return 'Use 40 characters or fewer.';
  if (existing.some((x) => x.toLowerCase() === n.toLowerCase() && x !== current)) return 'A workspace with that name already exists.';
  return '';
}

/** Renames a key in a name-keyed prefs object. */
function renameKey(obj, from, to) {
  if (!obj || !(from in obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k === from ? to : k] = v;
  return out;
}

async function saveAsNew(app) {
  const name = await promptDialog({
    title: 'New Workspace',
    label: 'Name:',
    value: `${app.prefs.get('workspace')} Copy`,
    confirm: 'Save',
    validate: (v) => workspaceNameProblem(v, app.workspaceNames()),
  });
  if (!name) return;
  const n = name.trim();
  const layout = app.dock.layout();
  app.prefs.set('customWorkspaces', { ...(app.prefs.get('customWorkspaces') || {}), [n]: layout });
  app.prefs.set('workspaceOrder', [...orderedNames(app.workspaceNames().filter((x) => x !== n), app.prefs.get('workspaceOrder')), n]);
  app.setWorkspace(n);
  app.setStatus(`Saved workspace "${n}"`);
}

function editDialog(app) {
  const prefs = app.prefs;
  let order = orderedNames(app.workspaceNames(), prefs.get('workspaceOrder'));
  let tabs = new Set(tabNames(app));
  let custom = { ...(prefs.get('customWorkspaces') || {}) };
  const renames = [];
  const deleted = new Set();
  const list = h('ul.ws-list', { role: 'list' });
  const note = h('p.faint', { style: { margin: '8px 0 0' } }, `Checked workspaces appear as tabs in the toolbar (up to ${TAB_LIMIT}).`);
  const render = (focus) => {
    list.replaceChildren(
      ...order.map((name, i) => {
        const isCustom = !WORKSPACES[name];
        const check = h('input', { type: 'checkbox', checked: tabs.has(name), 'aria-label': `Show ${name} as a toolbar tab` });
        check.addEventListener('change', () => {
          if (check.checked && tabs.size >= TAB_LIMIT) {
            check.checked = false;
            return app.notify(`Up to ${TAB_LIMIT} workspaces can be tabs.`);
          }
          if (check.checked) tabs.add(name);
          else tabs.delete(name);
        });
        const btn = (ic, label, fn, disabled = false, key = '') => h('button.icon-btn', { type: 'button', title: label, 'aria-label': `${label}: ${name}`, disabled, dataset: { key }, onclick: fn }, icon(ic, 14));
        const move = (d) => {
          const j = i + d;
          [order[i], order[j]] = [order[j], order[i]];
          render(`${d < 0 ? 'up' : 'down'}:${name}`);
        };
        return h(
          'li.ws-row',
          h('label.check.ws-name', check, h('span', name), isCustom ? h('span.faint', ' (custom)') : null),
          h(
            'div.ws-actions',
            btn('arrow-up', 'Move up', () => move(-1), i === 0, `up:${name}`),
            btn('arrow-down', 'Move down', () => move(1), i === order.length - 1, `down:${name}`),
            btn('pencil', 'Rename', async () => {
              const next = await promptDialog({ title: 'Rename Workspace', label: 'Name:', value: name, validate: (v) => workspaceNameProblem(v, order, name) });
              if (!next || next.trim() === name) return;
              const n = next.trim();
              order = order.map((x) => (x === name ? n : x));
              if (tabs.delete(name)) tabs.add(n);
              custom = renameKey(custom, name, n);
              renames.push([name, n]);
              render(`rename:${n}`);
            }, !isCustom, `rename:${name}`),
            btn('trash-2', 'Delete', async () => {
              if (!(await confirmDialog({ title: 'Delete Workspace', message: `Delete the workspace "${name}"?`, confirm: 'Delete', danger: true }))) return;
              order = order.filter((x) => x !== name);
              tabs.delete(name);
              delete custom[name];
              deleted.add(name);
              render();
            }, !isCustom || order.length <= 1, `delete:${name}`),
          ),
        );
      }),
    );
    if (focus) list.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();
  };
  render();
  return openDialog({
    title: 'Edit Workspaces',
    body: h('div.ws-edit', list, note),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', value: 'ok', primary: true },
    ],
  }).then((r) => {
    if (r !== 'ok') return;
    // Carry current and saved layouts over to renamed workspaces; drop deleted ones.
    let layouts = { ...(prefs.get('layouts') || {}) };
    let saved = { ...(prefs.get('savedLayouts') || {}) };
    let current = prefs.get('workspace');
    for (const [from, to] of renames) {
      layouts = renameKey(layouts, from, to);
      saved = renameKey(saved, from, to);
      if (current === from) current = to;
    }
    for (const name of deleted) {
      delete layouts[name];
      delete saved[name];
    }
    prefs.set('customWorkspaces', custom);
    prefs.set('layouts', layouts);
    prefs.set('savedLayouts', saved);
    prefs.set('workspaceOrder', order);
    prefs.set('workspaceTabs', order.filter((n) => tabs.has(n)));
    if (deleted.has(current)) current = order[0];
    app.setWorkspace(current);
  });
}

export function installWorkspaceCommands(app) {
  const desktop = (a) => a.layoutMode === 'desktop' && Boolean(a.dock);
  app.commands.register([
    {
      id: 'workspace.saveChanges',
      label: 'Save Changes to this Workspace',
      enabled: desktop,
      run: () => {
        const name = app.prefs.get('workspace');
        app.prefs.set('savedLayouts', { ...(app.prefs.get('savedLayouts') || {}), [name]: app.dock.layout() });
        app.setStatus(`Saved the layout of "${name}"`);
      },
    },
    { id: 'workspace.saveAs', label: 'Save as New Workspace...', enabled: desktop, run: () => saveAsNew(app) },
    { id: 'workspace.edit', label: 'Edit Workspaces...', enabled: desktop, run: () => editDialog(app) },
    { id: 'workspace.reset', label: 'Reset to Saved Layout', enabled: desktop, run: () => app.setWorkspace(app.prefs.get('workspace'), { reset: true }) },
  ]);
  const item = (id) => ({ type: 'cmd', label: app.commands.label(id), enabled: app.commands.isEnabled(id), run: () => app.commands.run(id) });
  app.workspaceMenuItems = () => [
    ...orderedNames(app.workspaceNames(), app.prefs.get('workspaceOrder')).map((name) => ({
      type: 'cmd',
      label: name,
      enabled: app.layoutMode === 'desktop',
      checked: app.prefs.get('workspace') === name,
      run: () => app.setWorkspace(name),
    })),
    { type: 'sep' },
    item('workspace.reset'),
    item('workspace.saveChanges'),
    item('workspace.saveAs'),
    { type: 'sep' },
    item('workspace.edit'),
  ];
}

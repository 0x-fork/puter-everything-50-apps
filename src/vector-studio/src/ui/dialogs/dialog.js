/**
 * Modal dialogs on the native <dialog> element (built-in focus trapping,
 * Escape to cancel, inert background). Dialogs are draggable by their title
 * bar on desktop and become bottom sheets on narrow screens (CSS).
 *
 *   const result = await openDialog({ title, body, buttons })
 *   const values = await formDialog(app, { title, fields })
 */
import { h } from '../../lib/dom.js';
import { icon } from '../icons.js';
import { formatLength, parseLength, parseNumber, UNITS } from '../../lib/units.js';

let counter = 0;

/**
 * Cancel every open dialog (as Escape would) and wait for their callers to
 * roll back their previews: for actions that arrive from outside the page
 * (opening files from the desktop, closing the window) while a dialog is up.
 */
export async function cancelOpenDialogs() {
  const open = [...document.querySelectorAll('dialog[open]')];
  if (!open.length) return false;
  const closed = open.map((d) => new Promise((r) => d.addEventListener('close', r, { once: true })));
  for (const d of open.reverse()) d.dispatchEvent(new Event('cancel', { cancelable: true }));
  await Promise.race([Promise.all(closed), new Promise((r) => setTimeout(r, 1000))]);
  // Let the callers' continuations (rolling back previews) run.
  await new Promise((r) => setTimeout(r, 0));
  return true;
}

/**
 * Hooks for recording and replaying dialogs (the Actions panel):
 *   open(opts, show)       wraps every openDialog() call; `show(opts)` shows it
 *   fields(title, fields)  may return form fields with prefilled values
 */
export const dialogHooks = { open: null, fields: null };

export function openDialog(opts = {}) {
  return dialogHooks.open ? dialogHooks.open(opts, showDialog) : showDialog(opts);
}

function showDialog({ title, body, buttons = [], className = '', onOpen, onClose, initialFocus, describedBy } = {}) {
  return new Promise((resolve) => {
    const id = `dlg-${++counter}`;
    const footer = h('div.dialog-footer');
    const dialog = h(`dialog.dialog${className ? '.' + className.split(' ').join('.') : ''}`, {
      'aria-labelledby': `${id}-title`,
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    });
    const header = h(
      'div.dialog-header',
      h('h2.dialog-title', { id: `${id}-title` }, title),
      h('button.icon-btn.dialog-close', { type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x', 16)),
    );
    const content = h('div.dialog-body', body);
    let result = null;
    const close = (value) => {
      result = value;
      if (dialog.open) dialog.close();
    };
    for (const b of buttons) {
      const btn = h(
        `button.btn${b.primary ? '.primary' : ''}${b.danger ? '.danger' : ''}`,
        {
          type: 'button',
          onclick: async () => {
            if (b.validate && !(await b.validate())) return;
            close(typeof b.value === 'function' ? b.value() : b.value);
          },
          ...(b.disabled ? { disabled: true } : {}),
        },
        b.label,
      );
      if (b.left) btn.classList.add('left');
      footer.append(btn);
    }
    dialog.append(header, content);
    if (buttons.length) dialog.append(footer);
    dialog.addEventListener('close', () => {
      onClose?.(result);
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    // Enter submits with the primary button unless focus is in a textarea or on a button.
    dialog.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = footer.querySelector('.btn.primary');
        if (primary && !primary.disabled) {
          e.preventDefault();
          // Fields that apply on 'change' (like hex fields) must commit what was typed before OK reads them.
          if (e.target.tagName === 'INPUT') e.target.dispatchEvent(new Event('change', { bubbles: true }));
          primary.click();
        }
      }
    });
    makeDraggable(dialog, header);
    document.body.append(dialog);
    dialog.showModal();
    const focusEl = initialFocus?.() || content.querySelector('input:not([type=hidden]), select, textarea, button') || footer.querySelector('.btn.primary');
    focusEl?.focus();
    if (focusEl?.select && focusEl.type !== 'checkbox' && focusEl.type !== 'range') focusEl.select();
    onOpen?.({ dialog, close, footer, content });
  });
}

function makeDraggable(dialog, handle) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || matchMedia('(max-width: 760px)').matches) return;
    const r = dialog.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    dialog.style.margin = '0';
    dialog.style.left = `${Math.max(0, start.left + e.clientX - start.x)}px`;
    dialog.style.top = `${Math.max(0, start.top + e.clientY - start.y)}px`;
  });
  handle.addEventListener('pointerup', () => {
    start = null;
  });
}

/**
 * A form dialog. Field types: number, length (document units, stored in
 * points), angle (degrees), percent, text, checkbox, select, range, color,
 * radio. Returns an object of values, or null when cancelled.
 * `onChange(values)` runs on every edit (for live previews).
 */
export function formDialog(app, { title, fields, okLabel = 'OK', extraButtons = [], onChange, description, previewToggle = false }) {
  fields = dialogHooks.fields?.(title, fields) || fields;
  const unit = app?.editor?.doc.root.units || 'pt';
  const inputs = new Map();
  let fid = 0;
  const read = () => {
    const out = {};
    for (const f of fields) {
      if (f.type === 'heading') continue;
      const el = inputs.get(f.key);
      if (!el) continue;
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'length') out[f.key] = parseLength(el.value, unit);
      else if (f.type === 'number' || f.type === 'angle' || f.type === 'percent') out[f.key] = parseNumber(el.value);
      else if (f.type === 'range') out[f.key] = Number(el.value);
      else if (f.type === 'radio') out[f.key] = el.querySelector('input:checked')?.value;
      else out[f.key] = el.value;
    }
    return out;
  };
  const valid = () => {
    const v = read();
    for (const f of fields) {
      const val = v[f.key];
      if (['length', 'number', 'angle', 'percent'].includes(f.type)) {
        if (!Number.isFinite(val)) return { ok: false, field: f };
        if (f.min != null && val < f.min) return { ok: false, field: f };
        if (f.max != null && val > f.max) return { ok: false, field: f };
      }
    }
    return { ok: true };
  };
  const rows = fields.map((f) => {
    if (f.type === 'heading') return h('h3.form-heading', f.label);
    const id = `f-${counter}-${++fid}`;
    let input;
    if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', id, checked: Boolean(f.value) });
      inputs.set(f.key, input);
      return h('div.form-row.check', input, h('label', { for: id }, f.label));
    }
    if (f.type === 'select') {
      input = h('select', { id }, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
    } else if (f.type === 'radio') {
      input = h(
        'div.radio-group',
        { role: 'radiogroup', 'aria-labelledby': `${id}-l` },
        f.options.map((o, i) => h('label.radio', h('input', { type: 'radio', name: id, value: o.value, checked: o.value === f.value || (!f.value && i === 0) }), o.label)),
      );
      inputs.set(f.key, input);
      return h('div.form-row', h('span.form-label', { id: `${id}-l` }, f.label), input);
    } else if (f.type === 'range') {
      const out = h('output.range-out', { for: id }, String(f.value));
      input = h('input', { type: 'range', id, min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, value: f.value, oninput: () => (out.textContent = input.value) });
      inputs.set(f.key, input);
      return h('div.form-row', h('label', { for: id }, f.label), h('div.range-wrap', input, out));
    } else if (f.type === 'color') {
      input = h('input', { type: 'color', id, value: f.value || '#000000' });
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, rows: f.rows || 4 }, f.value ?? '');
    } else {
      let shown = f.value ?? '';
      if (f.type === 'length') shown = formatLength(f.value ?? 0, unit);
      if (f.type === 'angle') shown = `${Number((f.value ?? 0).toFixed(3))}°`;
      if (f.type === 'percent') shown = `${Number((f.value ?? 0).toFixed(3))}%`;
      input = h('input', {
        type: 'text',
        id,
        value: shown,
        inputmode: ['length', 'number', 'angle', 'percent'].includes(f.type) ? 'decimal' : undefined,
        spellcheck: false,
        autocomplete: 'off',
        'aria-describedby': f.help ? `${id}-help` : undefined,
      });
      if (['length', 'number', 'angle', 'percent'].includes(f.type)) {
        // Arrow keys step the value (Shift for 10x).
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const step = (f.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          if (f.type === 'length') {
            const cur = parseLength(input.value, unit);
            if (Number.isFinite(cur)) input.value = formatLength(cur + step * (UNITS[unit]?.factor || 1), unit);
          } else {
            const cur = parseNumber(input.value);
            if (Number.isFinite(cur)) {
              const v = cur + step;
              input.value = f.type === 'angle' ? `${v}°` : f.type === 'percent' ? `${v}%` : String(v);
            }
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        input.addEventListener('blur', () => {
          const v = f.type === 'length' ? parseLength(input.value, unit) : parseNumber(input.value);
          if (!Number.isFinite(v)) return;
          if (f.type === 'length') input.value = formatLength(v, unit);
          else if (f.type === 'angle') input.value = `${Number(v.toFixed(3))}°`;
          else if (f.type === 'percent') input.value = `${Number(v.toFixed(3))}%`;
        });
      }
    }
    inputs.set(f.key, input);
    return h('div.form-row', h('label', { for: id }, f.label), input, f.help ? h('p.form-help', { id: `${id}-help` }, f.help) : null);
  });
  const error = h('p.form-error', { role: 'alert' });
  const body = h('div.form', description ? h('p.form-description', description) : null, rows, error);
  if (onChange) body.addEventListener('input', () => valid().ok && onChange(read()));
  if (onChange) body.addEventListener('change', () => valid().ok && onChange(read()));
  const validate = () => {
    const r = valid();
    if (!r.ok) {
      error.textContent = `Enter a valid value for ${r.field.label}.`;
      inputs.get(r.field.key)?.focus();
      return false;
    }
    error.textContent = '';
    return true;
  };
  return openDialog({
    title,
    body,
    buttons: [
      ...extraButtons.map((b) => ({ ...b, value: () => ({ ...read(), __action: b.action }), validate })),
      { label: 'Cancel', value: null },
      { label: okLabel, primary: true, value: () => read(), validate },
    ],
    onOpen: () => {
      if (previewToggle && onChange) onChange(read());
    },
  });
}

export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', danger = false, extra = null }) {
  return openDialog({
    title,
    body: h('p.dialog-message', message),
    buttons: [...(extra ? [{ label: extra.label, value: extra.value, left: true }] : []), { label: cancelLabel, value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}

export function alertDialog({ title, message }) {
  return openDialog({ title, body: h('p.dialog-message', message), buttons: [{ label: 'OK', value: true, primary: true }] });
}

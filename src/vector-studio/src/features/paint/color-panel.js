/**
 * Color panel (F6): edits the focused paint (fill or stroke) of the
 * selection, or the current style when nothing is selected. Grayscale,
 * RGB, HSB, CMYK and Web Safe RGB sliders with ramps and numeric fields, a
 * hex field, a spectrum bar to click-pick, None / White / Black chips, an
 * out-of-web-color warning and Invert / Complement in the panel menu.
 * When the focused paint is a gradient, the panel edits the gradient stop
 * selected in the Gradient panel.
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { iconButton } from '../../ui/widgets.js';
import { applyStyle } from '../../ops/paint-ops.js';
import { isHex, normalizeHex, invert, complement, webSafe } from '../../lib/color.js';
import { MODES, MODE_IDS, spectrumColor, isWebSafe } from './color-modes.js';
import { colorSliders, miniFillStroke, focusedPaint, displayColor, setFocusedColor, gestureKey, paintState } from './ui-common.js';
import { isGradient } from '../../model/gradients.js';

export class ColorPanel extends Panel {
  static id = 'color';
  static title = 'Color';
  static icon = 'palette';
  static placement = 'strip';
  static shortcut = 'F6';

  build() {
    const app = this.app;
    this.mode = app.prefs.get('colorPanelMode') || 'rgb';
    this.coalesce = gestureKey('color');
    this.fs = miniFillStroke(app);
    this.sliders = colorSliders({
      mode: this.mode,
      label: 'Color',
      onStart: () => (this.coalesce = gestureKey('color')),
      onInput: (hex) => this.apply(hex),
    });
    this.modeSel = h(
      'select.select.cp-mode',
      { 'aria-label': 'Color mode', onchange: () => this.setMode(this.modeSel.value) },
      MODE_IDS.map((m) => h('option', { value: m, selected: m === this.mode }, MODES[m].label)),
    );
    this.hex = h('input.cp-hexfield', { type: 'text', spellcheck: false, autocomplete: 'off', maxlength: 7, 'aria-label': 'Hexadecimal color' });
    this.hex.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitHex();
        this.hex.select();
      }
    });
    this.hex.addEventListener('blur', () => this.commitHex());
    this.webWarn = iconButton('web-warning', 'Out of Web Color Warning: click to use the closest web color', () => {
      const ed = app.editor;
      if (!ed) return;
      this.coalesce = gestureKey('color');
      this.apply(webSafe(this.current));
    }, { className: 'small cp-web-warn' });
    this.menuBtn = iconButton('ellipsis', 'Color panel menu', (e) => this.openMenu(e.currentTarget), { className: 'small' });

    // Spectrum bar.
    this.spectrum = h('canvas.cp-spectrum', { width: 200, height: 40, role: 'img', 'aria-label': 'Color spectrum. Click or drag to pick a color.' });
    const pick = (e) => {
      const r = this.spectrum.getBoundingClientRect();
      const hex = spectrumColor((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      this.apply(hex);
    };
    this.spectrum.addEventListener('pointerdown', (e) => {
      if (!app.editor) return;
      this.coalesce = gestureKey('color');
      this.spectrum.setPointerCapture(e.pointerId);
      pick(e);
      const move = (ev) => pick(ev);
      const up = () => {
        this.spectrum.removeEventListener('pointermove', move);
        this.spectrum.removeEventListener('pointerup', up);
      };
      this.spectrum.addEventListener('pointermove', move);
      this.spectrum.addEventListener('pointerup', up);
    });
    const chip = (label, cls, onclick) => h(`button.cp-chip.${cls}`, { type: 'button', 'aria-label': label, 'data-tip': label, onclick });
    this.chips = h(
      'div.cp-chips',
      chip('None', 'none', () => {
        const ed = app.editor;
        if (!ed) return;
        applyStyle(ed, { [ed.focusPaint]: null }, 'None');
      }),
      chip('White', 'white', () => this.applySolid('#ffffff')),
      chip('Black', 'black', () => this.applySolid('#000000')),
    );
    this.stopNote = h('p.cp-note', { hidden: true });
    this.el.append(
      h('div.cp-top', this.fs.el, h('div.cp-right', h('div.cp-modebar', this.modeSel, this.menuBtn), this.sliders.el)),
      h('div.cp-hexrow', h('label.cp-hexlabel', '#'), this.hex, this.webWarn),
      this.stopNote,
      h('div.cp-specrow', this.chips, this.spectrum),
    );
    this.drawSpectrum();
    this.offStop = paintState.on('stop', () => this.visible && this.update());
  }

  drawSpectrum() {
    const c = this.spectrum;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width;
    const hgt = c.height;
    const img = ctx.createImageData(w, hgt);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const hex = spectrumColor(x / (w - 1), y / (hgt - 1));
        const n = parseInt(hex.slice(1), 16);
        const i = (y * w + x) * 4;
        img.data[i] = (n >> 16) & 255;
        img.data[i + 1] = (n >> 8) & 255;
        img.data[i + 2] = n & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  setMode(m) {
    this.mode = m;
    this.app.prefs.set('colorPanelMode', m);
    this.modeSel.value = m;
    this.sliders.setMode(m);
    this.update();
  }

  openMenu(anchor) {
    const items = [
      ...MODE_IDS.map((m) => ({ label: MODES[m].label, checked: this.mode === m, run: () => this.setMode(m) })),
      '-',
      { label: 'Invert', run: () => this.startAndApply(invert(this.current)) },
      { label: 'Complement', run: () => this.startAndApply(complement(this.current)) },
    ];
    this.app.showMenuAt(anchor, items, 'Color panel menu');
  }

  startAndApply(hex) {
    this.coalesce = gestureKey('color');
    this.apply(hex);
  }

  applySolid(hex) {
    const ed = this.app.editor;
    if (!ed) return;
    setFocusedColor(ed, hex, null, { forceSolid: !isGradient(focusedPaint(ed).paint) });
  }

  apply(hex) {
    const ed = this.app.editor;
    if (!ed) return;
    this.current = hex;
    setFocusedColor(ed, hex, this.coalesce);
  }

  commitHex() {
    const v = this.hex.value.trim();
    const s = v.startsWith('#') ? v : `#${v}`;
    if (!isHex(s)) {
      this.hex.value = (this.current || '#000000').slice(1).toUpperCase();
      return;
    }
    const hex = normalizeHex(s);
    if (hex === this.current) return;
    this.coalesce = gestureKey('color');
    this.apply(hex);
    this.sliders.setColor(hex);
  }

  update() {
    const ed = this.app.editor;
    this.el.classList.toggle('disabled', !ed);
    if (!ed) return;
    this.fs.refresh();
    const { key, paint } = focusedPaint(ed);
    const color = displayColor(ed, key, paint);
    this.current = color;
    const none = !paint;
    const mixed = paint === 'mixed';
    this.sliders.setColor(color);
    this.el.classList.toggle('is-none', none);
    if (document.activeElement !== this.hex) this.hex.value = mixed ? '' : color.slice(1).toUpperCase();
    this.hex.placeholder = mixed ? 'Mixed' : '';
    this.webWarn.hidden = isWebSafe(color) || mixed;
    const grad = paint && paint !== 'mixed' && isGradient(paint);
    this.stopNote.hidden = !grad;
    if (grad) this.stopNote.textContent = `Editing gradient stop ${Math.min(paintState.stop, paint.stops.length - 1) + 1} of ${paint.stops.length}`;
  }
}

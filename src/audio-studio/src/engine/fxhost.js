// Hosts WASM effect instances for one mixing context (the realtime worklet or
// an offline render). Effect chains in the graph are arrays of slot specs:
//   { key, kind, params: number[], enabled, mix, shadow?, readout?, route? }
// A `shadow` slot is switched off but still processed (output discarded).
// `key` is stable across graph updates so an effect keeps its state (reverb
// tails, compressor envelopes) while its parameters change. Slots with
// `readout` measure what passes through them (meters, detector levels);
// readouts() collects their latest values for the UI. A `route`
// ({ in: [l, r], out: [l, r] }, see src/effects/routing.js) picks which
// channels feed the effect and which channels receive its output.

const MAX_FRAMES = 8192;
const READOUT_MAX = 64;

export class FxHost {
  constructor(instance, rate) {
    this.x = instance.exports;
    this.rate = rate;
    this.buf = this.x.mem_alloc(2 * MAX_FRAMES * 4);
    this.slots = new Map(); // key -> { handle, kind, params }
  }

  get memory() {
    return this.x.memory.buffer;
  }

  /** Brings live instances in line with the slot specs; returns the resolved chain. */
  sync(specs) {
    const live = [];
    for (const spec of specs || []) {
      let s = this.slots.get(spec.key);
      if (s && s.kind !== spec.kind) {
        this.x.fx_free(s.handle);
        this.slots.delete(spec.key);
        s = null;
      }
      let created = false;
      if (!s) {
        const handle = this.x.fx_new(spec.kind, this.rate, 2);
        if (!handle) continue;
        s = { handle, kind: spec.kind, params: [], data: [], readout: false };
        this.slots.set(spec.key, s);
        created = true;
      }
      // Data blocks (curves, impulses, noise prints) go first so parameter
      // updates apply to the new data.
      for (const d of spec.data || []) {
        if (s.data[d.slot] !== d.id) {
          this.upload(s.handle, d.slot, d.values);
          s.data[d.slot] = d.id;
        }
      }
      const p = spec.params || [];
      for (let i = 0; i < p.length; i++) {
        if (s.params[i] !== p[i]) {
          this.x.fx_set(s.handle, i, p[i]);
          s.params[i] = p[i];
        }
      }
      // A new instance starts at its settings instead of gliding from defaults
      // (otherwise offline renders begin with a parameter ramp).
      if (created) this.x.fx_reset(s.handle);
      s.readout = Boolean(spec.readout);
      live.push({ handle: s.handle, enabled: spec.enabled !== false, shadow: Boolean(spec.shadow), mix: spec.mix ?? 1, key: spec.key, route: spec.route || null });
    }
    return live;
  }

  /** Copies a Float32Array into WASM memory for fx_data (the effect keeps its own copy). */
  upload(handle, slot, values) {
    const n = values?.length || 0;
    const bytes = Math.max(4, n * 4);
    const ptr = this.x.mem_alloc(bytes);
    if (!ptr) return;
    if (n) new Float32Array(this.memory, ptr, n).set(values);
    this.x.fx_data(handle, slot, ptr, n);
    this.x.mem_free(ptr, bytes);
  }

  /** Frees instances whose keys are not in `keep`. */
  prune(keep) {
    for (const [key, s] of this.slots) {
      if (!keep.has(key)) {
        this.x.fx_free(s.handle);
        this.slots.delete(key);
      }
    }
  }

  reset() {
    for (const s of this.slots.values()) this.x.fx_reset(s.handle);
  }

  /** Latest readings of every slot that reports them: [[key, Float32Array]]. */
  readouts() {
    const out = [];
    for (const [key, s] of this.slots) {
      if (!s.readout) continue;
      if (!this.readBuf) this.readBuf = this.x.mem_alloc(READOUT_MAX * 4);
      const n = this.x.fx_readout(s.handle, this.readBuf, READOUT_MAX);
      if (n) out.push([key, new Float32Array(this.memory, this.readBuf, n).slice()]);
    }
    return out;
  }

  /**
   * Processes one routed slot over the stereo block in WASM memory: the inputs
   * are picked from the dry channels, and each channel takes the chosen effect
   * output (or stays dry), blended by the slot's mix.
   */
  runRouted(slot, n) {
    const { in: ins, out } = slot.route;
    let heap = new Float32Array(this.memory, this.buf, 2 * n);
    const dry = heap.slice();
    for (let c = 0; c < 2; c++) {
      const s = ins[c];
      if (s === 0 || s === 1) heap.set(dry.subarray(s * n, s * n + n), c * n);
      else heap.fill(0, c * n, c * n + n);
    }
    this.x.fx_process(slot.handle, this.buf, n);
    heap = new Float32Array(this.memory, this.buf, 2 * n);
    const wet = heap.slice();
    const w = Math.min(1, Math.max(0, slot.mix));
    for (let c = 0; c < 2; c++) {
      const o = out[c];
      for (let i = 0; i < n; i++) {
        const d = dry[c * n + i];
        heap[c * n + i] = o === 0 || o === 1 ? d * (1 - w) + wet[o * n + i] * w : d;
      }
    }
  }

  /** Runs a resolved chain over stereo planar `buf` (Float32Array[2]) in place. */
  run(chain, buf, frames) {
    if (!chain.some((c) => c.enabled || c.shadow)) return;
    for (let at = 0; at < frames; at += MAX_FRAMES) {
      const n = Math.min(MAX_FRAMES, frames - at);
      let heap = new Float32Array(this.memory, this.buf, 2 * n);
      heap.set(buf[0].subarray(at, at + n), 0);
      heap.set(buf[1].subarray(at, at + n), n);
      for (const slot of chain) {
        if (!slot.enabled) {
          // A bypassed slot kept running: process a copy and throw the output away.
          if (slot.shadow) {
            heap = new Float32Array(this.memory, this.buf, 2 * n);
            const keep = heap.slice();
            this.x.fx_process(slot.handle, this.buf, n);
            new Float32Array(this.memory, this.buf, 2 * n).set(keep);
          }
          continue;
        }
        if (slot.route) {
          this.runRouted(slot, n);
        } else if (slot.mix >= 1) {
          this.x.fx_process(slot.handle, this.buf, n);
        } else {
          heap = new Float32Array(this.memory, this.buf, 2 * n);
          const dry = heap.slice();
          this.x.fx_process(slot.handle, this.buf, n);
          heap = new Float32Array(this.memory, this.buf, 2 * n);
          const w = slot.mix;
          for (let i = 0; i < 2 * n; i++) heap[i] = dry[i] * (1 - w) + heap[i] * w;
        }
      }
      // Memory may have grown during processing; re-read the view.
      heap = new Float32Array(this.memory, this.buf, 2 * n);
      buf[0].set(heap.subarray(0, n), at);
      buf[1].set(heap.subarray(n, 2 * n), at);
    }
  }
}

/** Collects every slot key used by a graph (tracks and master). */
export function graphFxKeys(graph) {
  const keys = new Set();
  for (const t of graph.tracks || []) {
    for (const s of t.fx || []) keys.add(s.key);
    for (const c of t.clips || []) for (const s of c.fx || []) keys.add(s.key);
  }
  for (const s of graph.master?.fx || []) keys.add(s.key);
  return keys;
}

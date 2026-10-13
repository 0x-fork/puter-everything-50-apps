// Dialog views for Noise Reduction / Restoration effects.

import { registerEditor } from '../editors.js';
import { responseEditor } from './common.js';

// DeHummer: the comb of hum notches, with a handle on the base notch
// (drag sideways for the hum frequency, down for depth; Alt+arrows or the
// wheel change Q).
const dehummer = responseEditor({
  label: 'Hum filter response',
  span: [-80, 6],
  step: 10,
  handles: (v) => [{ label: 'Base notch', freq: v.frequency, gain: v.gain, q: v.q, ids: { freq: 'frequency', gain: 'gain', q: 'q' } }],
});

registerEditor('dehummer', dehummer);

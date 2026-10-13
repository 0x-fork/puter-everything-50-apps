//! DeReverb: late-reverberation suppression. The late reverb power in each
//! bin is predicted from the smoothed power about 50 ms earlier, decayed at
//! the room's rate (a statistical reverb model after Lebart/Habets), and
//! subtracted as a spectral gain.
//!
//! Params: 0 amount %, 1 processing focus (0 all, 1 low, 2 mid, 3 high),
//! 2 output gain dB, 3 reverb decay (T60) ms.

use super::spectral::{fmax, bin_hz, fall_per_frame, fast_exp2, fast_log2, focus_weight, power, power_scale, smooth_bins};
use crate::fx::util::{db_to_gain, Stft};
use crate::fx::{Effect, Smooth};

pub const FFT: usize = 2048;
const OVERLAP: usize = 4;

pub struct DeReverb {
    rate: f32,
    amount: f32,
    focus: u32,
    t60: f32,
    gain: Smooth,
    stft: Stft,
    delay: usize,
    hist: Vec<Vec<f32>>, // per channel: delay frames x bins ring of smoothed power
    slot: usize,
    ps: Vec<Vec<f32>>,
    g: Vec<Vec<f32>>,
    p: Vec<f32>,
    t: Vec<f32>,
    t2: Vec<f32>,
    prefix: Vec<f64>,
    weight: Vec<f32>,
}

impl DeReverb {
    pub fn new(rate: f32, channels: usize) -> DeReverb {
        let bins = FFT / 2 + 1;
        let hop = FFT / OVERLAP;
        let delay = ((0.05 * rate / hop as f32).round() as usize).max(1);
        let mut d = DeReverb {
            rate,
            amount: 50.0,
            focus: 0,
            t60: 800.0,
            gain: Smooth::new(1.0, rate, 20.0),
            stft: Stft::new(FFT, OVERLAP, channels),
            delay,
            hist: vec![vec![0.0; delay * bins]; channels],
            slot: 0,
            ps: vec![vec![0.0; bins]; channels],
            g: vec![vec![1.0; bins]; channels],
            p: vec![0.0; bins],
            t: vec![0.0; bins],
            t2: vec![0.0; bins],
            prefix: vec![0.0; bins + 1],
            weight: vec![1.0; bins],
        };
        d.update();
        d
    }

    fn update(&mut self) {
        for k in 0..self.weight.len() {
            self.weight[k] = focus_weight(self.focus, bin_hz(k, FFT, self.rate));
        }
    }
}

impl Effect for DeReverb {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.amount = v.clamp(0.0, 100.0),
            1 => self.focus = v.round().clamp(0.0, 3.0) as u32,
            2 => self.gain.target = db_to_gain(v.clamp(-40.0, 40.0)),
            3 => self.t60 = v.clamp(100.0, 10000.0),
            _ => return,
        }
        self.update();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let bins = FFT / 2 + 1;
        let hop = FFT / OVERLAP;
        let scale = power_scale(FFT);
        let td = (self.delay * hop) as f32 / self.rate;
        let decay = 10f32.powf(-6.0 * td / (self.t60 * 0.001));
        let amount = self.amount * 0.01;
        let depth = amount.clamp(0.0, 1.0).sqrt();
        let floor = db_to_gain(-30.0 * amount);
        let fall = fall_per_frame(150.0, hop, self.rate);
        let delay = self.delay;
        let mut slot = self.slot;
        let (hist, ps, gs, p, t, t2, prefix, weight) = (&mut self.hist, &mut self.ps, &mut self.g, &mut self.p, &mut self.t, &mut self.t2, &mut self.prefix, &self.weight);
        self.stft.process(buf, frames, |re, im| {
            for c in 0..re.len() {
                power(&re[c], &im[c], p, scale);
                let h = &mut hist[c][slot * bins..(slot + 1) * bins];
                for k in 0..bins {
                    ps[c][k] = 0.6 * ps[c][k] + 0.4 * p[k];
                    // The oldest frame in the ring is `delay` frames back.
                    let late = decay * h[k];
                    h[k] = ps[c][k];
                    let ratio = late / fmax(ps[c][k], 1e-20);
                    let g = fmax(1.0 - ratio, floor);
                    // Amount and focus scale the reduction in dB.
                    t[k] = if g >= 1.0 { 1.0 } else { fmax(fast_exp2(depth * weight[k] * fast_log2(g)), floor) };
                }
                smooth_bins(t, t2, prefix, |_| 1);
                for k in 0..bins {
                    let target = t2[k];
                    let g = if target >= gs[c][k] { target } else { fmax(target, gs[c][k] * fall) };
                    gs[c][k] = g;
                    re[c][k] *= g;
                    im[c][k] *= g;
                }
            }
            slot = (slot + 1) % delay;
        });
        self.slot = slot;
        let start = self.gain.value;
        for c in 0..channels.min(buf.len() / frames.max(1)) {
            self.gain.value = start;
            for x in &mut buf[c * frames..(c + 1) * frames] {
                *x *= self.gain.next();
            }
        }
    }

    fn reset(&mut self) {
        self.stft.reset();
        for c in 0..self.hist.len() {
            self.hist[c].iter_mut().for_each(|v| *v = 0.0);
            self.ps[c].iter_mut().for_each(|v| *v = 0.0);
            self.g[c].iter_mut().for_each(|v| *v = 1.0);
        }
        self.gain.settle();
    }

    fn latency(&self) -> u32 {
        self.stft.latency() as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::Rng;

    #[test]
    fn shortens_reverb_tails_and_keeps_direct_sound() {
        let rate = 48000.0;
        let n = 4 * 48000;
        // Dry: short noise bursts every half second. Wet: dry convolved with a 1 s exponential noise tail.
        let mut dry = vec![0.0f32; n];
        let mut r = Rng(17);
        for i in 0..n {
            if i % 24000 < 2400 {
                dry[i] = 0.3 * r.bipolar();
            }
        }
        let ir_len = 48000;
        let mut ir = vec![0.0f32; ir_len];
        ir[0] = 1.0;
        for i in 1..ir_len {
            ir[i] = 0.08 * r.bipolar() * (-6.9 * i as f32 / rate).exp();
        }
        // Sparse convolution: the dry signal is zero most of the time.
        let mut wet = vec![0.0f32; n];
        for i in 0..n {
            if dry[i] != 0.0 {
                let d = dry[i];
                for j in 0..ir_len.min(n - i) {
                    wet[i + j] += d * ir[j];
                }
            }
        }
        let mut fx = make(133, rate, 1);
        fx.set_param(0, 100.0);
        fx.set_param(3, 1000.0);
        let lat = fx.latency() as usize;
        let y = run_mono(fx.as_mut(), &wet);
        // Tail region of the third burst vs the burst itself.
        let burst = 48000 + 200..48000 + 2200;
        let tail = 48000 + 6000..48000 + 20000;
        let tail_in = rms(&wet[tail.clone()]);
        let tail_out = rms(&y[tail.start + lat..tail.end + lat]);
        let burst_in = rms(&wet[burst.clone()]);
        let burst_out = rms(&y[burst.start + lat..burst.end + lat]);
        let tail_db = 20.0 * (tail_out / tail_in).log10();
        let burst_db = 20.0 * (burst_out / burst_in).log10();
        assert!(tail_db < burst_db - 6.0, "tail {tail_db} dB, burst {burst_db} dB");
        assert!(burst_db > -4.0, "burst {burst_db} dB");
    }
}

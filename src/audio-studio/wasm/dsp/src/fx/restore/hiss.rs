//! Hiss Reduction: spectral gating against a smooth, slowly tracked hiss
//! floor (minimum statistics over about two seconds, smoothed across
//! frequency so the threshold is a broadband curve rather than per-bin noise).
//!
//! Params: 0 noise floor dB (offset of the threshold curve), 1 reduce by dB,
//! 2 spectral decay rate %, 3 precision factor (1..20), 4 transition width dB,
//! 5 FFT size, 6 output hiss only (0/1).

use super::noise_reduction::fft_size;
use super::spectral::{fall_per_frame, power, power_scale, smooth_bins, GateCore, GateSettings, MinStats};
use crate::fx::util::Stft;
use crate::fx::Effect;

pub struct HissReduction {
    rate: f32,
    channels: usize,
    offset: f32,
    reduce_db: f32,
    decay: f32,
    precision: f32,
    width: f32,
    fft: usize,
    residual: bool,
    stft: Stft,
    gate: GateCore,
    stats: Vec<MinStats>,
    floor: Vec<Vec<f32>>,
    p: Vec<f32>,
    prefix: Vec<f64>,
}

impl HissReduction {
    pub fn new(rate: f32, channels: usize) -> HissReduction {
        let mut h = HissReduction {
            rate,
            channels,
            offset: 0.0,
            reduce_db: 18.0,
            decay: 60.0,
            precision: 7.0,
            width: 6.0,
            fft: 2048,
            residual: false,
            stft: Stft::new(256, 4, 1),
            gate: GateCore::new(1, 1),
            stats: Vec::new(),
            floor: Vec::new(),
            p: Vec::new(),
            prefix: Vec::new(),
        };
        h.rebuild();
        h
    }

    fn overlap(&self) -> usize {
        if self.precision >= 10.0 {
            8
        } else {
            4
        }
    }

    fn rebuild(&mut self) {
        let bins = self.fft / 2 + 1;
        let ov = self.overlap();
        self.stft = Stft::new(self.fft, ov, self.channels);
        self.gate = GateCore::new(bins, self.channels);
        let hop = self.fft / ov;
        let window = (2.0 * self.rate / hop as f32) as usize;
        self.stats = (0..self.channels).map(|_| MinStats::new(bins, window).warmup(ov)).collect();
        self.floor = vec![vec![0.0; bins]; self.channels];
        self.p = vec![0.0; bins];
        self.prefix = vec![0.0; bins + 1];
    }
}

impl Effect for HissReduction {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.offset = v.clamp(-40.0, 40.0),
            1 => self.reduce_db = v.clamp(0.0, 80.0),
            2 => self.decay = v.clamp(0.0, 100.0),
            3 => {
                let old = self.overlap();
                self.precision = v.clamp(1.0, 20.0);
                if self.overlap() != old {
                    self.rebuild();
                }
            }
            4 => self.width = v.clamp(0.0, 40.0),
            5 => {
                let n = fft_size(v);
                if n != self.fft {
                    self.fft = n;
                    self.rebuild();
                }
            }
            6 => self.residual = v >= 0.5,
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], _channels: usize, frames: usize) {
        let hop = self.fft / self.overlap();
        let s = GateSettings {
            threshold_db: 4.0 + self.offset,
            width_db: self.width,
            floor_db: -self.reduce_db,
            power_alpha: 1.0 - 1.0 / (1.0 + self.precision * 0.15),
            instant_rise: false,
            smooth_bins: 1,
            dilate_bins: 0,
            fall: fall_per_frame(self.decay * 6.0, hop, self.rate),
            residual: self.residual,
        };
        let scale = power_scale(self.fft);
        let (gate, stats, floor, p, prefix) = (&mut self.gate, &mut self.stats, &mut self.floor, &mut self.p, &mut self.prefix);
        self.stft.process(buf, frames, |re, im| {
            for c in 0..re.len() {
                power(&re[c], &im[c], p, scale);
                stats[c].update(p);
                // A broadband curve: wider smoothing higher up (about a sixth of an octave).
                smooth_bins(&stats[c].noise, &mut floor[c], prefix, |k| 2 + k / 12);
                gate.frame(c, &mut re[c], &mut im[c], &floor[c], scale, &s, |_| 1.0);
            }
        });
    }

    fn reset(&mut self) {
        self.stft.reset();
        self.gate.reset();
        for m in &mut self.stats {
            m.reset();
        }
    }

    fn latency(&self) -> u32 {
        self.stft.latency() as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn reduces_steady_hiss_and_keeps_tones() {
        let rate = 48000.0;
        let n = 4 * 48000;
        let hiss = noise(n, 0.02, 11);
        let tone = sine(800.0, rate, n, 0.3);
        // Tone gated on and off so the floor tracker sees hiss-only stretches.
        let x: Vec<f32> = (0..n).map(|i| hiss[i] + if (i / 24000) % 2 == 1 { tone[i] } else { 0.0 }).collect();
        let mut fx = make(131, rate, 1);
        fx.set_param(1, 30.0);
        let lat = fx.latency() as usize;
        let y = run_mono(fx.as_mut(), &x);
        // A hiss-only stretch after the tracker settled (frames 96000..120000 are tone-off).
        let a = 96000 + 4000;
        let b = 120000 - 2000;
        let red = rms(&y[a + lat..b + lat]) / rms(&hiss[a..b]);
        assert!(red < 0.25, "hiss reduced to {red}");
        // A tone-on stretch keeps the tone.
        let (a, b) = (120000 + 4000, 144000 - 2000);
        let dot: f32 = (a..b).map(|i| y[i + lat] * tone[i]).sum();
        let tt: f32 = (a..b).map(|i| tone[i] * tone[i]).sum();
        assert!((dot / tt - 1.0).abs() < 0.1, "tone gain {}", dot / tt);
    }
}

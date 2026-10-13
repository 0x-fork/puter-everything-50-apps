//! Automatic Phase Correction: aligns the right channel with the left (or
//! both towards each other) in the STFT domain. A smoothed cross spectrum
//! gives a GCC-PHAT estimate of the inter-channel delay (global time shift)
//! and, optionally, the residual phase difference of each band, which is
//! rotated away (useful for tape azimuth errors and misaligned microphones).
//!
//! Params: 0 global time shift (0/1), 1 auto align bands (0/1), 2 channel
//! (0 adjust left, 1 adjust right, 2 centre: split between both),
//! 3 time resolution ms (smoothing of the estimate), 4 analysis size (FFT).

use super::noise_reduction::fft_size;
use super::spectral::smooth_bins;
use crate::fft::RealFft;
use crate::fx::util::{Stft, TAU};
use crate::fx::Effect;

pub struct AutoPhaseCorrection {
    rate: f32,
    channels: usize,
    global: bool,
    bands: bool,
    mode: u32,
    resolution_ms: f32,
    fft: usize,
    stft: Stft,
    ifft: RealFft,
    cs_re: Vec<f32>,
    cs_im: Vec<f32>,
    t_re: Vec<f32>,
    t_im: Vec<f32>,
    sm_re: Vec<f32>,
    sm_im: Vec<f32>,
    corr: Vec<f32>,
    prefix: Vec<f64>,
    lag: f32,
}

impl AutoPhaseCorrection {
    pub fn new(rate: f32, channels: usize) -> AutoPhaseCorrection {
        let mut a = AutoPhaseCorrection {
            rate,
            channels,
            global: true,
            bands: false,
            mode: 2,
            resolution_ms: 300.0,
            fft: 2048,
            stft: Stft::new(256, 4, 1),
            ifft: RealFft::new(256),
            cs_re: Vec::new(),
            cs_im: Vec::new(),
            t_re: Vec::new(),
            t_im: Vec::new(),
            sm_re: Vec::new(),
            sm_im: Vec::new(),
            corr: Vec::new(),
            prefix: Vec::new(),
            lag: 0.0,
        };
        a.rebuild();
        a
    }

    fn rebuild(&mut self) {
        let bins = self.fft / 2 + 1;
        self.stft = Stft::new(self.fft, 4, self.channels);
        self.ifft = RealFft::new(self.fft);
        self.cs_re = vec![0.0; bins];
        self.cs_im = vec![0.0; bins];
        self.t_re = vec![0.0; bins];
        self.t_im = vec![0.0; bins];
        self.sm_re = vec![0.0; bins];
        self.sm_im = vec![0.0; bins];
        self.corr = vec![0.0; self.fft];
        self.prefix = vec![0.0; bins + 1];
        self.lag = 0.0;
    }

    /// The current delay estimate in samples (positive: right lags left).
    #[cfg(test)]
    pub fn lag(&self) -> f32 {
        self.lag
    }
}

/// Multiplies (re, im) by (c, s).
#[inline]
fn mul(re: &mut f32, im: &mut f32, c: f32, s: f32) {
    let (r, i) = (*re, *im);
    *re = r * c - i * s;
    *im = r * s + i * c;
}

impl Effect for AutoPhaseCorrection {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.global = v >= 0.5,
            1 => self.bands = v >= 0.5,
            2 => self.mode = v.round().clamp(0.0, 2.0) as u32,
            3 => self.resolution_ms = v.clamp(10.0, 5000.0),
            4 => {
                let n = fft_size(v).clamp(512, 8192);
                if n != self.fft {
                    self.fft = n;
                    self.rebuild();
                }
            }
            _ => {}
        }
    }

    fn process(&mut self, buf: &mut [f32], _channels: usize, frames: usize) {
        let n = self.fft;
        let bins = n / 2 + 1;
        let hop = n / 4;
        let a = (-(hop as f32) / (self.resolution_ms * 0.001 * self.rate)).exp();
        let max_lag = n / 8;
        let (global, bands, mode) = (self.global, self.bands, self.mode);
        let (cs_re, cs_im, t_re, t_im, corr, prefix, ifft) = (&mut self.cs_re, &mut self.cs_im, &mut self.t_re, &mut self.t_im, &mut self.corr, &mut self.prefix, &mut self.ifft);
        let (sm_re, sm_im) = (&mut self.sm_re, &mut self.sm_im);
        let lag = &mut self.lag;
        self.stft.process(buf, frames, |re, im| {
            if re.len() < 2 || !(global || bands) {
                return;
            }
            for k in 0..bins {
                // L * conj(R)
                let cr = re[0][k] * re[1][k] + im[0][k] * im[1][k];
                let ci = im[0][k] * re[1][k] - re[0][k] * im[1][k];
                cs_re[k] = a * cs_re[k] + (1.0 - a) * cr;
                cs_im[k] = a * cs_im[k] + (1.0 - a) * ci;
            }
            let w = TAU / n as f32;
            if global {
                // GCC-PHAT: whitened cross spectrum back to the lag domain.
                for k in 0..bins {
                    let m = (cs_re[k] * cs_re[k] + cs_im[k] * cs_im[k]).sqrt().max(1e-20);
                    t_re[k] = cs_re[k] / m;
                    t_im[k] = cs_im[k] / m;
                }
                ifft.inverse(t_re, t_im, corr);
                let mut best = 0usize;
                let mut bv = f32::MIN;
                for i in (0..=max_lag).chain(n - max_lag..n) {
                    if corr[i] > bv {
                        bv = corr[i];
                        best = i;
                    }
                }
                // Parabolic refinement around the peak.
                let ym = corr[(best + n - 1) % n];
                let yp = corr[(best + 1) % n];
                let den = ym - 2.0 * bv + yp;
                let frac = if den.abs() > 1e-12 { (0.5 * (ym - yp) / den).clamp(-0.5, 0.5) } else { 0.0 };
                // A peak at index m means the right channel leads by m, so the lag is -m.
                let d = -(if best > n / 2 { best as f32 - n as f32 } else { best as f32 } + frac);
                if bv > 0.0 {
                    *lag = a * *lag + (1.0 - a) * d;
                }
            }
            let tau = if global { *lag } else { 0.0 };
            // Per-bin rotations by w k tau come from phasor recurrences (no trig per bin).
            let (ss, sc) = ((w * tau) as f64).sin_cos();
            let (hs, hc) = ((0.5 * w * tau) as f64).sin_cos();
            if bands {
                // Residual phase of each band once the time shift is removed.
                let (mut pr, mut pi) = (1.0f64, 0.0f64);
                for k in 0..bins {
                    let (cr, ci) = (cs_re[k] as f64, cs_im[k] as f64);
                    t_re[k] = (cr * pr + ci * pi) as f32;
                    t_im[k] = (ci * pr - cr * pi) as f32;
                    let npr = pr * sc - pi * ss;
                    pi = pr * ss + pi * sc;
                    pr = npr;
                }
                smooth_bins(t_re, sm_re, prefix, |_| 3);
                smooth_bins(t_im, sm_im, prefix, |_| 3);
            }
            let (mut pr, mut pi) = (1.0f64, 0.0f64);
            let (mut qr, mut qi) = (1.0f64, 0.0f64);
            for k in 0..bins {
                let (mut ur, mut ui) = (1.0f32, 0.0f32);
                if bands {
                    let m = (sm_re[k] * sm_re[k] + sm_im[k] * sm_im[k]).sqrt();
                    if m > 1e-20 {
                        ur = sm_re[k] / m;
                        ui = sm_im[k] / m;
                    }
                }
                let (zr, zi) = match mode {
                    0 | 1 => ((pr as f32) * ur - (pi as f32) * ui, (pr as f32) * ui + (pi as f32) * ur),
                    _ => {
                        // Half of the residual angle (principal value), times the half shift.
                        let hr = ((1.0 + ur) * 0.5).max(0.0).sqrt();
                        let hi = ((1.0 - ur) * 0.5).max(0.0).sqrt() * if ui < 0.0 { -1.0 } else { 1.0 };
                        ((qr as f32) * hr - (qi as f32) * hi, (qr as f32) * hi + (qi as f32) * hr)
                    }
                };
                match mode {
                    0 => mul(&mut re[0][k], &mut im[0][k], zr, -zi),
                    1 => mul(&mut re[1][k], &mut im[1][k], zr, zi),
                    _ => {
                        mul(&mut re[0][k], &mut im[0][k], zr, -zi);
                        mul(&mut re[1][k], &mut im[1][k], zr, zi);
                    }
                }
                let npr = pr * sc - pi * ss;
                pi = pr * ss + pi * sc;
                pr = npr;
                let nqr = qr * hc - qi * hs;
                qi = qr * hs + qi * hc;
                qr = nqr;
            }
        });
    }

    fn reset(&mut self) {
        self.stft.reset();
        self.cs_re.iter_mut().for_each(|v| *v = 0.0);
        self.cs_im.iter_mut().for_each(|v| *v = 0.0);
        self.lag = 0.0;
    }

    fn latency(&self) -> u32 {
        self.stft.latency() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fx::testutil::*;

    fn corr0(a: &[f32], b: &[f32]) -> f32 {
        let ab: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let aa: f32 = a.iter().map(|x| x * x).sum();
        let bb: f32 = b.iter().map(|x| x * x).sum();
        ab / (aa * bb).sqrt()
    }

    #[test]
    fn aligns_a_delayed_channel() {
        let rate = 48000.0;
        let n = 96000;
        let src = noise(n + 64, 0.3, 12);
        let l: Vec<f32> = src[64..].to_vec();
        let r: Vec<f32> = src[64 - 9..n + 64 - 9].to_vec(); // right lags left by 9 samples
        assert!(corr0(&l, &r) < 0.2);
        let mut fx = AutoPhaseCorrection::new(rate, 2);
        fx.set_param(3, 100.0);
        let (ol, or) = run_stereo(&mut fx, &l, &r);
        assert!((fx.lag() - 9.0).abs() < 0.5, "lag {}", fx.lag());
        let c = corr0(&ol[60000..], &or[60000..]);
        assert!(c > 0.9, "aligned correlation {c}");
        // Mono passes through, delayed.
        let mut fx = AutoPhaseCorrection::new(rate, 1);
        let lat = fx.latency() as usize;
        let y = run_mono(&mut fx, &l[..20000]);
        for i in lat..20000 {
            assert!((y[i] - l[i - lat]).abs() < 1e-3);
        }
    }
}

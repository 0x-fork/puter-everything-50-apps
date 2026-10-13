//! Distortion: drive into a 4x oversampled waveshaper with separate curves
//! for positive and negative half waves, curve and time smoothing, a DC
//! blocker, an optional post filter, dry/wet and output gain.
//!
//! Params: 0 drive dB, 1 positive curve, 2 negative curve, 3 symmetric (0/1),
//! 4 curve smoothing %, 5 time smoothing %, 6 post filter on (0/1),
//! 7 filter type (0 low pass, 1 high pass, 2 band pass), 8 filter Hz,
//! 9 filter Q, 10 mix %, 11 output dB.
//! Latency: `Oversampler::latency(4)` frames (the dry path is aligned).

use super::shaper::{Oversampler, Shape, Shaper, SOFT};
use crate::fx::util::{db_to_gain, Biquad, Coefs, DelayLine};
use crate::fx::{Effect, Smooth};

pub const FACTOR: usize = 4;
const SUB: usize = 32;

/// Time smoothing % to a gain smoothing coefficient at the oversampled rate.
pub fn time_coef(pct: f32, os_rate: f32) -> f32 {
    if pct <= 0.0 {
        return 0.0;
    }
    let ms = 0.02 * 2500f32.powf(pct.min(100.0) / 100.0);
    (-1.0 / (os_rate * ms * 0.001)).exp()
}

/// Post filter with smoothed frequency (coefficients refreshed per sub-block).
pub struct PostFilter {
    pub on: bool,
    pub kind: u32,
    pub q: f32,
    freq: Smooth,
    rate: f32,
    filters: [Biquad; 2],
    dirty: bool,
}

impl PostFilter {
    pub fn new(rate: f32, freq: f32) -> PostFilter {
        PostFilter { on: false, kind: 0, q: 0.707, freq: Smooth::new(freq.ln(), rate / SUB as f32, 30.0), rate, filters: [Biquad::default(); 2], dirty: true }
    }
    pub fn set_freq(&mut self, f: f32) {
        self.freq.target = f.clamp(10.0, self.rate * 0.49).ln();
        self.dirty = true;
    }
    pub fn touch(&mut self) {
        self.dirty = true;
    }
    pub fn jump(&mut self) {
        self.freq.settle();
        self.dirty = true;
    }
    /// Call once per sub-block before filtering.
    pub fn update(&mut self) {
        if !self.dirty && self.freq.settled() {
            return;
        }
        let settled_before = self.freq.settled();
        let f = self.freq.next().exp();
        let c = match self.kind {
            1 => Coefs::highpass(self.rate, f, self.q),
            2 => Coefs::bandpass(self.rate, f, self.q),
            _ => Coefs::lowpass(self.rate, f, self.q),
        };
        for b in &mut self.filters {
            b.c = c;
        }
        self.dirty = !settled_before;
    }
    #[inline]
    pub fn process(&mut self, c: usize, x: f32) -> f32 {
        if self.on {
            self.filters[c].process(x)
        } else {
            x
        }
    }
    pub fn flush(&mut self) {
        for b in &mut self.filters {
            b.flush();
        }
    }
    pub fn reset(&mut self) {
        for b in &mut self.filters {
            b.reset();
        }
        self.jump();
    }
}

pub struct Distortion {
    rate: f32,
    channels: usize,
    shapers: Vec<Shaper>,
    dry: Vec<DelayLine>,
    dc: [Biquad; 2],
    shape: Shape,
    pos: u32,
    neg: u32,
    symmetric: bool,
    drive: Smooth,
    mix: Smooth,
    out: Smooth,
    filter: PostFilter,
}

impl Distortion {
    pub fn new(rate: f32, channels: usize) -> Distortion {
        let lat = Oversampler::latency(FACTOR);
        let mut d = Distortion {
            rate,
            channels,
            shapers: (0..channels).map(|_| Shaper::new(FACTOR)).collect(),
            dry: (0..channels).map(|_| DelayLine::new(lat + 1)).collect(),
            dc: [Biquad::new(Coefs::highpass1(rate, 8.0)); 2],
            shape: Shape::default(),
            pos: SOFT,
            neg: SOFT,
            symmetric: true,
            drive: Smooth::new(db_to_gain(12.0), rate, 20.0),
            mix: Smooth::new(1.0, rate, 20.0),
            out: Smooth::new(1.0, rate, 20.0),
            filter: PostFilter::new(rate, 8000.0),
        };
        d.update_shape();
        d
    }

    fn update_shape(&mut self) {
        self.shape.pos = self.pos;
        self.shape.neg = if self.symmetric { self.pos } else { self.neg };
    }
}

impl Effect for Distortion {
    fn set_param(&mut self, idx: u32, v: f32) {
        match idx {
            0 => self.drive.target = db_to_gain(v.clamp(0.0, 60.0)),
            1 => self.pos = v as u32,
            2 => self.neg = v as u32,
            3 => self.symmetric = v >= 0.5,
            4 => self.shape.smooth = (v / 100.0).clamp(0.0, 1.0),
            5 => self.shape.time_coef = time_coef(v, self.rate * FACTOR as f32),
            6 => self.filter.on = v >= 0.5,
            7 => {
                self.filter.kind = v as u32;
                self.filter.touch();
            }
            8 => self.filter.set_freq(v),
            9 => {
                self.filter.q = v.clamp(0.1, 20.0);
                self.filter.touch();
            }
            10 => self.mix.target = (v / 100.0).clamp(0.0, 1.0),
            11 => self.out.target = db_to_gain(v),
            _ => {}
        }
        self.update_shape();
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        let channels = channels.min(self.channels);
        let lat = Oversampler::latency(FACTOR);
        let (mut drive, mut mix, mut out, mut tmp) = ([0.0f32; SUB], [0.0f32; SUB], [0.0f32; SUB], [0.0f32; SUB]);
        let mut at = 0;
        while at < frames {
            let n = SUB.min(frames - at);
            self.filter.update();
            for k in 0..n {
                drive[k] = self.drive.next();
                mix[k] = self.mix.next();
                out[k] = self.out.next();
            }
            for c in 0..channels {
                let io = &mut buf[c * frames + at..c * frames + at + n];
                for k in 0..n {
                    tmp[k] = io[k] * drive[k];
                }
                self.shapers[c].process(&mut tmp[..n], &self.shape);
                let d = &mut self.dry[c];
                for k in 0..n {
                    d.push(io[k]);
                    let dry = d.tap(lat);
                    let y = self.filter.process(c, self.dc[c].process(tmp[k]));
                    io[k] = (dry + (y - dry) * mix[k]) * out[k];
                }
            }
            at += n;
        }
        for b in &mut self.dc {
            b.flush();
        }
        self.filter.flush();
    }

    fn reset(&mut self) {
        for s in &mut self.shapers {
            s.reset();
        }
        for d in &mut self.dry {
            d.clear();
        }
        for b in &mut self.dc {
            b.reset();
        }
        self.filter.reset();
        self.drive.settle();
        self.mix.settle();
        self.out.settle();
    }

    fn latency(&self) -> u32 {
        Oversampler::latency(FACTOR) as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;
    use crate::fx::util::gain_to_db;

    #[test]
    fn clean_curve_at_zero_drive_is_transparent() {
        let rate = 48000.0;
        let mut fx = make(90, rate, 2);
        fx.set_param(0, 0.0);
        fx.set_param(1, 0.0); // linear
        fx.reset();
        let x = sine(440.0, rate, 9600, 0.5);
        let (y, _) = run_stereo(fx.as_mut(), &x, &x);
        let lat = fx.latency() as usize;
        // Only the 8 Hz DC blocker's small phase shift remains.
        for i in 2000..9600 {
            assert!((y[i] - x[i - lat]).abs() < 1.5e-2);
        }
    }

    #[test]
    fn hard_clip_limits_peaks_and_adds_harmonics() {
        let rate = 48000.0;
        let mut fx = make(90, rate, 1);
        fx.set_param(0, 24.0);
        fx.set_param(1, 2.0); // hard
        fx.reset();
        let x = sine(200.0, rate, 24000, 0.5);
        let y = run_mono(fx.as_mut(), &x);
        let p = peak(&y[4000..]);
        assert!(p < 1.15 && p > 0.85, "peak {p}");
        // A clipped sine is close to a square: RMS near its peak.
        assert!(rms(&y[4000..]) > 0.8 * p);
    }

    #[test]
    fn asymmetric_cut_rectifies() {
        let rate = 48000.0;
        let mut fx = make(90, rate, 1);
        fx.set_param(0, 0.0);
        fx.set_param(1, 0.0); // linear positive
        fx.set_param(2, 6.0); // cut negative
        fx.set_param(3, 0.0);
        fx.reset();
        let x = sine(1000.0, rate, 48000, 0.5);
        let y = run_mono(fx.as_mut(), &x);
        // Half-wave rectified then DC blocked: the negative excursion is
        // much smaller than the positive one.
        let tail = &y[24000..];
        let maxv = tail.iter().cloned().fold(f32::MIN, f32::max);
        let minv = tail.iter().cloned().fold(f32::MAX, f32::min);
        assert!(maxv > 2.0 * -minv, "max {maxv} min {minv}");
    }

    #[test]
    fn post_filter_and_mix() {
        let rate = 48000.0;
        let db = sine_gain_db(90, &[(0, 0.0), (1, 0.0), (6, 1.0), (7, 0.0), (8, 500.0)], 5000.0, rate);
        assert!(db < -30.0, "{db}");
        // Mix 0 is dry.
        let db = sine_gain_db(90, &[(0, 30.0), (1, 2.0), (10, 0.0)], 1000.0, rate);
        assert!(db.abs() < 0.1, "{db}");
        assert!(gain_to_db(1.0).abs() < 1e-6);
    }
}

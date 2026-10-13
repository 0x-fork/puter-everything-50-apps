//! Delay: an independent delay per channel with a wet/dry mix and polarity
//! inversion. Params: 0 left delay ms, 1 left mix %, 2 left invert,
//! 3 right delay ms, 4 right mix %, 5 right invert. Delay time changes glide
//! (no clicks); mono uses the left settings.

use crate::fx::util::DelayLine;
use crate::fx::{Effect, Smooth};

pub const MAX_MS: f32 = 2000.0;

pub struct Delay {
    rate: f32,
    lines: Vec<DelayLine>,
    time: [Smooth; 2],
    mix: [Smooth; 2],
    ms: [f32; 2],
    invert: [bool; 2],
    fresh: bool,
}

impl Delay {
    pub fn new(rate: f32, channels: usize) -> Delay {
        let max = (MAX_MS * 0.001 * rate) as usize + 4;
        let t = 0.25 * rate;
        Delay {
            rate,
            lines: (0..channels).map(|_| DelayLine::new(max)).collect(),
            time: [Smooth::new(t, rate, 60.0), Smooth::new(t, rate, 60.0)],
            mix: [Smooth::new(0.5, rate, 20.0), Smooth::new(0.5, rate, 20.0)],
            ms: [250.0; 2],
            invert: [false; 2],
            fresh: true,
        }
    }
}

impl Effect for Delay {
    fn set_param(&mut self, idx: u32, v: f32) {
        let c = (idx / 3) as usize;
        if c > 1 {
            return;
        }
        match idx % 3 {
            0 => {
                self.ms[c] = v.clamp(0.0, MAX_MS);
                self.time[c].target = self.ms[c] * self.rate / 1000.0;
            }
            1 => self.mix[c].target = (v * 0.01).clamp(0.0, 1.0),
            _ => self.invert[c] = v >= 0.5,
        }
    }

    fn process(&mut self, buf: &mut [f32], channels: usize, frames: usize) {
        if self.fresh {
            self.fresh = false;
            self.time.iter_mut().chain(self.mix.iter_mut()).for_each(|s| s.settle());
        }
        for c in 0..channels.min(self.lines.len()) {
            let sign = if self.invert[c] { -1.0 } else { 1.0 };
            let line = &mut self.lines[c];
            let (time, mix) = (&mut self.time[c], &mut self.mix[c]);
            for x in &mut buf[c * frames..(c + 1) * frames] {
                line.push(*x);
                let wet = line.tap_linear(time.next()) * sign;
                let m = mix.next();
                *x = *x * (1.0 - m) + wet * m;
            }
        }
    }

    fn reset(&mut self) {
        self.lines.iter_mut().for_each(|l| l.clear());
        self.time.iter_mut().chain(self.mix.iter_mut()).for_each(|s| s.settle());
    }

    fn tail(&self) -> u32 {
        let ms = self.ms[0].max(self.ms[1]) as f64;
        (ms * 0.001 * self.rate as f64).round() as u32
    }
}

#[cfg(test)]
mod tests {
    use crate::fx::testutil::*;

    #[test]
    fn delays_each_channel_independently() {
        let rate = 48000.0;
        let mut fx = make(60, rate, 2);
        for (i, v) in [(0, 10.0), (1, 100.0), (2, 0.0), (3, 20.0), (4, 100.0), (5, 1.0)] {
            fx.set_param(i, v);
        }
        let mut l = vec![0.0; 4800];
        l[0] = 1.0;
        let r = l.clone();
        let (ol, or) = run_stereo(fx.as_mut(), &l, &r);
        assert!((ol[480] - 1.0).abs() < 1e-5, "{}", ol[480]);
        assert!((or[960] + 1.0).abs() < 1e-5, "{}", or[960]);
        assert!(ol[0].abs() < 1e-6);
        assert_eq!(fx.tail(), 960);
    }

    #[test]
    fn half_mix_keeps_dry() {
        let mut fx = make(60, 48000.0, 1);
        fx.set_param(0, 5.0);
        fx.set_param(1, 50.0);
        let mut x = vec![0.0; 1000];
        x[0] = 1.0;
        let y = run_mono(fx.as_mut(), &x);
        assert!((y[0] - 0.5).abs() < 1e-5);
        assert!((y[240] - 0.5).abs() < 1e-5);
    }
}

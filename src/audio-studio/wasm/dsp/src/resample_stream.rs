//! Streaming band-limited sample-rate conversion for exports and recording.
//! Same Kaiser-windowed sinc as resample.rs, but polyphase: the kernels for
//! every output phase are computed once (exactly when the rate ratio has a
//! short period, as all common rates do; otherwise from a finely sampled
//! table with linear interpolation), and input arrives in blocks of any size.

use crate::{slice, slice_mut};

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let y = x * x / 4.0;
    for k in 1..50 {
        term *= y / (k as f64 * k as f64);
        sum += term;
        if term < 1e-12 * sum {
            break;
        }
    }
    sum
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

const TABLE_PHASES: usize = 1024;
const MAX_EXACT_PHASES: u64 = 4096;

pub struct Stream {
    from: u64,
    to: u64,
    half: usize,
    taps: usize,
    /// Exact phases: `phases` kernels of `taps` each, phase = (j * from mod to) / g.
    exact: bool,
    g: u64,
    phases: usize,
    table: Vec<f32>,
    /// Pending input; buf[0] is input index `base` (negative at the start: zero history).
    buf: Vec<f32>,
    base: i64,
    /// Next output index.
    j: u64,
}

impl Stream {
    pub fn new(from: u32, to: u32) -> Stream {
        let from = from.max(1) as u64;
        let to = to.max(1) as u64;
        let ratio = to as f64 / from as f64;
        // Equal rates use a full-band kernel, which is a unit impulse: samples pass through.
        let cutoff = if from == to { 1.0 } else { ratio.min(1.0) * 0.97 };
        // Widen the kernel when downsampling so the filter keeps its shape.
        let half = ((32.0 / ratio.min(1.0)).ceil() as usize).min(256);
        let taps = 2 * half;
        let g = gcd(from, to);
        let period = to / g;
        let exact = period <= MAX_EXACT_PHASES;
        let phases = if exact { period as usize } else { TABLE_PHASES + 1 };
        let beta = 8.6;
        let i0b = bessel_i0(beta);
        let mut table = vec![0.0f32; phases * taps];
        let mut kernel = vec![0.0f64; taps];
        for p in 0..phases {
            let frac = if exact { (p as u64 * g) as f64 / to as f64 } else { p as f64 / TABLE_PHASES as f64 };
            let mut wsum = 0.0;
            for (k, w) in kernel.iter_mut().enumerate() {
                // Tap k reads input centre + k - half + 1.
                let t = (k as f64 - half as f64 + 1.0) - frac;
                let x = t / half as f64;
                *w = if x.abs() >= 1.0 {
                    0.0
                } else {
                    let win = bessel_i0(beta * (1.0 - x * x).sqrt()) / i0b;
                    let arg = std::f64::consts::PI * t * cutoff;
                    let sinc = if arg.abs() < 1e-9 { 1.0 } else { arg.sin() / arg };
                    cutoff * sinc * win
                };
                wsum += *w;
            }
            for (k, &w) in kernel.iter().enumerate() {
                table[p * taps + k] = if wsum.abs() > 1e-12 { (w / wsum) as f32 } else { 0.0 };
            }
        }
        Stream { from, to, half, taps, exact, g, phases, table, buf: vec![0.0; half], base: -(half as i64), j: 0 }
    }

    /// Appends input and writes as many outputs as are complete. Returns the count written.
    pub fn process(&mut self, input: &[f32], out: &mut [f32]) -> usize {
        self.buf.extend_from_slice(input);
        let mut n = 0;
        let avail_end = self.base + self.buf.len() as i64; // exclusive
        while n < out.len() {
            let num = self.j * self.from;
            let centre = (num / self.to) as i64;
            let last = centre + self.half as i64; // highest input index read
            if last >= avail_end {
                break;
            }
            let first = (centre - self.half as i64 + 1 - self.base) as usize;
            let src = &self.buf[first..first + self.taps];
            let acc = if self.exact {
                let p = ((num % self.to) / self.g) as usize;
                dot(src, &self.table[p * self.taps..(p + 1) * self.taps])
            } else {
                let pos = (num % self.to) as f64 / self.to as f64 * TABLE_PHASES as f64;
                let p = (pos as usize).min(TABLE_PHASES - 1);
                let f = (pos - p as f64) as f32;
                let a = dot(src, &self.table[p * self.taps..(p + 1) * self.taps]);
                let b = dot(src, &self.table[(p + 1) * self.taps..(p + 2) * self.taps]);
                a + (b - a) * f
            };
            out[n] = acc;
            n += 1;
            self.j += 1;
        }
        // Drop input that no future output reads.
        let next_first = ((self.j * self.from) / self.to) as i64 - self.half as i64 + 1;
        let drop = (next_first - self.base).max(0) as usize;
        if drop > 0 {
            let drop = drop.min(self.buf.len());
            self.buf.drain(..drop);
            self.base += drop as i64;
        }
        let _ = self.phases;
        n
    }

    /// Feeds trailing silence so the last outputs that depend on real input are produced.
    pub fn flush(&mut self, out: &mut [f32]) -> usize {
        let zeros = vec![0.0f32; self.half + 1];
        self.process(&zeros, out)
    }
}

#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut s = [0.0f32; 4];
    let n = a.len() / 4 * 4;
    let mut i = 0;
    while i < n {
        s[0] += a[i] * b[i];
        s[1] += a[i + 1] * b[i + 1];
        s[2] += a[i + 2] * b[i + 2];
        s[3] += a[i + 3] * b[i + 3];
        i += 4;
    }
    let mut t = s[0] + s[1] + s[2] + s[3];
    while i < a.len() {
        t += a[i] * b[i];
        i += 1;
    }
    t
}

#[no_mangle]
pub extern "C" fn rs_new(from: u32, to: u32) -> u32 {
    Box::into_raw(Box::new(Stream::new(from, to))) as u32
}

#[no_mangle]
pub extern "C" fn rs_process(h: u32, src: u32, n: u32, out: u32, cap: u32) -> u32 {
    let s = unsafe { &mut *(h as *mut Stream) };
    unsafe { s.process(slice(src, n), slice_mut(out, cap)) as u32 }
}

#[no_mangle]
pub extern "C" fn rs_flush(h: u32, out: u32, cap: u32) -> u32 {
    let s = unsafe { &mut *(h as *mut Stream) };
    unsafe { s.flush(slice_mut(out, cap)) as u32 }
}

#[no_mangle]
pub extern "C" fn rs_free(h: u32) {
    if h != 0 {
        unsafe { drop(Box::from_raw(h as *mut Stream)) }
    }
}

#[cfg(test)]
mod tests {
    use super::Stream;

    fn run(input: &[f32], from: u32, to: u32, block: usize) -> Vec<f32> {
        let mut s = Stream::new(from, to);
        let mut out = Vec::new();
        let mut buf = vec![0.0; block * 8 + 64];
        for chunk in input.chunks(block) {
            let n = s.process(chunk, &mut buf);
            out.extend_from_slice(&buf[..n]);
        }
        let n = s.flush(&mut buf);
        out.extend_from_slice(&buf[..n]);
        out
    }

    #[test]
    fn matches_a_tone_for_common_rates() {
        for (from, to) in [(44100u32, 48000u32), (48000, 44100), (96000, 44100), (44100, 44100), (22050, 48000), (48000, 8000), (44100, 47999)] {
            let f = 441.0;
            let n = from as usize / 5;
            let input: Vec<f32> = (0..n).map(|i| (2.0 * std::f64::consts::PI * f * i as f64 / from as f64).sin() as f32).collect();
            let out = run(&input, from, to, 1000);
            let expect = (n as u64 * to as u64 / from as u64) as usize;
            assert!(out.len() >= expect, "{from}->{to}: {} < {expect}", out.len());
            for j in 300..expect - 300 {
                let want = (2.0 * std::f64::consts::PI * f * j as f64 / to as f64).sin() as f32;
                assert!((out[j] - want).abs() < 0.01, "{from}->{to} at {j}: {} vs {want}", out[j]);
            }
        }
    }

    #[test]
    fn block_size_does_not_change_the_result() {
        let input: Vec<f32> = (0..20000).map(|i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5).collect();
        let a = run(&input, 44100, 48000, 37);
        let b = run(&input, 44100, 48000, 4096);
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-6);
        }
    }

    #[test]
    fn identity_rate_passes_samples_through() {
        let input: Vec<f32> = (0..5000).map(|i| ((i * 31) % 97) as f32 / 97.0 - 0.5).collect();
        let out = run(&input, 48000, 48000, 512);
        for i in 0..input.len() {
            assert!((out[i] - input[i]).abs() < 1e-4, "{i}");
        }
    }
}

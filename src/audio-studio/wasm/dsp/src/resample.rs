//! Band-limited sample-rate conversion with a Kaiser-windowed sinc kernel.

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

/// Converts `input` at `from` Hz into `output` at `to` Hz. `output.len()` decides
/// how many samples are produced; reads past the input are treated as silence.
pub fn resample(input: &[f32], from: f64, to: f64, output: &mut [f32]) {
    const HALF: i64 = 32;
    const BETA: f64 = 8.6;
    let ratio = to / from;
    let cutoff = ratio.min(1.0) * 0.97;
    let i0b = bessel_i0(BETA);
    let step = from / to;
    for (j, out) in output.iter_mut().enumerate() {
        let pos = j as f64 * step;
        let centre = pos.floor() as i64;
        let frac = pos - centre as f64;
        let mut acc = 0.0f64;
        let mut wsum = 0.0f64;
        for k in -HALF + 1..=HALF {
            let idx = centre + k;
            let t = k as f64 - frac;
            let x = t / HALF as f64;
            if x.abs() >= 1.0 {
                continue;
            }
            let win = bessel_i0(BETA * (1.0 - x * x).sqrt()) / i0b;
            let arg = std::f64::consts::PI * t * cutoff;
            let sinc = if arg.abs() < 1e-9 { 1.0 } else { arg.sin() / arg };
            let w = cutoff * sinc * win;
            wsum += w;
            if idx >= 0 && (idx as usize) < input.len() {
                acc += input[idx as usize] as f64 * w;
            }
        }
        // Normalise the DC gain so long kernels do not drift in level.
        *out = if wsum.abs() > 1e-9 { (acc / wsum) as f32 } else { 0.0 };
    }
}

#[no_mangle]
pub extern "C" fn resample_block(src: u32, src_len: u32, from: f64, to: f64, out: u32, out_len: u32) {
    unsafe { resample(slice(src, src_len), from, to, slice_mut(out, out_len)) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn keeps_a_low_tone() {
        let input: Vec<f32> = (0..4410).map(|i| (2.0 * std::f32::consts::PI * 441.0 * i as f32 / 44100.0).sin()).collect();
        let mut out = vec![0.0; 4800];
        super::resample(&input, 44100.0, 48000.0, &mut out);
        for j in 200..4600 {
            let want = (2.0 * std::f32::consts::PI * 441.0 * j as f32 / 48000.0).sin();
            assert!((out[j] - want).abs() < 0.01, "{} {} {}", j, out[j], want);
        }
    }
}

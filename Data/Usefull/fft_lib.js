/* ── Cooley-Tukey radix-2 in-place FFT ──────────────────────────────────────
   re, im : Float64Array of length N — N must be a power of 2              */
function _fft(re, im) {
  const N = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, h = len >> 1;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < h; j++) {
        const uRe = re[i+j], uIm = im[i+j];
        const vRe = re[i+j+h]*cRe - im[i+j+h]*cIm;
        const vIm = re[i+j+h]*cIm + im[i+j+h]*cRe;
        re[i+j]   = uRe+vRe;  im[i+j]   = uIm+vIm;
        re[i+j+h] = uRe-vRe;  im[i+j+h] = uIm-vIm;
        const nr = cRe*wRe - cIm*wIm;
        cIm = cRe*wIm + cIm*wRe; cRe = nr;
      }
    }
  }
}

function _ifft(re, im) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  _fft(re, im);
  const N = re.length;
  for (let i = 0; i < N; i++) { re[i] /= N; im[i] = -im[i] / N; }
}

function _nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/* Compute FFT of a real-valued signal.
   re / im : un-windowed FFT (used for IFFT reconstruction — round-trip lossless)
   freqs   : one-sided frequency axis  (Hz)
   power   : one-sided amplitude spectrum from Hanning-windowed FFT (for display) */
function signalFFT(signal, fs) {
  const N_orig = signal.length;
  const N = _nextPow2(N_orig);

  // ── Un-windowed FFT (for reconstruction) ──
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N_orig; i++) re[i] = signal[i];
  _fft(re, im);

  // ── Hanning-windowed FFT (for spectrum display — reduces leakage) ──
  const reW = new Float64Array(N);
  const imW = new Float64Array(N);
  for (let i = 0; i < N_orig; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N_orig - 1)));
    reW[i] = signal[i] * w;
  }
  _fft(reW, imW);

  // ── One-sided power spectrum ──
  const half = Math.floor(N / 2) + 1;
  const freqs = new Float64Array(half);
  const power = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = k * fs / N;
    const mag = Math.sqrt(reW[k]*reW[k] + imW[k]*imW[k]) / N_orig;
    power[k] = (k === 0 || k === half - 1) ? mag : mag * 2;
  }

  return { re, im, freqs, power, N, N_orig, fs };
}

/* Apply bandpass mask [fmin, fmax] to FFT result, return IFFT real part. */
function bandpassReconstruct(fftResult, fmin, fmax) {
  const { re, im, N, N_orig, fs } = fftResult;
  const rC = Float64Array.from(re);
  const iC = Float64Array.from(im);
  for (let k = 0; k < N; k++) {
    const f = k <= N / 2 ? k * fs / N : (k - N) * fs / N;
    if (Math.abs(f) < fmin || Math.abs(f) > fmax) { rC[k] = 0; iC[k] = 0; }
  }
  _ifft(rC, iC);
  return Array.from(rC.subarray(0, N_orig));
}

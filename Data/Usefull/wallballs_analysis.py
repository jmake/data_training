import numpy as np
from scipy.signal import find_peaks
from scipy.fft import rfft, rfftfreq

class HeartRateSegmenter:
    def __init__(self, t_arr, bpm_arr):
        self.t = np.array(t_arr)
        self.bpm = np.array(bpm_arr)

    def find_peaks_prominence(self):
        if len(self.bpm) < 2:
            return []
        prom = float(np.std(self.bpm) * 0.5)
        if prom <= 0:
            prom = 2.0
        peaks, _ = find_peaks(self.bpm, prominence=prom, distance=15)
        return [float(self.t[idx]) for idx in peaks]

    def find_peaks_distance(self, override_freq=None):
        if len(self.bpm) < 2:
            return [], 0.0
        
        if override_freq is not None and override_freq > 0:
            dom_freq = override_freq
        else:
            detrended = self.bpm - np.mean(self.bpm)
            N = len(detrended)
            yf = rfft(detrended)
            xf = rfftfreq(N, 1.0)
            valid_idx = np.where(xf > 0.005)[0]
            if len(valid_idx) > 0:
                dom_freq = float(xf[valid_idx[np.argmax(np.abs(yf[valid_idx]))]])
            else:
                dom_freq = 0.0333  # fallback 30s period

        dom_period = 1.0 / dom_freq if dom_freq > 0 else 30.0
        dist_samples = int(0.5 * dom_period)
        dist_samples = max(15, min(dist_samples, 300))
        peaks, _ = find_peaks(self.bpm, distance=dist_samples, prominence=2.0)
        return [float(self.t[idx]) for idx in peaks], dom_freq

    def get_segments(self, seg_mode, t_start, t_end, override_freq=None):
        dom_freq = 0.0
        if seg_mode == "prominence":
            peaks = self.find_peaks_prominence()
        elif seg_mode == "distance":
            peaks, dom_freq = self.find_peaks_distance(override_freq)
        else:
            peaks = []

        all_points = [float(t_start)] + peaks + [float(t_end)]
        all_points = sorted(list(set(all_points)))

        segments = []
        for i in range(len(all_points) - 1):
            segments.append({
                "x0": all_points[i],
                "x1": all_points[i+1]
            })
        return peaks, segments, dom_freq

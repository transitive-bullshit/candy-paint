"""Full-mix analysis: tempo, beat grid, key, per-beat chroma/chords, per-bar energy, section novelty.

Writes analysis/out/mix.json and diagnostic plots to analysis/out/.
"""

import json
import sys
from pathlib import Path

import librosa
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy.ndimage
import scipy.signal

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "media" / "candy-paint-instrumental.wav"
OUT = ROOT / "analysis" / "out"
OUT.mkdir(parents=True, exist_ok=True)

SR = 22050
HOP = 512
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def chord_templates():
    """Triads + sevenths, binary templates over 12 pitch classes."""
    qualities = {
        "maj": [0, 4, 7],
        "min": [0, 3, 7],
        "7": [0, 4, 7, 10],
        "maj7": [0, 4, 7, 11],
        "min7": [0, 3, 7, 10],
        "sus2": [0, 2, 7],
        "sus4": [0, 5, 7],
        "dim": [0, 3, 6],
    }
    names, mats = [], []
    for root in range(12):
        for q, ivs in qualities.items():
            v = np.zeros(12)
            for i in ivs:
                v[(root + i) % 12] = 1
            names.append(f"{NOTE_NAMES[root]}{'' if q == 'maj' else q}")
            mats.append(v / np.linalg.norm(v))
    return names, np.array(mats)


def main():
    y, sr = librosa.load(AUDIO, sr=SR, mono=True)
    dur = len(y) / sr
    print(f"duration {dur:.2f}s")

    y_harm, y_perc = librosa.effects.hpss(y)

    # --- tempo + beats
    onset_env = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP, tightness=200)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=HOP)
    ibi = np.diff(beat_times)
    print(f"tempo {tempo:.2f} bpm, {len(beats)} beats, median ibi {np.median(ibi):.4f}s -> {60 / np.median(ibi):.2f} bpm")

    # tempogram for alternative tempo candidates
    tg = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr, hop_length=HOP)
    tg_mean = tg.mean(axis=1)
    bpms = librosa.tempo_frequencies(tg.shape[0], sr=sr, hop_length=HOP)
    valid = (bpms > 50) & (bpms < 200)
    top = np.argsort(tg_mean[valid])[::-1][:6]
    tempo_candidates = [float(b) for b in bpms[valid][top]]
    print("tempogram candidates", [round(b, 1) for b in tempo_candidates])

    # --- chroma (harmonic part)
    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=HOP, bins_per_octave=36)
    chroma_beat = librosa.util.sync(chroma, beats, aggregate=np.median)

    # key
    prof = chroma.mean(axis=1)
    scores = []
    for r in range(12):
        scores.append(("maj", r, np.corrcoef(np.roll(MAJOR, r), prof)[0, 1]))
        scores.append(("min", r, np.corrcoef(np.roll(MINOR, r), prof)[0, 1]))
    scores.sort(key=lambda s: -s[2])
    key_guesses = [f"{NOTE_NAMES[r]} {q} ({c:.3f})" for q, r, c in scores[:4]]
    print("key", key_guesses)
    print("pitch-class profile", {NOTE_NAMES[i]: round(float(v), 3) for i, v in enumerate(prof / prof.max())})

    # chords per beat
    names, T = chord_templates()
    cb = chroma_beat / (np.linalg.norm(chroma_beat, axis=0, keepdims=True) + 1e-9)
    sim = T @ cb
    chord_idx = sim.argmax(axis=0)
    # smooth with a median filter over beats to remove flicker
    chord_idx_s = scipy.ndimage.median_filter(chord_idx, size=3, mode="nearest")
    beat_chords = [names[i] for i in chord_idx_s]

    # --- energy per beat, spectral bands
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bands = {"sub": (20, 80), "low": (80, 250), "mid": (250, 2000), "high": (2000, 6000), "air": (6000, 11000)}
    band_env = {}
    for k, (lo, hi) in bands.items():
        m = (freqs >= lo) & (freqs < hi)
        band_env[k] = librosa.util.sync(S[m].mean(axis=0, keepdims=True), beats, aggregate=np.mean)[0]
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    rms_beat = librosa.util.sync(rms[None], beats, aggregate=np.mean)[0]

    # --- self-similarity / novelty on beat-synced features
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=20)
    mfcc_b = librosa.util.sync(mfcc, beats)
    feat = np.vstack([librosa.util.normalize(chroma_beat, axis=0), librosa.util.normalize(mfcc_b[1:], axis=1)])
    R = librosa.segment.recurrence_matrix(feat, mode="affinity", sym=True, width=4)
    ssm = librosa.segment.recurrence_matrix(feat, mode="affinity", sym=True, width=1)
    # checkerboard novelty
    L = 16
    g = np.outer(np.r_[np.ones(L), -np.ones(L)], np.r_[np.ones(L), -np.ones(L)])
    g *= scipy.signal.windows.gaussian(2 * L, std=L / 2)[:, None] * scipy.signal.windows.gaussian(2 * L, std=L / 2)[None, :]
    full = feat.T @ feat
    full = full / (np.linalg.norm(feat, axis=0)[:, None] * np.linalg.norm(feat, axis=0)[None, :] + 1e-9)
    n = full.shape[0]
    pad = np.pad(full, L, mode="constant")
    novelty = np.array([np.sum(pad[i : i + 2 * L, i : i + 2 * L] * g) for i in range(n)])
    novelty = np.maximum(novelty, 0)
    peaks, _ = scipy.signal.find_peaks(novelty, distance=12, prominence=np.percentile(novelty, 75) * 0.5)
    bt = np.r_[beat_times, dur]
    print("novelty boundaries (s):", [round(float(bt[p]), 2) for p in peaks])

    # agglomerative segmentation as a second opinion
    bounds_agg = librosa.segment.agglomerative(feat, k=10)
    print("agglomerative boundaries (s):", [round(float(bt[b]), 2) for b in bounds_agg])

    out = {
        "duration": dur,
        "tempo": tempo,
        "tempo_candidates": tempo_candidates,
        "key_guesses": key_guesses,
        "pitch_class_profile": (prof / prof.max()).round(4).tolist(),
        "beats": beat_times.round(4).tolist(),
        "beat_chords": beat_chords,
        "beat_rms": rms_beat.round(5).tolist(),
        "beat_bands": {k: v.round(5).tolist() for k, v in band_env.items()},
        "novelty": novelty.round(4).tolist(),
        "novelty_boundaries": [float(bt[p]) for p in peaks],
        "agglomerative_boundaries": [float(bt[b]) for b in bounds_agg],
    }
    (OUT / "mix.json").write_text(json.dumps(out))

    # --- plots
    fig, ax = plt.subplots(5, 1, figsize=(22, 16), gridspec_kw={"height_ratios": [3, 1, 1.4, 1, 1]})
    ax[0].imshow(ssm, origin="lower", cmap="magma", aspect="auto", extent=[0, dur, 0, dur])
    ax[0].set_title("beat-synced self-similarity (time s)")
    librosa.display.specshow(chroma_beat, y_axis="chroma", x_axis=None, ax=ax[1], cmap="viridis")
    ax[1].set_title("beat chroma")
    t_b = beat_times[: len(rms_beat)]
    for k, v in band_env.items():
        ax[2].plot(bt[: len(v)], v / (v.max() + 1e-9), label=k, lw=1)
    ax[2].legend(loc="upper right")
    ax[2].set_xlim(0, dur)
    ax[2].set_title("band energy per beat (normalized)")
    ax[3].plot(bt[: len(novelty)], novelty, lw=1)
    for p in peaks:
        ax[3].axvline(bt[p], color="r", lw=0.8)
    ax[3].set_xlim(0, dur)
    ax[3].set_title("novelty")
    ax[4].plot(bt[: len(rms_beat)], rms_beat, lw=1)
    ax[4].set_xlim(0, dur)
    ax[4].set_xticks(np.arange(0, dur, 5))
    ax[4].set_title("rms per beat")
    for a in ax[2:]:
        a.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUT / "mix_overview.png", dpi=80)
    print("wrote", OUT / "mix.json")


if __name__ == "__main__":
    sys.exit(main())

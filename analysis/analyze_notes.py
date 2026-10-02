"""Note-level analysis of the piano transcription.

Fits an exact tempo grid to the transcribed onsets, quantizes notes to 16ths, splits hands,
names the harmony per half-bar, and labels sections. Writes analysis/out/score.json and a
piano-roll plot.
"""

import json
from collections import Counter
from pathlib import Path

import matplotlib
import numpy as np
import pretty_midi

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
MIDI = OUT / "transkun.mid"
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def fit_grid(onsets):
    """Grid search tempo + phase that best explains onsets on a 16th grid."""
    best = None
    for bpm in np.arange(89.5, 90.5, 0.005):
        q = 60 / bpm / 4
        ph = np.angle(np.mean(np.exp(2j * np.pi * onsets / q)))
        off = (ph / (2 * np.pi)) * q
        res = ((onsets - off + q / 2) % q) - q / 2
        score = np.median(np.abs(res))
        if best is None or score < best[0]:
            best = (score, bpm, off % q)
    return best


def chord_name(pcs_weight, bass_pc):
    """Name a chord from weighted pitch classes, preferring the bass as root."""
    qualities = {
        "": [0, 4, 7],
        "m": [0, 3, 7],
        "maj7": [0, 4, 7, 11],
        "7": [0, 4, 7, 10],
        "m7": [0, 3, 7, 10],
        "add9": [0, 4, 7, 2],
        "sus2": [0, 2, 7],
        "sus4": [0, 5, 7],
        "6": [0, 4, 7, 9],
        "maj9": [0, 4, 7, 11, 2],
    }
    w = pcs_weight / (pcs_weight.max() + 1e-9)
    best = None
    for root in range(12):
        for q, ivs in qualities.items():
            tmpl = np.zeros(12)
            for i in ivs:
                tmpl[(root + i) % 12] = 1
            # reward covered weight, penalize template tones that are missing and non-chord weight
            score = (w * tmpl).sum() - 0.6 * (w * (1 - tmpl)).sum() - 0.25 * ((tmpl > 0) & (w < 0.1)).sum()
            if root == bass_pc:
                score += 0.35
            score -= 0.04 * len(ivs)
            if best is None or score > best[0]:
                best = (score, root, q)
    _, root, q = best
    name = NAMES[root] + q
    if bass_pc is not None and bass_pc != root:
        name += "/" + NAMES[bass_pc]
    return name


def main():
    m = pretty_midi.PrettyMIDI(str(MIDI))
    notes = sorted([n for i in m.instruments for n in i.notes], key=lambda n: (n.start, n.pitch))
    onsets = np.array([n.start for n in notes])
    score, bpm, off = fit_grid(onsets)
    beat = 60 / bpm
    q = beat / 4
    print(f"grid: {bpm:.3f} bpm, 16th offset {off * 1000:.1f}ms, median residual {score * 1000:.1f}ms")

    # Choose which 16th phase is the downbeat: bass notes (< E2) should land on beat 1 mostly
    bass = np.array([n.start for n in notes if n.pitch < 40])
    best_phase = None
    for k in range(16):
        t0 = off + k * q
        pos = np.round((bass - t0) / q).astype(int) % 16
        c = Counter(pos)
        s = c[0] * 2 + c[8]
        if best_phase is None or s > best_phase[0]:
            best_phase = (s, k, t0, dict(sorted(c.items())))
    _, k, t0, hist = best_phase
    # move t0 to the first bar start at/after the first note minus a bar
    bar = 16 * q
    t0 = t0 - np.floor((t0 - (onsets[0] - 0.05)) / bar) * bar
    if t0 > onsets[0] + 0.02:
        t0 -= bar
    print(f"downbeat phase k={k}, bar 0 starts at {t0:.3f}s, bass 16th-position hist {hist}")

    pedal = [
        {"t": round(c.time, 4), "v": c.value}
        for i in m.instruments
        for c in i.control_changes
        if c.number == 64
    ]

    out_notes = []
    for n in notes:
        s16 = int(round((n.start - t0) / q))
        e16 = max(s16 + 1, int(round((n.end - t0) / q)))
        out_notes.append(
            {
                "pitch": n.pitch,
                "name": pretty_midi.note_number_to_name(n.pitch),
                "vel": n.velocity,
                "t": round(n.start, 4),
                "dur": round(n.end - n.start, 4),
                "s16": s16,
                "len16": e16 - s16,
                "bar": s16 // 16,
                "beat": (s16 % 16) / 4,
            }
        )

    nbars = max(n["bar"] for n in out_notes) + 1

    # hand split: running split point between hands (simple: pitch < 52 (E3) is LH)
    for n in out_notes:
        n["hand"] = "L" if n["pitch"] < 52 else "R"

    # harmony per half bar from sounding notes (duration weighted, bass emphasized)
    harmony = []
    for hb in range(nbars * 2):
        a, b = hb * 8, hb * 8 + 8
        w = np.zeros(12)
        lows = []
        for n in out_notes:
            s, e = n["s16"], n["s16"] + max(n["len16"], 2)
            ov = max(0, min(e, b) - max(s, a))
            if ov:
                w[n["pitch"] % 12] += ov * (1.5 if n["pitch"] < 52 else 1.0)
                lows.append(n["pitch"])
        if w.sum() == 0:
            harmony.append(None)
            continue
        bass_pc = min(lows) % 12 if lows else None
        harmony.append(chord_name(w, bass_pc))

    # signature per bar for section comparison: set of (s16 % 16, pitch) for RH, LH roots
    sig = []
    for b in range(nbars):
        rh = frozenset((n["s16"] % 16, n["pitch"]) for n in out_notes if n["bar"] == b and n["hand"] == "R")
        lh = frozenset((n["s16"] % 16, n["pitch"]) for n in out_notes if n["bar"] == b and n["hand"] == "L")
        sig.append((rh, lh))

    def jacc(a, b):
        if not a and not b:
            return 1.0
        return len(a & b) / max(1, len(a | b))

    S = np.array([[0.5 * jacc(sig[i][0], sig[j][0]) + 0.5 * jacc(sig[i][1], sig[j][1]) for j in range(nbars)] for i in range(nbars)])

    print("\nbar  time    LH notes                         harmony (half bars)   #RH  density")
    for b in range(nbars):
        lh = sorted({n["name"] for n in out_notes if n["bar"] == b and n["hand"] == "L"}, key=lambda s: pretty_midi.note_name_to_number(s))
        nrh = sum(1 for n in out_notes if n["bar"] == b and n["hand"] == "R")
        print(f"{b:3d} {t0 + b * bar:7.2f}  {' '.join(lh)[:32]:32s} {str(harmony[2 * b]):>9s} {str(harmony[2 * b + 1]):>9s}   {nrh:3d}  {'#' * (nrh // 2)}")

    json.dump(
        {
            "bpm": bpm,
            "t0": t0,
            "beat": beat,
            "bar": bar,
            "nbars": nbars,
            "notes": out_notes,
            "pedal": pedal,
            "harmony_half_bars": harmony,
        },
        open(OUT / "score.json", "w"),
    )

    # piano roll plot
    fig, ax = plt.subplots(2, 1, figsize=(26, 14), gridspec_kw={"height_ratios": [2, 1]})
    for n in out_notes:
        c = "#ff5aa5" if n["hand"] == "R" else "#41d1ff"
        ax[0].add_patch(plt.Rectangle((n["s16"] / 16, n["pitch"] - 0.4), n["len16"] / 16, 0.8, color=c, alpha=0.4 + n["vel"] / 200))
    ax[0].set_xlim(0, nbars)
    ax[0].set_ylim(26, 96)
    ax[0].set_xticks(range(0, nbars + 1, 4))
    ax[0].grid(axis="x", alpha=0.4)
    ax[0].set_title(f"piano roll by bar ({bpm:.2f} bpm), pink=RH blue=LH")
    ax[1].imshow(S, origin="lower", cmap="magma", aspect="auto")
    ax[1].set_title("bar-to-bar similarity")
    ax[1].set_xticks(range(0, nbars, 4))
    ax[1].set_yticks(range(0, nbars, 4))
    ax[1].grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUT / "piano_roll.png", dpi=60)


if __name__ == "__main__":
    main()

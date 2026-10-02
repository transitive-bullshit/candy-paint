"""Curate the transcription into the renderer's score: voices, sections, harmony, on an exact grid.

Input: analysis/out/score.json (from analyze_notes.py). Output: data/score.json.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "analysis" / "out" / "score.json"
DST = ROOT / "data" / "score.json"

# Bar ranges are [start, end). Names follow the original's arrangement (intro, hook, verse, pre-hook).
SECTIONS = [
    ("intro", "Intro", 0, 4),
    ("hook1", "Hook I", 4, 12),
    ("hook1-drop", "Hook I (full)", 12, 20),
    ("verse1", "Verse I", 20, 32),
    ("prehook1", "Pre-hook", 32, 36),
    ("hook2", "Hook II", 36, 44),
    ("hook2-drop", "Hook II (full)", 44, 52),
    ("verse2", "Verse II", 52, 60),
    ("prehook2", "Pre-hook", 60, 64),
    ("hook3", "Hook III", 64, 72),
    ("hook3-drop", "Hook III (full)", 72, 80),
    ("outro", "Outro", 80, 83),
]

# Lowest pitch of each voice's staff, as a diatonic anchor (E major). Voices are split by register.
VOICES = {
    "sparkle": {"label": "Sparkle", "desc": "octave doubling of the hook melody, full hooks only"},
    "lead": {"label": "Lead", "desc": "the vocal hook/verse line, E5-E6"},
    "riff": {"label": "Riff", "desc": "the IV-I arpeggio loop, B3-A4"},
    "bass": {"label": "Bass", "desc": "left-hand octaves standing in for the 808, E1-E3"},
}

# E major: diatonic step index for each pitch class (sharps are in key, so all used notes are diatonic)
E_MAJOR = {4: 0, 6: 1, 8: 2, 9: 3, 11: 4, 1: 5, 3: 6}


def diatonic_step(pitch):
    """Diatonic staff position counting from E0, so octave = 7 steps."""
    pc = pitch % 12
    octave = (pitch - 4) // 12
    if pc not in E_MAJOR:
        # chromatic notes (rare): snap down a semitone
        return diatonic_step(pitch - 1)
    return octave * 7 + E_MAJOR[pc]


def main():
    s = json.loads(SRC.read_text())
    notes = s["notes"]
    by_onset = {}
    for n in notes:
        by_onset.setdefault(n["s16"], set()).add(n["pitch"])

    out = []
    for n in notes:
        p = n["pitch"]
        if p <= 52:
            voice = "bass"
        elif p <= 69:
            voice = "riff"
        elif p >= 88 and (p - 12) in by_onset.get(n["s16"], set()):
            voice = "sparkle"
        else:
            voice = "lead"
        out.append(
            {
                "p": p,
                "v": voice,
                "s": n["s16"],
                "l": n["len16"],
                "vel": n["vel"],
                "step": diatonic_step(p),
            }
        )
    out.sort(key=lambda n: (n["s"], n["p"]))

    counts = {}
    for n in out:
        counts[n["v"]] = counts.get(n["v"], 0) + 1
    print("notes per voice", counts)

    # harmony: the song is a IV-I loop (A to E), one chord per bar. Where the left hand plays, its
    # root at the downbeat (including a pickup tied over the barline) names the chord; elsewhere the
    # loop's phase holds (even bars A, odd bars E), which matches the original's progression.
    harmony = s["harmony_half_bars"]
    chords = []
    for bar in range(s["nbars"]):
        a = bar * 16
        lh = [n for n in out if n["v"] == "bass" and (a <= n["s"] < a + 4 or n["s"] < a < n["s"] + n["l"])]
        if lh:
            root = min(lh, key=lambda n: n["p"])["p"] % 12
            chords.append("A" if root == 9 else "E")
        else:
            chords.append("A" if bar % 2 == 0 else "E")

    score = {
        "title": "Candy Paint",
        "audio": "media/candy-paint-instrumental.mp3",
        "bpm": round(s["bpm"], 3),
        "t0": round(s["t0"], 4),
        "sixteenth": 60 / s["bpm"] / 4,
        "bars": s["nbars"],
        "duration": 233.59,
        "key": "E major",
        "sections": [{"id": i, "label": l, "start": a, "end": b} for i, l, a, b in SECTIONS],
        "voices": VOICES,
        "harmony": harmony,
        "chords": chords,
        "pedal": s["pedal"],
        "notes": out,
    }
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(score, separators=(",", ":")))
    print("wrote", DST, f"{DST.stat().st_size / 1024:.1f} KB")

    print("chords", "".join(chords))
    for v in VOICES:
        steps = [n["step"] for n in out if n["v"] == v]
        ps = [n["p"] for n in out if n["v"] == v]
        print(f"{v:8s} pitch {min(ps)}-{max(ps)} step {min(steps)}-{max(steps)}")


if __name__ == "__main__":
    main()

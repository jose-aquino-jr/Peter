"""Temporal matching utilities for the experimental 1:1 prototype."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from src.landmarks import HandLandmarks, extract_hands, normalize_frame


FEATURE_SIZE = 128


def frame_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Compare hand slots; penalize missing/present disagreement explicitly."""
    pa, pb = a[126:128], b[126:128]
    if not pa.any() and not pb.any():
        return 0.2
    penalties = [0.65 * float(np.abs(pa - pb).sum())]
    for slot in range(2):
        if pa[slot] and pb[slot]:
            start = slot * 63
            # RMS is easier to interpret than a 63-coordinate Euclidean norm.
            penalties.append(float(np.sqrt(np.mean((a[start:start+63] - b[start:start+63]) ** 2))))
    return float(np.mean(penalties))


def dtw_distance(first: np.ndarray, second: np.ndarray, band_ratio: float = 0.25) -> float:
    """Band-constrained DTW, returning average cost per alignment step."""
    if first.ndim != 2 or second.ndim != 2 or first.shape[1] != FEATURE_SIZE or second.shape[1] != FEATURE_SIZE:
        raise ValueError(f"Sequences must have shape (frames, {FEATURE_SIZE})")
    if not len(first) or not len(second):
        raise ValueError("Cannot compare an empty sequence")
    n, m = len(first), len(second)
    width = max(abs(n - m), int(max(n, m) * band_ratio))
    costs = np.full((n + 1, m + 1), np.inf, dtype=np.float64)
    steps = np.zeros((n + 1, m + 1), dtype=np.int32)
    costs[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(max(1, i - width), min(m, i + width) + 1):
            prev = min((costs[i-1, j], steps[i-1, j]),
                       (costs[i, j-1], steps[i, j-1]),
                       (costs[i-1, j-1], steps[i-1, j-1]), key=lambda x: x[0])
            costs[i, j] = prev[0] + frame_distance(first[i-1], second[j-1])
            steps[i, j] = prev[1] + 1
    return float(costs[n, m] / max(1, steps[n, m]))


def sequence_from_video(path: str | Path, hands_model, mirror: bool = False) -> np.ndarray:
    """Run the same MediaPipe Hands pipeline over a video and return frames."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    frames = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if mirror:
                frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = hands_model.process(rgb)
            frames.append(normalize_frame(extract_hands(results)))
    finally:
        cap.release()
    if not frames:
        raise ValueError(f"No readable frames in {path}")
    return trim_empty_edges(np.stack(frames))


def trim_empty_edges(sequence: np.ndarray) -> np.ndarray:
    active = np.flatnonzero(sequence[:, 126:128].any(axis=1))
    if not len(active):
        return sequence
    return sequence[active[0]:active[-1] + 1]


def load_references(directory: str | Path) -> list[dict]:
    refs = []
    for file in sorted(Path(directory).glob("*.npz")):
        with np.load(file, allow_pickle=False) as data:
            seq = data["sequence"].astype(np.float32)
            label = str(data["label"].item())
            translation = str(data["translation"].item())
        if len(seq) and seq.shape[1] == FEATURE_SIZE:
            refs.append({"label": label, "translation": translation, "sequence": seq, "file": file.name})
    return refs


def classify(sequence: np.ndarray, references: list[dict], score_scale: float = 1.5) -> list[dict]:
    """Rank references. Similarity is an uncalibrated distance-derived score."""
    ranked = []
    for ref in references:
        distance = dtw_distance(sequence, ref["sequence"])
        ranked.append({**{k: ref[k] for k in ("label", "translation", "file")},
                       "distance": distance,
                       "similarity": round(100 * max(0.0, 1.0 - distance / score_scale), 1)})
    return sorted(ranked, key=lambda item: item["distance"])


def append_result(path: str | Path, record: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")

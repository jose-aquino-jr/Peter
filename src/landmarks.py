from dataclasses import dataclass
from typing import Iterable, Optional

import numpy as np


@dataclass(frozen=True)
class HandLandmarks:
    """Landmarks normalizados de uma mão detectada."""

    handedness: str
    score: float
    points: np.ndarray


def extract_hands(results, num_landmarks: int = 21) -> list[HandLandmarks]:
    """Converte o resultado do MediaPipe em uma estrutura explícita e validada."""
    hands: list[HandLandmarks] = []

    if results.multi_hand_landmarks is None:
        return hands

    handedness_items = results.multi_handedness or []
    for index, hand in enumerate(results.multi_hand_landmarks):
        points = np.asarray(
            [[point.x, point.y, point.z] for point in hand.landmark],
            dtype=np.float32,
        )
        if points.shape != (num_landmarks, 3):
            raise ValueError(
                f"Esperados {num_landmarks} landmarks com 3 coordenadas, "
                f"mas foi recebido shape {points.shape}"
            )

        handedness = "Unknown"
        score = 0.0
        if index < len(handedness_items) and handedness_items[index].classification:
            classification = handedness_items[index].classification[0]
            handedness = classification.label
            score = float(classification.score)

        hands.append(HandLandmarks(handedness, score, points))

    return hands


def landmarks_to_feature_vector(hands: Iterable[HandLandmarks], num_hands: int = 2) -> np.ndarray:
    """Acomoda uma até duas mãos em um vetor fixo; mãos ausentes ficam como NaN."""
    vectors: list[np.ndarray] = []
    for hand in hands:
        vectors.append(hand.points.reshape(-1))
        if len(vectors) == num_hands:
            break

    while len(vectors) < num_hands:
        vectors.append(np.full(21 * 3, np.nan, dtype=np.float32))

    return np.concatenate(vectors).astype(np.float32)


def canonical_hands(hands: Iterable[HandLandmarks]) -> list[Optional[HandLandmarks]]:
    """Return stable [Left, Right] slots; unknown labels are not guessed."""
    slots: list[Optional[HandLandmarks]] = [None, None]
    for hand in hands:
        label = hand.handedness.strip().lower()
        slot = 0 if label == "left" else 1 if label == "right" else None
        if slot is not None and slots[slot] is None:
            slots[slot] = hand
    return slots


def normalize_frame(hands: Iterable[HandLandmarks]) -> np.ndarray:
    """Build 128 float features: two 63-value hand slots plus presence bits.

    Each detected hand is wrist-centered and scaled by wrist-to-middle-MCP
    distance. A small wrist image-position component preserves signing location;
    absent hands are zeros and distinguished by the final presence bits.
    """
    slots = canonical_hands(hands)
    output = np.zeros((2, 63), dtype=np.float32)
    present = np.zeros(2, dtype=np.float32)
    for index, hand in enumerate(slots):
        if hand is None:
            continue
        points = np.asarray(hand.points, dtype=np.float32)
        if points.shape != (21, 3) or not np.isfinite(points).all():
            continue
        origin = points[0].copy()
        scale = float(np.linalg.norm(points[9] - origin))
        if scale < 1e-5:
            continue
        local = (points - origin) / scale
        # Retain where the wrist is in the image, independent of hand size.
        local[0, 0] = points[0, 0]
        local[0, 1] = points[0, 1]
        output[index] = local.reshape(-1)
        present[index] = 1.0
    return np.concatenate((output.reshape(-1), present))


def get_hand_points(results, index: Optional[int] = None):
    """Retorna landmarks brutos da API do MediaPipe ou None se não houver deteção."""
    if results.multi_hand_landmarks is None:
        return None
    if index is None:
        return results.multi_hand_landmarks
    if index >= len(results.multi_hand_landmarks):
        return None
    return results.multi_hand_landmarks[index]

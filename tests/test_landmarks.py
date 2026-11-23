from types import SimpleNamespace

import numpy as np
import pytest

from src.landmarks import extract_hands, landmarks_to_feature_vector


def make_results(hands=None, handedness=None):
    return SimpleNamespace(
        multi_hand_landmarks=hands,
        multi_handedness=handedness,
    )


def make_hand(offset=0.0):
    point = lambda x, y, z: SimpleNamespace(x=x, y=y, z=z)
    landmarks = [
        point(offset + i / 100, offset + i / 200, i / 1000)
        for i in range(21)
    ]
    return SimpleNamespace(landmark=landmarks)


def test_extract_hands_returns_empty_when_no_hands():
    result = make_results()
    assert extract_hands(result) == []


def test_extract_hands_validates_21_landmark_shape():
    short_hand = SimpleNamespace(
        landmark=[SimpleNamespace(x=0, y=0, z=0) for _ in range(20)]
    )
    result = make_results(hands=[short_hand])

    with pytest.raises(ValueError, match="Esperados 21"):
        extract_hands(result)


def test_feature_vector_marks_missing_second_hand():
    from src.landmarks import HandLandmarks

    one_hand = HandLandmarks(
        handedness="Left",
        score=0.99,
        points=np.zeros((21, 3), dtype=np.float32),
    )
    vector = landmarks_to_feature_vector([one_hand])

    assert vector.shape == (126,)
    assert np.array_equal(vector[:63], np.zeros(63, dtype=np.float32))
    assert np.all(np.isnan(vector[63:]))

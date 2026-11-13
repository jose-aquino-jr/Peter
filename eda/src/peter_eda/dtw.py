"""Faithful NumPy reproduction of Peter's DTW matching pipeline.

The reference implementation is the TypeScript code in
``src/vision/pipeline/{dtw,feature-vector,sign-matching-engine}.ts``.  This
module mirrors its feature representation, normalisation constants, DTW
banding, score combination and threshold logic.  Experimental variants are
kept separate and are never presented as the production algorithm.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

from . import config
from .loaders import Sample
from .metrics import classification_metrics

Array = np.ndarray


# ---------------------------------------------------------------------------
# JS-compatible helpers
# ---------------------------------------------------------------------------


def js_round(value: float) -> int:
    """Match JavaScript's ``Math.round`` (half rounds towards +infinity)."""

    return int(math.floor(value + 0.5))


def _distance(a: Array, b: Array) -> float:
    return float(np.linalg.norm(a[:3] - b[:3]))


def _visible(point: Array, threshold: float = config.MIN_VISIBILITY) -> bool:
    return float(point[3]) >= threshold


# ---------------------------------------------------------------------------
# Canonical frame -> landmark arrays
# ---------------------------------------------------------------------------


def frame_to_arrays(frame: dict[str, Any]) -> dict[str, Array]:
    """Convert a canonical frame to body / left hand / right hand arrays.

    Each array has shape ``(n, 4)`` with ``x, y, z, visibility``.
    """

    joints = frame.get("joints", {})

    def point(name: str) -> Array:
        value = joints.get(name)
        if value is None:
            return np.array([0.0, 0.0, 0.0, 0.0], dtype=float)
        return np.array(
            [
                float(value.get("x", 0.0)),
                float(value.get("y", 0.0)),
                float(value.get("z", 0.0)),
                float(value.get("visibility", 1.0)),
            ],
            dtype=float,
        )

    body = np.vstack([point(name) for name in config.CANONICAL_JOINTS[:13]])
    left = np.vstack(
        [point("leftHandWrist")]
        + [point(f"left{finger}{joint}") for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky") for joint in range(1, 5)]
    )
    right = np.vstack(
        [point("rightHandWrist")]
        + [point(f"right{finger}{joint}") for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky") for joint in range(1, 5)]
    )
    return {"body": body, "left": left, "right": right}


def _shoulder_reference(body: Array) -> tuple[Array, float] | None:
    # frame.body.length === 13 -> indices 1 and 2 (canonical body order).
    left_index, right_index = (1, 2) if len(body) == 13 else (11, 12)
    left = body[left_index]
    right = body[right_index]
    if not (_visible(left) and _visible(right)):
        return None
    scale = _distance(left, right)
    if scale < config.MIN_SHOULDER_SCALE:
        return None
    origin = np.array(
        [
            (left[0] + right[0]) / 2,
            (left[1] + right[1]) / 2,
            (left[2] + right[2]) / 2,
        ],
        dtype=float,
    )
    return origin, scale


def _hand_shape_features(
    hand: Array,
    scale_mode: str = "palm",
    shoulder_scale: float | None = None,
) -> Array:
    """84 dimensions for one hand, mirroring ``handShapeFeatures``."""

    wrist = hand[0]
    middle_mcp = hand[9]
    if scale_mode == "palm":
        scale = (
            _distance(wrist, middle_mcp)
            if _visible(wrist) and _visible(middle_mcp)
            else 0.0
        )
    elif scale_mode == "shoulder":
        scale = shoulder_scale if shoulder_scale is not None else 0.0
    elif scale_mode == "none":
        scale = 1.0
    else:
        raise ValueError(f"scale_mode desconhecido: {scale_mode!r}")

    minimum = config.MIN_PALM_SCALE if scale_mode == "palm" else config.MIN_SHOULDER_SCALE
    if scale < minimum:
        return np.zeros(config.HAND_SHAPE_DIM, dtype=float)

    vector = np.zeros(config.HAND_SHAPE_DIM, dtype=float)
    for index, point in enumerate(hand):
        if not _visible(point):
            continue
        offset = index * 4
        vector[offset : offset + 4] = [
            (point[0] - wrist[0]) / scale,
            (point[1] - wrist[1]) / scale,
            (point[2] - wrist[2]) / scale,
            1.0,
        ]
    return vector


def frame_to_hand_shape_vector(
    frame: dict[str, Any], scale_mode: str = "palm"
) -> Array:
    arrays = frame_to_arrays(frame)
    shoulder_scale = None
    if scale_mode == "shoulder":
        reference = _shoulder_reference(arrays["body"])
        shoulder_scale = reference[1] if reference else None
    return np.concatenate(
        [
            _hand_shape_features(arrays["left"], scale_mode, shoulder_scale),
            _hand_shape_features(arrays["right"], scale_mode, shoulder_scale),
        ]
    )


def _hand_trajectory_features(
    hand: Array, origin: Array, scale: float
) -> Array:
    wrist = hand[0]
    if not _visible(wrist):
        return np.zeros(config.TRAJECTORY_DIM, dtype=float)
    return np.array(
        [
            (wrist[0] - origin[0]) / scale,
            (wrist[1] - origin[1]) / scale,
            (wrist[2] - origin[2]) / scale,
            1.0,
        ],
        dtype=float,
    )


def frame_to_hand_trajectory_vector(frame: dict[str, Any]) -> Array | None:
    arrays = frame_to_arrays(frame)
    reference = _shoulder_reference(arrays["body"])
    if reference is None:
        return None
    origin, scale = reference
    return np.concatenate(
        [
            _hand_trajectory_features(arrays["left"], origin, scale),
            _hand_trajectory_features(arrays["right"], origin, scale),
        ]
    )


def resample_vectors(vectors: Sequence[Array], max_frames: int) -> Array:
    """Mirror ``resampleVectors`` (copy if short, JS rounding if long)."""

    if len(vectors) == 0 or max_frames < 1:
        return np.empty((0, 0), dtype=float)
    dimension = len(vectors[0])
    if len(vectors) <= max_frames:
        return np.vstack([np.asarray(vector, dtype=float) for vector in vectors])
    last_index = len(vectors) - 1
    indices = [
        js_round(index * last_index / (max_frames - 1))
        for index in range(max_frames)
    ]
    return np.vstack([np.asarray(vectors[index], dtype=float) for index in indices])


@dataclass(frozen=True)
class FeatureBundle:
    hand_shape: Array
    hand_trajectory: Array


def sequence_to_dual_features(
    frames: Sequence[dict[str, Any]],
    max_frames: int = config.MAX_MATCH_FRAMES,
    shape_scale: str = "palm",
) -> FeatureBundle:
    """Mirror ``sequenceToDualFeatureVectors``.

    ``handTrajectory`` is empty for the whole sequence when *any* frame has no
    valid shoulder reference, exactly as in the TypeScript implementation.
    """

    shape = [frame_to_hand_shape_vector(frame, shape_scale) for frame in frames]
    trajectory: list[Array | None] = [
        frame_to_hand_trajectory_vector(frame) for frame in frames
    ]
    complete_trajectory = (
        [vector for vector in trajectory if vector is not None]
        if all(vector is not None for vector in trajectory)
        else []
    )
    return FeatureBundle(
        hand_shape=resample_vectors(shape, max_frames),
        hand_trajectory=resample_vectors(complete_trajectory, max_frames),
    )


# ---------------------------------------------------------------------------
# Motion gate
# ---------------------------------------------------------------------------


def _landmark_travel(previous: Array, current: Array) -> tuple[float, int]:
    total = 0.0
    count = 0
    for index in range(min(len(previous), len(current))):
        source = previous[index]
        target = current[index]
        if not (_visible(source) and _visible(target)):
            continue
        total += _distance(source, target)
        count += 1
    return total, count


def motion_energy(frames: Sequence[dict[str, Any]]) -> float:
    """Mirror ``motionEnergy`` including the duplicated wrist pairs."""

    if len(frames) < 2:
        return 0.0
    arrays = [frame_to_arrays(frame) for frame in frames]
    total = 0.0
    count = 0
    for previous, current in zip(arrays, arrays[1:]):
        for source, target in (
            (previous["left"], current["left"]),
            (previous["right"], current["right"]),
            (previous["body"][5:7], current["body"][5:7]),
        ):
            travel, points = _landmark_travel(source, target)
            total += travel
            count += points
    return 0.0 if count == 0 else total / count


# ---------------------------------------------------------------------------
# DTW
# ---------------------------------------------------------------------------


def _euclidean(a: Array, b: Array) -> float:
    length = min(len(a), len(b))
    delta = a[:length] - b[:length]
    return float(math.sqrt(float(np.dot(delta, delta))))


def dtw_distance(
    query: Array,
    template: Array,
    window_ratio: float = config.DTW_WINDOW_RATIO,
) -> float:
    """Sakoe-Chiba banded DTW, identical to ``dtwDistance``.

    Note: the final path cost is divided by ``n + m`` (not by the path
    length).  This is part of the production behaviour and is reproduced
    deliberately, not corrected here.
    """

    n = len(query)
    m = len(template)
    if n == 0 or m == 0:
        return float("inf")
    window = max(1, abs(n - m), int(math.ceil(max(n, m) * window_ratio)))
    previous = np.full(m + 1, np.inf, dtype=float)
    current = np.full(m + 1, np.inf, dtype=float)
    previous[0] = 0.0
    for i in range(1, n + 1):
        current.fill(np.inf)
        start = max(1, i - window)
        end = min(m, i + window)
        query_vector = query[i - 1]
        for j in range(start, end + 1):
            cost = _euclidean(query_vector, template[j - 1])
            current[j] = cost + min(previous[j], current[j - 1], previous[j - 1])
        previous, current = current, previous
    return float(previous[m] / (n + m))


def dtw_similarity(
    query: Array,
    template: Array,
    window_ratio: float = config.DTW_WINDOW_RATIO,
) -> float:
    distance = dtw_distance(query, template, window_ratio)
    if not math.isfinite(distance):
        return 0.0
    return 1.0 / (1.0 + distance)


# ---------------------------------------------------------------------------
# Experimental masked DTW (visibility-aware ablation)
# ---------------------------------------------------------------------------


def _validity_mask(vector: Array) -> Array:
    """One boolean per 4-dimensional landmark block (validity is component 3)."""

    if len(vector) == 0:
        return np.zeros(0, dtype=bool)
    return np.asarray(vector[3::4] >= 0.5)


def dtw_distance_masked(
    query: Array,
    template: Array,
    window_ratio: float = config.DTW_WINDOW_RATIO,
) -> float:
    """Experimental DTW that ignores missing landmark blocks.

    This is *not* the production algorithm.  Each 4-dimensional landmark block
    is valid when its visibility/validity component is set.  The squared error
    is averaged over the blocks visible in both frames, so a missing hand does
    not contribute artificial zeros to the distance.
    """

    n = len(query)
    m = len(template)
    if n == 0 or m == 0:
        return float("inf")
    query_masks = _validity_masks(query)
    template_masks = _validity_masks(template)

    def cost(i: int, j: int) -> float:
        mask = query_masks[i] & template_masks[j]
        if not mask.any():
            return 0.0
        blocks = np.repeat(mask, 4)
        delta = query[i][blocks] - template[j][blocks]
        mean_square = float(np.dot(delta, delta)) / max(1, int(mask.sum()))
        return float(math.sqrt(mean_square))

    window = max(1, abs(n - m), int(math.ceil(max(n, m) * window_ratio)))
    previous = np.full(m + 1, np.inf, dtype=float)
    current = np.full(m + 1, np.inf, dtype=float)
    previous[0] = 0.0
    for i in range(1, n + 1):
        current.fill(np.inf)
        for j in range(max(1, i - window), min(m, i + window) + 1):
            current[j] = cost(i - 1, j - 1) + min(
                previous[j], current[j - 1], previous[j - 1]
            )
        previous, current = current, previous
    return float(previous[m] / (n + m))


def _validity_masks(sequence: Array) -> Array:
    return np.asarray([_validity_mask(vector) for vector in sequence], dtype=bool)


def dtw_similarity_masked(
    query: Array,
    template: Array,
    window_ratio: float = config.DTW_WINDOW_RATIO,
) -> float:
    distance = dtw_distance_masked(query, template, window_ratio)
    return 0.0 if not math.isfinite(distance) else 1.0 / (1.0 + distance)


# ---------------------------------------------------------------------------
# Score combination and prediction
# ---------------------------------------------------------------------------


def combine_feature_scores(
    hand_shape_score: float,
    hand_trajectory_score: float | None,
    hand_shape_weight: float,
    hand_trajectory_weight: float,
) -> float:
    """Weighted average, dropping trajectory when unavailable."""

    trajectory_weight = 0.0 if hand_trajectory_score is None else hand_trajectory_weight
    total_weight = hand_shape_weight + trajectory_weight
    if total_weight == 0:
        return 0.0
    return (
        hand_shape_score * hand_shape_weight
        + (hand_trajectory_score or 0.0) * trajectory_weight
    ) / total_weight


@dataclass(frozen=True)
class SampleScore:
    sample_id: str
    class_name: str
    informant_id: str
    split: str
    role: str
    motion_energy: float
    best_score: float
    best_shape_score: float
    best_trajectory_score: float | None
    best_template_id: str | None
    second_best_score: float | None
    runner_up_gap: float | None
    hand_visibility: float | None
    pose_visibility: float | None
    duration_seconds: float | None


def score_sample_templates(
    sample: Sample,
    template_features: dict[str, FeatureBundle],
    template_meta: dict[str, dict[str, Any]],
    configuration: config.MatchConfiguration,
    shape_features: FeatureBundle | None = None,
    masked: bool = False,
) -> list[dict[str, Any]]:
    """Score one sample against every template (all diagnostics)."""

    features = shape_features or sequence_to_dual_features(
        sample.frames, configuration.max_frames
    )
    rows: list[dict[str, Any]] = []
    for template_id, reference in template_features.items():
        if masked:
            shape_score = dtw_similarity_masked(
                features.hand_shape,
                reference.hand_shape,
                configuration.window_ratio,
            )
            trajectory_score = (
                dtw_similarity_masked(
                    features.hand_trajectory,
                    reference.hand_trajectory,
                    configuration.window_ratio,
                )
                if len(features.hand_trajectory) > 1
                and len(reference.hand_trajectory) > 1
                else None
            )
        else:
            shape_score = dtw_similarity(
                features.hand_shape, reference.hand_shape, configuration.window_ratio
            )
            trajectory_score = (
                dtw_similarity(
                    features.hand_trajectory,
                    reference.hand_trajectory,
                    configuration.window_ratio,
                )
                if len(features.hand_trajectory) > 1
                and len(reference.hand_trajectory) > 1
                else None
            )
        combined = combine_feature_scores(
            shape_score,
            trajectory_score,
            configuration.hand_shape_weight,
            configuration.hand_trajectory_weight,
        )
        rows.append(
            {
                "sample_id": sample.sample_id,
                "class_name": sample.class_name,
                "informant_id": sample.informant_id,
                "dataset_split": sample.split,
                "dataset_role": sample.role,
                "template_id": template_id,
                "template_gloss": template_meta[template_id]["gloss"],
                "template_informant_id": template_meta[template_id]["informant_id"],
                "hand_shape_score": shape_score,
                "hand_trajectory_score": trajectory_score,
                "combined_score": combined,
            }
        )
    return rows


def prepare_template_features(
    templates: Sequence[Sample],
    configuration: config.MatchConfiguration,
    shape_scale: str = "palm",
) -> tuple[dict[str, FeatureBundle], dict[str, dict[str, Any]]]:
    features: dict[str, FeatureBundle] = {}
    meta: dict[str, dict[str, Any]] = {}
    for template in templates:
        features[template.sample_id] = sequence_to_dual_features(
            template.frames, configuration.max_frames, shape_scale=shape_scale
        )
        meta[template.sample_id] = {
            "informant_id": template.informant_id,
            "gloss": template.class_name,
        }
    return features, meta


def prepare_sample_features(
    samples: Sequence[Sample],
    configuration: config.MatchConfiguration,
    shape_scale: str = "palm",
) -> dict[str, FeatureBundle]:
    return {
        sample.sample_id: sequence_to_dual_features(
            sample.frames, configuration.max_frames, shape_scale=shape_scale
        )
        for sample in samples
    }


def score_samples(
    samples: Sequence[Sample],
    templates: Sequence[Sample],
    configuration: config.MatchConfiguration,
    template_features: dict[str, FeatureBundle] | None = None,
    template_meta: dict[str, dict[str, Any]] | None = None,
    sample_features: dict[str, FeatureBundle] | None = None,
    shape_scale: str = "palm",
    masked: bool = False,
) -> pd.DataFrame:
    """Return one diagnostic row per sample with the best template score."""

    if template_features is None or template_meta is None:
        template_features, template_meta = prepare_template_features(
            templates, configuration, shape_scale=shape_scale
        )
    if sample_features is None:
        sample_features = prepare_sample_features(
            samples, configuration, shape_scale=shape_scale
        )

    records: list[dict[str, Any]] = []
    for sample in samples:
        rows = score_sample_templates(
            sample,
            template_features,
            template_meta,
            configuration,
            shape_features=sample_features[sample.sample_id],
            masked=masked,
        )
        frame = pd.DataFrame(rows)
        # The production engine keeps only the best template *per gloss*
        # (``bestByGloss``) before sorting candidates.  With a single gloss
        # there is no runner-up, so the margin rule cannot reject a match;
        # reproducing this avoids a systematic divergence from the
        # TypeScript report.
        by_gloss = (
            frame.groupby("template_gloss")["combined_score"]
            .max()
            .sort_values(ascending=False)
        )
        best_gloss = str(by_gloss.index[0])
        best = (
            frame[frame["template_gloss"] == best_gloss]
            .sort_values("combined_score", ascending=False)
            .iloc[0]
        )
        second = float(by_gloss.iloc[1]) if len(by_gloss) > 1 else None
        energy = motion_energy(sample.frames)
        gate = energy >= configuration.min_motion
        margin_ok = (
            second is None
            or float(best["combined_score"]) - second
            >= configuration.min_score_margin
        )
        predicted = int(
            gate
            and float(best["combined_score"]) >= configuration.threshold
            and margin_ok
            and best_gloss == "SIM"
        )
        records.append(
            {
                "sample_id": sample.sample_id,
                "class_name": sample.class_name,
                "informant_id": sample.informant_id,
                "dataset_split": sample.split,
                "dataset_role": sample.role,
                "motion_energy": energy,
                "motion_gate_passed": gate,
                "best_score": float(best["combined_score"]),
                "best_hand_shape_score": float(best["hand_shape_score"]),
                "best_hand_trajectory_score": (
                    float(best["hand_trajectory_score"])
                    if pd.notna(best["hand_trajectory_score"])
                    else None
                ),
                "best_template_id": best["template_id"],
                "second_best_score": second,
                "runner_up_gap": (
                    float(best["combined_score"]) - second
                    if second is not None
                    else None
                ),
                "hand_visibility": sample.hand_visibility,
                "pose_visibility": sample.pose_visibility,
                "duration_seconds": sample.duration_seconds,
                "predicted_sim": predicted,
                "threshold": configuration.threshold,
                "min_motion": configuration.min_motion,
                "hand_shape_weight": configuration.hand_shape_weight,
                "hand_trajectory_weight": configuration.hand_trajectory_weight,
            }
        )
    return pd.DataFrame.from_records(records)


def full_template_score_table(
    samples: Sequence[Sample],
    templates: Sequence[Sample],
    configuration: config.MatchConfiguration,
    template_features: dict[str, FeatureBundle] | None = None,
    template_meta: dict[str, dict[str, Any]] | None = None,
    sample_features: dict[str, FeatureBundle] | None = None,
    shape_scale: str = "palm",
) -> pd.DataFrame:
    if template_features is None or template_meta is None:
        template_features, template_meta = prepare_template_features(
            templates, configuration, shape_scale=shape_scale
        )
    if sample_features is None:
        sample_features = prepare_sample_features(
            samples, configuration, shape_scale=shape_scale
        )
    records: list[dict[str, Any]] = []
    for sample in samples:
        records.extend(
            score_sample_templates(
                sample,
                template_features,
                template_meta,
                configuration,
                shape_features=sample_features[sample.sample_id],
            )
        )
    return pd.DataFrame.from_records(records)


# ---------------------------------------------------------------------------
# Configuration evaluation and tuning
# ---------------------------------------------------------------------------


def evaluate_configuration(
    samples: Sequence[Sample],
    templates: Sequence[Sample],
    configuration: config.MatchConfiguration,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Score and compute binary metrics for one split/configuration."""

    scored = score_samples(samples, templates, configuration)
    y_true = (scored["class_name"] == "SIM").astype(int).to_numpy()
    y_pred = scored["predicted_sim"].astype(int).to_numpy()
    metrics = classification_metrics(y_true, y_pred)
    return scored, metrics


def _combined_matrix(
    shape_scores: Array,
    trajectory_scores: Array,
    hand_shape_weight: float,
) -> Array:
    trajectory_weight = 1.0 - hand_shape_weight
    total = hand_shape_weight + trajectory_weight
    return (
        shape_scores * hand_shape_weight
        + np.where(np.isnan(trajectory_scores), 0.0, trajectory_scores)
        * trajectory_weight
    ) / total


def precompute_score_matrices(
    samples: Sequence[Sample],
    templates: Sequence[Sample],
    configuration: config.MatchConfiguration,
) -> dict[str, Any]:
    """Precompute shape/trajectory matrices used by the tuning grid."""

    template_features, template_meta = prepare_template_features(
        templates, configuration
    )
    sample_features = prepare_sample_features(samples, configuration)
    shape_rows = []
    trajectory_rows = []
    motions = []
    for sample in samples:
        features = sample_features[sample.sample_id]
        shape_row = []
        trajectory_row = []
        for template_id, reference in template_features.items():
            shape_row.append(
                dtw_similarity(
                    features.hand_shape,
                    reference.hand_shape,
                    configuration.window_ratio,
                )
            )
            trajectory_row.append(
                dtw_similarity(
                    features.hand_trajectory,
                    reference.hand_trajectory,
                    configuration.window_ratio,
                )
                if len(features.hand_trajectory) > 1
                and len(reference.hand_trajectory) > 1
                else np.nan
            )
        shape_rows.append(shape_row)
        trajectory_rows.append(trajectory_row)
        motions.append(motion_energy(sample.frames))
    return {
        "sample_ids": [sample.sample_id for sample in samples],
        "template_ids": list(template_features),
        "template_meta": template_meta,
        "shape": np.asarray(shape_rows, dtype=float),
        "trajectory": np.asarray(trajectory_rows, dtype=float),
        "motion": np.asarray(motions, dtype=float),
        "y_true": np.asarray(
            [int(sample.class_name == "SIM") for sample in samples], dtype=int
        ),
        "sample_features": sample_features,
        "template_features": template_features,
    }


def tune_on_validation(
    validation_samples: Sequence[Sample],
    templates: Sequence[Sample],
    thresholds: Sequence[float] | None = None,
    hand_shape_weights: Sequence[float] = (0.25, 0.5, 0.75),
    motion_gates: Sequence[float] = (0, 0.005, 0.01, 0.015, 0.018, 0.02, 0.025, 0.03, 0.04),
    window_ratio: float = config.DTW_WINDOW_RATIO,
    max_frames: int = config.MAX_MATCH_FRAMES,
) -> tuple[config.MatchConfiguration, pd.DataFrame]:
    """Reproduce the TypeScript validation-only grid search.

    The test split is never touched here.
    """

    if thresholds is None:
        thresholds = tuple(np.round(np.arange(0.50, 0.96, 0.01), 2))
    base = config.MatchConfiguration(
        name="grid",
        threshold=0.5,
        min_motion=0.0,
        hand_shape_weight=0.5,
        hand_trajectory_weight=0.5,
        window_ratio=window_ratio,
        max_frames=max_frames,
    )
    matrices = precompute_score_matrices(validation_samples, templates, base)
    rows: list[dict[str, Any]] = []
    for weight in hand_shape_weights:
        combined = _combined_matrix(matrices["shape"], matrices["trajectory"], weight)
        best_scores = np.nanmax(combined, axis=1)
        for gate in motion_gates:
            gate_mask = matrices["motion"] >= gate
            for threshold in thresholds:
                predicted = ((best_scores >= threshold) & gate_mask).astype(int)
                metrics = classification_metrics(matrices["y_true"], predicted)
                rows.append(
                    {
                        "hand_shape_weight": float(weight),
                        "hand_trajectory_weight": float(1 - weight),
                        "min_motion": float(gate),
                        "threshold": float(threshold),
                        **metrics,
                    }
                )
    grid = pd.DataFrame.from_records(rows)
    # Descending tie-break exactly as in libras-eqt-validation.test.ts.
    grid = grid.sort_values(
        [
            "balanced_accuracy",
            "specificity",
            "recall",
            "threshold",
            "min_motion",
        ],
        ascending=[False, False, False, False, False],
        kind="stable",
    ).reset_index(drop=True)
    best = grid.iloc[0]
    configuration = config.MatchConfiguration(
        name="validation-selected",
        threshold=float(best["threshold"]),
        min_motion=float(best["min_motion"]),
        hand_shape_weight=float(best["hand_shape_weight"]),
        hand_trajectory_weight=float(best["hand_trajectory_weight"]),
        window_ratio=window_ratio,
        max_frames=max_frames,
    )
    return configuration, grid


def configuration_from_prior(prior: dict[str, Any]) -> config.MatchConfiguration:
    selected = prior["validationSelected"]
    weights = selected["weights"]
    return config.MatchConfiguration(
        name="validation-selected",
        threshold=float(selected["threshold"]),
        min_motion=float(selected["minMotion"]),
        hand_shape_weight=float(weights["handShape"]),
        hand_trajectory_weight=float(weights["handTrajectory"]),
        window_ratio=config.DTW_WINDOW_RATIO,
        max_frames=config.MAX_MATCH_FRAMES,
    )


# ---------------------------------------------------------------------------
# Parity checks
# ---------------------------------------------------------------------------


def parity_with_prior_results(
    dataset: "loaders.PeterDataset",
) -> pd.DataFrame:
    """Compare Python scores to the TypeScript report for the test split.

    Returns one row per configuration/sample with absolute score deltas.
    """

    from . import loaders  # local import avoids a circular import at module load

    prior = dataset.prior_results
    if not prior:
        return pd.DataFrame()
    configurations = []
    for item in prior.get("configurations", []):
        weights = item["weights"]
        configurations.append(
            config.MatchConfiguration(
                name=str(item["name"]),
                threshold=float(item["threshold"]),
                min_motion=float(item["minMotion"]),
                hand_shape_weight=float(weights["handShape"]),
                hand_trajectory_weight=float(weights["handTrajectory"]),
                window_ratio=config.DTW_WINDOW_RATIO,
                max_frames=config.MAX_MATCH_FRAMES,
            )
        )
    rows: list[dict[str, Any]] = []
    for configuration in configurations:
        scored = score_samples(dataset.evaluation, dataset.templates, configuration)
        scored = scored[scored["dataset_split"] == "test"].set_index("sample_id")
        previous = {
            item["sampleId"]: item for item in prior["configurations"][
                [c.name for c in configurations].index(configuration.name)
            ]["diagnostics"]
        }
        for sample_id, record in scored.iterrows():
            reference = previous.get(sample_id)
            if reference is None:
                continue
            rows.append(
                {
                    "configuration": configuration.name,
                    "sample_id": sample_id,
                    "python_score": float(record["best_score"]),
                    "typescript_score": float(reference["dtwScore"]),
                    "absolute_delta": abs(
                        float(record["best_score"]) - float(reference["dtwScore"])
                    ),
                    "python_shape": float(record["best_hand_shape_score"]),
                    "typescript_shape": float(reference["handShapeScore"]),
                    "python_trajectory": record["best_hand_trajectory_score"],
                    "typescript_trajectory": reference["handTrajectoryScore"],
                    "python_motion": float(record["motion_energy"]),
                    "typescript_motion": float(reference["motionEnergy"]),
                }
            )
    return pd.DataFrame.from_records(rows)


# ---------------------------------------------------------------------------
# Experimental comparisons
# ---------------------------------------------------------------------------


def weight_ablation_configurations(
    base: config.MatchConfiguration,
) -> list[config.MatchConfiguration]:
    configurations = []
    for weight in (0.0, 0.25, 0.5, 0.75, 1.0):
        configurations.append(
            config.MatchConfiguration(
                name=f"weight-shape-{weight:.2f}",
                threshold=base.threshold,
                min_motion=base.min_motion,
                hand_shape_weight=weight,
                hand_trajectory_weight=1 - weight,
                window_ratio=base.window_ratio,
                max_frames=base.max_frames,
                min_score_margin=base.min_score_margin,
                top_k=base.top_k,
            )
        )
    return configurations


def visibility_effect_table(scored: pd.DataFrame) -> pd.DataFrame:
    """Correlation between metadata coverage and best DTW score."""

    rows = []
    for split, group in scored.groupby("dataset_split"):
        valid = group.dropna(subset=["hand_visibility", "best_score"])
        if len(valid) < 3:
            continue
        correlation = valid["hand_visibility"].corr(valid["best_score"])
        rows.append(
            {
                "dataset_split": split,
                "n": len(valid),
                "pearson_hand_visibility_vs_score": float(correlation),
            }
        )
    return pd.DataFrame.from_records(rows)


def pairwise_dtw_matrix(
    samples: Sequence[Sample],
    features: dict[str, FeatureBundle],
    feature: str = "hand_shape",
) -> pd.DataFrame:
    """Symmetric DTW similarity matrix for a group of samples."""

    ids = [sample.sample_id for sample in samples]
    matrix = np.eye(len(ids), dtype=float)
    for i, left_id in enumerate(ids):
        for j in range(i + 1, len(ids)):
            right_id = ids[j]
            a = getattr(features[left_id], feature)
            b = getattr(features[right_id], feature)
            score = dtw_similarity(a, b)
            matrix[i, j] = score
            matrix[j, i] = score
    return pd.DataFrame(matrix, index=ids, columns=ids)


def within_between_informant_distances(
    samples: Sequence[Sample],
    features: dict[str, FeatureBundle],
    feature: str = "hand_shape",
) -> pd.DataFrame:
    """Mean DTW distance for same-informant vs different-informant pairs."""

    rows = []
    for i, left in enumerate(samples):
        for right in samples[i + 1 :]:
            distance = dtw_distance(
                getattr(features[left.sample_id], feature),
                getattr(features[right.sample_id], feature),
            )
            rows.append(
                {
                    "sample_a": left.sample_id,
                    "sample_b": right.sample_id,
                    "informant_a": left.informant_id,
                    "informant_b": right.informant_id,
                    "same_informant": left.informant_id == right.informant_id,
                    "same_split": left.split == right.split,
                    "feature": feature,
                    "distance": distance,
                }
            )
    return pd.DataFrame.from_records(rows)


def bootstrap_dtw_distance(
    a: Array,
    b: Array,
    n_bootstrap: int = 200,
    seed: int = 2026,
) -> dict[str, float]:
    """Frame-resampling bootstrap of the DTW distance (descriptive only).

    DTW is not a statistic with a simple sampling distribution; this interval
    communicates temporal sensitivity, not population uncertainty.
    """

    rng = np.random.default_rng(seed)
    values = []
    for _ in range(n_bootstrap):
        indices_a = np.sort(rng.integers(0, len(a), len(a)))
        indices_b = np.sort(rng.integers(0, len(b), len(b)))
        values.append(dtw_distance(a[indices_a], b[indices_b]))
    return {
        "low": float(np.percentile(values, 2.5)),
        "high": float(np.percentile(values, 97.5)),
        "samples": len(values),
    }

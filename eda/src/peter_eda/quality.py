"""Data-quality and coverage diagnostics.

These functions quantify problems without dropping or imputing samples.  The
goal is to document impact, not to clean the original data silently.
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable

import numpy as np
import pandas as pd

from . import config
from .loaders import Sample
from .manifest import coverage_from_stored_frames, sequence_sha256


def _frame_array(frame: dict[str, Any]) -> np.ndarray:
    joints = frame.get("joints", {})
    rows = []
    for joint in config.CANONICAL_JOINTS:
        point = joints.get(joint)
        if point is None:
            rows.append([np.nan, np.nan, np.nan, 0.0])
        else:
            rows.append(
                [
                    float(point.get("x", np.nan)),
                    float(point.get("y", np.nan)),
                    float(point.get("z", np.nan)),
                    float(point.get("visibility", 1.0)),
                ]
            )
    return np.asarray(rows, dtype=float)


def _frame_digest(array: np.ndarray) -> str:
    return hashlib.sha256(np.round(array, 9).tobytes()).hexdigest()


def _visible(array: np.ndarray) -> np.ndarray:
    return array[:, 3] >= config.MIN_VISIBILITY


def frame_quality_table(samples: Iterable[Sample]) -> pd.DataFrame:
    """One row per sample with structural, numeric and visibility checks."""

    records: list[dict[str, Any]] = []
    for sample in samples:
        arrays = [_frame_array(frame) for frame in sample.frames]
        timestamps = np.asarray(
            [float(frame.get("timestamp", np.nan)) for frame in sample.frames]
        )
        visible_counts = np.asarray([int(_visible(a).sum()) for a in arrays])
        any_hand = []
        both_hands = []
        left_hand = []
        right_hand = []
        left_wrist = []
        right_wrist = []
        shoulders = []
        for array in arrays:
            visibility = _visible(array)
            # CANONICAL_JOINTS: 0-12 body, 13 left wrist, 14 right wrist,
            # 15-34 left fingers, 35-54 right fingers.
            left_hand_visible = bool(visibility[13] or visibility[15:35].any())
            right_hand_visible = bool(visibility[14] or visibility[35:55].any())
            any_hand.append(left_hand_visible or right_hand_visible)
            both_hands.append(left_hand_visible and right_hand_visible)
            left_hand.append(left_hand_visible)
            right_hand.append(right_hand_visible)
            left_wrist.append(bool(visibility[13]))
            right_wrist.append(bool(visibility[14]))
            shoulders.append(bool(visibility[1] and visibility[2]))

        digest = sequence_sha256(sample.frames)
        adjacent_duplicates = sum(
            _frame_digest(current) == _frame_digest(previous)
            for previous, current in zip(arrays, arrays[1:])
        )
        approx_hand, approx_pose = coverage_from_stored_frames(sample.frames)
        finite = np.isfinite(np.concatenate([a[:, :3].ravel() for a in arrays])) if arrays else np.array([], dtype=bool)
        nan_count = int(np.isnan(np.concatenate([a[:, :3].ravel() for a in arrays])).sum()) if arrays else 0
        inf_count = int(np.isinf(np.concatenate([a[:, :3].ravel() for a in arrays])).sum()) if arrays else 0
        missing_slots = sum(
            config.LANDMARK_COUNT - len(frame.get("joints", {}))
            for frame in sample.frames
        )
        steps = np.diff(timestamps)
        records.append(
            {
                "sample_id": sample.sample_id,
                "class_name": sample.class_name,
                "informant_id": sample.informant_id,
                "informant": sample.informant,
                "dataset_split": sample.split,
                "dataset_role": sample.role,
                "frame_count": sample.frame_count,
                "landmark_count": config.LANDMARK_COUNT,
                "missing_joint_slots": int(missing_slots),
                "nan_values": nan_count,
                "inf_values": inf_count,
                "all_coordinates_finite": bool(finite.all()) if finite.size else True,
                "visible_joints_mean": float(visible_counts.mean()) if len(visible_counts) else 0.0,
                "visible_ratio_mean": (
                    float(visible_counts.mean() / config.LANDMARK_COUNT)
                    if len(visible_counts)
                    else 0.0
                ),
                "any_hand_frames": int(sum(any_hand)),
                "both_hands_frames": int(sum(both_hands)),
                "left_hand_frames": int(sum(left_hand)),
                "right_hand_frames": int(sum(right_hand)),
                "left_wrist_frames": int(sum(left_wrist)),
                "right_wrist_frames": int(sum(right_wrist)),
                "shoulder_frames": int(sum(shoulders)),
                "all_zero_frames": int((visible_counts == 0).sum()),
                "low_visibility_frames": int((~np.asarray(any_hand)).sum()),
                "hand_coverage_stored_frames": approx_hand,
                "pose_coverage_stored_frames": approx_pose,
                "hand_coverage_metadata": sample.hand_visibility,
                "pose_coverage_metadata": sample.pose_visibility,
                "timestamp_monotonic": bool(
                    len(timestamps) > 1 and np.all(np.diff(timestamps) > 0)
                ),
                "timestamp_step_ms_median": (
                    float(np.nanmedian(steps)) if len(steps) else np.nan
                ),
                "sequence_span_seconds": (
                    float((timestamps[-1] - timestamps[0]) / 1000.0)
                    if len(timestamps) > 1
                    else np.nan
                ),
                "adjacent_duplicate_frames": int(adjacent_duplicates),
                "sha256": digest,
            }
        )
    return pd.DataFrame.from_records(records)


def duplicate_groups(frame_quality: pd.DataFrame) -> pd.DataFrame:
    """Return only content hashes that occur more than once."""

    counts = (
        frame_quality.groupby("sha256")
        .agg(
            occurrences=("sample_id", "count"),
            sample_ids=("sample_id", lambda values: ";".join(sorted(values))),
        )
        .reset_index()
    )
    return counts[counts["occurrences"] > 1].sort_values(
        ["occurrences", "sample_ids"], ascending=[False, True]
    )


def low_visibility_frames(
    samples: Iterable[Sample], max_visible_hands: int = 0
) -> pd.DataFrame:
    """Per-frame rows where the number of visible hands is at or below a limit."""

    records: list[dict[str, Any]] = []
    for sample in samples:
        for index, frame in enumerate(sample.frames):
            array = _frame_array(frame)
            visibility = _visible(array)
            left = bool(visibility[14:35].any())
            right = bool(visibility[35:55].any())
            hand_count = int(left) + int(right)
            if hand_count <= max_visible_hands:
                records.append(
                    {
                        "sample_id": sample.sample_id,
                        "class_name": sample.class_name,
                        "informant_id": sample.informant_id,
                        "dataset_split": sample.split,
                        "frame_index": index,
                        "timestamp": frame.get("timestamp"),
                        "left_hand_visible": left,
                        "right_hand_visible": right,
                        "visible_joints": int(visibility.sum()),
                        "visible_ratio": float(visibility.sum() / config.LANDMARK_COUNT),
                    }
                )
    return pd.DataFrame.from_records(records)


def quality_by_group(frame_quality: pd.DataFrame) -> pd.DataFrame:
    """Mean quality indicators by split, class and informant."""

    grouped = (
        frame_quality.groupby(
            ["dataset_split", "dataset_role", "class_name", "informant_id"],
            dropna=False,
        )
        .agg(
            samples=("sample_id", "count"),
            frame_count_mean=("frame_count", "mean"),
            visible_ratio_mean=("visible_ratio_mean", "mean"),
            any_hand_frames_mean=("any_hand_frames", "mean"),
            both_hands_frames_mean=("both_hands_frames", "mean"),
            low_visibility_frames_mean=("low_visibility_frames", "mean"),
            adjacent_duplicate_frames_sum=("adjacent_duplicate_frames", "sum"),
            hand_coverage_metadata_mean=("hand_coverage_metadata", "mean"),
            hand_coverage_stored_mean=("hand_coverage_stored_frames", "mean"),
            pose_coverage_metadata_mean=("pose_coverage_metadata", "mean"),
        )
        .reset_index()
    )
    return grouped.sort_values(
        ["dataset_split", "dataset_role", "class_name", "informant_id"],
        kind="stable",
    )


def missing_value_table(frame_quality: pd.DataFrame) -> pd.DataFrame:
    """Count missing values in the manifest-like quality table."""

    rows = []
    for column in frame_quality.columns:
        missing = int(frame_quality[column].isna().sum())
        rows.append(
            {
                "column": column,
                "missing": missing,
                "total": len(frame_quality),
                "missing_ratio": missing / len(frame_quality) if len(frame_quality) else 0.0,
            }
        )
    return pd.DataFrame(rows)


def quality_report_markdown(
    manifest: pd.DataFrame,
    frame_quality: pd.DataFrame,
    duplicates: pd.DataFrame,
    low_visibility: pd.DataFrame,
) -> str:
    """Human-readable summary used in ``outputs/reports``."""

    lines = [
        "# Relatório de qualidade e cobertura — Peter EDA",
        "",
        "> Gerado automaticamente por `peter_eda.quality`. "
        "Nenhuma amostra foi descartada ou imputada.",
        "",
        "## Inventário analisado",
        "",
        f"- Amostras ativas no manifesto: **{len(manifest)}**",
        f"- Templates de treino: **{(manifest['dataset_role'] == 'template').sum()}**",
        f"- Amostras de validação: **{(manifest['dataset_split'] == 'validation').sum()}**",
        f"- Amostras de teste: **{(manifest['dataset_split'] == 'test').sum()}**",
        "",
        "## Integridade estrutural",
        "",
        f"- Sequências com comprimento diferente de 16 frames: "
        f"**{int((frame_quality['frame_count'] != 16).sum())}**",
        f"- Sequências com valores NaN: **{int((frame_quality['nan_values'] > 0).sum())}**",
        f"- Sequências com valores infinitos: **{int((frame_quality['inf_values'] > 0).sum())}**",
        f"- Sequências com slots de articulação ausentes: "
        f"**{int((frame_quality['missing_joint_slots'] > 0).sum())}**",
        f"- Sequências com timestamps não monotônicos: "
        f"**{int((~frame_quality['timestamp_monotonic']).sum())}**",
        "",
        "## Duplicatas",
        "",
        f"- Grupos de conteúdo duplicado: **{len(duplicates)}**",
    ]
    if len(duplicates):
        for row in duplicates.itertuples(index=False):
            lines.append(f"  - `{row.sha256[:16]}…` → {row.sample_ids} ({row.occurrences}×)")
    else:
        lines.append("- Nenhuma sequência com conteúdo idêntico foi encontrada.")
    lines.extend(
        [
            "",
            "## Cobertura das mãos",
            "",
            "| Recorte | n | handCoverage médio | frames sem mão (média) |",
            "|---|---:|---:|---:|",
        ]
    )
    coverage = (
        frame_quality.groupby(["dataset_split", "class_name"], dropna=False)
        .agg(
            n=("sample_id", "count"),
            coverage=("hand_coverage_metadata", "mean"),
            no_hand=("low_visibility_frames", "mean"),
        )
        .reset_index()
    )
    for row in coverage.itertuples(index=False):
        lines.append(
            f"| {row.dataset_split} / {row.class_name} | {row.n} | "
            f"{row.coverage:.3f} | {row.no_hand:.2f} |"
        )
    lines.extend(
        [
            "",
            "## Frames com baixa visibilidade",
            "",
            f"- Frames sem nenhuma mão visível: **{len(low_visibility)}**",
            "",
            "## Limitações",
            "",
            "- A cobertura oficial é calculada antes do downsampling para 16 frames; "
            "o valor recalculado nos frames armazenados é apenas uma aproximação.",
            "- A ausência de vídeos no ZIP impede recalcular landmarks brutos, "
            "reavaliar a extração ou medir oclusão real fora dos 16 frames.",
            "- Valores ausentes não foram imputados; qualquer comparação entre grupos "
            "carrega a incerteza de amostras muito pequenas (6 positivos por split).",
            "",
        ]
    )
    return "\n".join(lines)

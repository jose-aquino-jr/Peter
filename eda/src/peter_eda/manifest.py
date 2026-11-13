"""Build a consolidated, filterable manifest of every active sample."""

from __future__ import annotations

import hashlib
import struct
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

from . import config
from .loaders import PeterDataset, Sample, normalise_informant

MANIFEST_COLUMNS = [
    "sample_id",
    "class_name",
    "class_label_pt",
    "informant_id",
    "informant",
    "dataset_split",
    "dataset_role",
    "file_path",
    "source_entry",
    "frame_count",
    "fps",
    "landmark_count",
    "visible_landmark_ratio",
    "hand_visibility",
    "hand_visibility_source",
    "pose_visibility",
    "pose_visibility_source",
    "duration_seconds",
    "duration_source",
    "sequence_span_seconds",
    "timestamp_step_ms",
    "sha256",
    "source_file_sha256",
    "representation",
    "is_template",
    "notes",
]

CLASS_LABELS_PT = {"SIM": "SIM", "CAIR": "CAIR", "LUZ": "LUZ", "JA": "JÁ"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sequence_sha256(frames: Iterable[dict[str, Any]]) -> str:
    """Stable hash of the canonical sequence content.

    Joint order is fixed and both values and presence are encoded, so a
    missing joint is not confused with an explicit coordinate zero.
    """

    digest = hashlib.sha256()
    for frame in frames:
        joints = frame.get("joints", {})
        for joint in config.CANONICAL_JOINTS:
            point = joints.get(joint)
            if point is None:
                digest.update(b"\x00")
                continue
            digest.update(b"\x01")
            digest.update(
                struct.pack(
                    "<dddd",
                    float(point.get("x", np.nan)),
                    float(point.get("y", np.nan)),
                    float(point.get("z", np.nan)),
                    float(point.get("visibility", 1.0)),
                )
            )
    return digest.hexdigest()


def _is_visible(point: dict[str, Any] | None, threshold: float = config.MIN_VISIBILITY) -> bool:
    return bool(point) and float(point.get("visibility", 1.0)) >= threshold


def coverage_from_stored_frames(frames: Iterable[dict[str, Any]]) -> tuple[float, float]:
    """Approximate hand/shoulder coverage using the stored 16 frames.

    The original extractor computes coverage on every sampled source frame
    *before* downsampling.  That denominator is not stored.  This function is
    therefore an approximation and is only used when the official metadata is
    absent; the manifest records which source was used.
    """

    total = 0
    hand_frames = 0
    shoulder_frames = 0
    for frame in frames:
        total += 1
        joints = frame.get("joints", {})
        hand_visible = any(
            _is_visible(joints.get(joint))
            for joint in config.CANONICAL_JOINTS
            if joint.startswith(("leftHand", "rightHand", "leftThumb", "leftIndex",
                                  "leftMiddle", "leftRing", "leftPinky", "rightThumb",
                                  "rightIndex", "rightMiddle", "rightRing", "rightPinky"))
        )
        shoulder_visible = _is_visible(joints.get("leftShoulder")) and _is_visible(
            joints.get("rightShoulder")
        )
        hand_frames += int(hand_visible)
        shoulder_frames += int(shoulder_visible)
    if total == 0:
        return float("nan"), float("nan")
    return hand_frames / total, shoulder_frames / total


def visible_landmark_ratio(frames: Iterable[dict[str, Any]]) -> float:
    ratios: list[float] = []
    for frame in frames:
        joints = frame.get("joints", {})
        visible = sum(
            1 for joint in config.CANONICAL_JOINTS if _is_visible(joints.get(joint))
        )
        ratios.append(visible / config.LANDMARK_COUNT)
    return float(np.mean(ratios)) if ratios else float("nan")


def timestamp_step_ms(frames: Iterable[dict[str, Any]]) -> float | None:
    timestamps = [float(frame.get("timestamp", np.nan)) for frame in frames]
    if len(timestamps) < 2:
        return None
    steps = np.diff(timestamps)
    finite = steps[np.isfinite(steps)]
    return float(np.median(finite)) if finite.size else None


def _record_from_sample(sample: Sample, file_hashes: dict[Path, str]) -> dict[str, Any]:
    approx_hand, approx_pose = coverage_from_stored_frames(sample.frames)
    if sample.hand_visibility is not None:
        hand_visibility = sample.hand_visibility
        hand_source = "metadados do arquivo original"
    else:
        hand_visibility = approx_hand
        hand_source = "estimada nos 16 frames armazenados (aproximada)"

    if sample.pose_visibility is not None:
        pose_visibility = sample.pose_visibility
        pose_source = "metadados do arquivo original"
    else:
        pose_visibility = approx_pose
        pose_source = "estimada nos 16 frames armazenados (aproximada)"

    if sample.duration_seconds is not None:
        duration = sample.duration_seconds
        duration_source = "metadados do arquivo original"
    else:
        duration = None
        duration_source = "ausente"

    timestamps = [float(frame.get("timestamp", np.nan)) for frame in sample.frames]
    span_seconds = (
        (max(timestamps) - min(timestamps)) / 1000.0
        if len(timestamps) > 1 and np.isfinite(timestamps).all()
        else None
    )

    display_informant, _ = normalise_informant(sample.informant)
    relative_path = (
        str(sample.file_path.relative_to(config.PROJECT_ROOT))
        if sample.file_path.is_relative_to(config.PROJECT_ROOT)
        else str(sample.file_path)
    )
    source_hash = file_hashes.get(sample.file_path) or sha256_file(sample.file_path)

    notes = []
    if sample.is_template and sample.source_entry:
        notes.append("template; vídeo de origem não incluído no ZIP")
    if not sample.is_template:
        notes.append("amostra embutida no fixture JSON; vídeo de origem não incluído no ZIP")
    if sample.class_name == "JA":
        notes.append("rótulo do arquivo é 'JA'; a documentação usa 'JÁ'")
    if (sample.metadata or {}).get("informant"):
        notes.append("informante é rótulo local do item, não identidade física comprovada")

    return {
        "sample_id": sample.sample_id,
        "class_name": sample.class_name,
        "class_label_pt": CLASS_LABELS_PT.get(sample.class_name, sample.class_name),
        "informant_id": sample.informant_id,
        "informant": display_informant,
        "dataset_split": sample.split,
        "dataset_role": sample.role,
        "file_path": relative_path,
        "source_entry": sample.source_entry,
        "frame_count": sample.frame_count,
        "fps": sample.fps,
        "landmark_count": (
            len(sample.frames[0].get("joints", {})) if sample.frames else 0
        ),
        "visible_landmark_ratio": visible_landmark_ratio(sample.frames),
        "hand_visibility": hand_visibility,
        "hand_visibility_source": hand_source,
        "pose_visibility": pose_visibility,
        "pose_visibility_source": pose_source,
        "duration_seconds": duration,
        "duration_source": duration_source,
        "sequence_span_seconds": span_seconds,
        "timestamp_step_ms": timestamp_step_ms(sample.frames),
        "sha256": sequence_sha256(sample.frames),
        "source_file_sha256": source_hash,
        "representation": sample.representation,
        "is_template": sample.is_template,
        "notes": "; ".join(notes),
    }


_SPLIT_ORDER = {"train": 0, "validation": 1, "test": 2}
_ROLE_ORDER = {"template": 0, "positive": 1, "negative": 2}


def build_manifest(dataset: PeterDataset) -> pd.DataFrame:
    """Return the active manifest (18 templates + 48 evaluation samples)."""

    file_hashes: dict[Path, str] = {}
    for sample in dataset.active_samples:
        if sample.file_path not in file_hashes:
            file_hashes[sample.file_path] = sha256_file(sample.file_path)
    records = [_record_from_sample(sample, file_hashes) for sample in dataset.active_samples]
    frame = pd.DataFrame.from_records(records, columns=MANIFEST_COLUMNS)
    frame["_split_order"] = frame["dataset_split"].map(_SPLIT_ORDER).fillna(99)
    frame["_role_order"] = frame["dataset_role"].map(_ROLE_ORDER).fillna(99)
    frame = frame.sort_values(
        ["_split_order", "_role_order", "informant_id", "sample_id"],
        kind="stable",
    ).drop(columns=["_split_order", "_role_order"])
    return frame.reset_index(drop=True)


def filter_manifest(
    manifest: pd.DataFrame,
    class_name: str | None = None,
    informant_id: str | None = None,
    dataset_split: str | None = None,
) -> pd.DataFrame:
    """Filter the manifest by class, informant or split (all optional)."""

    filtered = manifest
    if class_name is not None:
        filtered = filtered[filtered["class_name"] == class_name]
    if informant_id is not None:
        filtered = filtered[filtered["informant_id"].astype(str) == str(informant_id)]
    if dataset_split is not None:
        filtered = filtered[filtered["dataset_split"] == dataset_split]
    return filtered.reset_index(drop=True)


def manifest_summary(manifest: pd.DataFrame) -> pd.DataFrame:
    """Counts by split, class, role and informant."""

    summary = (
        manifest.groupby(
            ["dataset_split", "dataset_role", "class_name", "informant_id"],
            dropna=False,
        )
        .agg(
            samples=("sample_id", "count"),
            frame_count_mean=("frame_count", "mean"),
            duration_mean_s=("duration_seconds", "mean"),
            hand_visibility_mean=("hand_visibility", "mean"),
            pose_visibility_mean=("pose_visibility", "mean"),
        )
        .reset_index()
    )
    return summary.sort_values(
        ["dataset_split", "dataset_role", "class_name", "informant_id"],
        kind="stable",
    )


def write_manifest(manifest: pd.DataFrame, path: Path | None = None) -> Path:
    path = path or config.output_path("table", "manifest.csv")
    manifest.to_csv(path, index=False, encoding="utf-8")
    return path


def write_manifest_summary(summary: pd.DataFrame, path: Path | None = None) -> Path:
    path = path or config.output_path("table", "manifest_summary.csv")
    summary.to_csv(path, index=False, encoding="utf-8")
    return path

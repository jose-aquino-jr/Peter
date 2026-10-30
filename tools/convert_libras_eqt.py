#!/usr/bin/env python3
"""Convert LIBRAS-EQT-UECE hand landmarks to Peter Canonical Skeleton v1."""

from __future__ import annotations

import argparse
import ast
import json
import math
import struct
import zipfile
from pathlib import Path
from typing import Any

DATASET = "LIBRAS-EQT-UECE"
RECORD = "https://zenodo.org/records/21398895"
DOI = "10.5281/zenodo.21398895"
LICENSE = "CC BY-NC 4.0"
ATTRIBUTION = "LIBRAS-EQT-UECE Authors (2026)"
LANDMARKS_ROOT = "Landmarks/Libras-EQT-UECE (Landmarks)"
HANDS_ROOT = "Landmarks/Libras-EQT-UECE (Hand Landmarks)"
HAND_BOUNDS_NORMALIZATION = "hand-bounds-v1"
MAX_TEMPLATE_FRAMES = 16
HAND_COUNT = 21
FULL_POINT_COUNT = 106
HAND_POINT_COUNT = 42
HAND_OFFSETS = {"left": 64, "right": 85}
FINGERS = (("Thumb", 1), ("Index", 5), ("Middle", 9), ("Ring", 13), ("Pinky", 17))


def read_npy(data: bytes, entry: str) -> list[list[tuple[float, float, float]]]:
    if data[:6] != b"\x93NUMPY" or len(data) < 10:
        raise ValueError(f"{entry}: arquivo NPY inválido.")

    major = data[6]
    if major == 1:
        header_start = 10
        header_length = struct.unpack_from("<H", data, 8)[0]
        encoding = "latin1"
    elif major in (2, 3):
        header_start = 12
        header_length = struct.unpack_from("<I", data, 8)[0]
        encoding = "utf-8" if major == 3 else "latin1"
    else:
        raise ValueError(f"{entry}: versão NPY não suportada: {major}.")

    header_end = header_start + header_length
    header = ast.literal_eval(data[header_start:header_end].decode(encoding).strip())
    if header.get("descr") not in ("<f4", "=f4", "|f4") or header.get("fortran_order"):
        raise ValueError(f"{entry}: esperado float32 little-endian em ordem C.")
    shape = header.get("shape")
    if not isinstance(shape, tuple) or len(shape) != 2 or shape[1] % 3 != 0:
        raise ValueError(f"{entry}: esperado matriz N x 3K.")

    rows, columns = shape
    point_count = columns // 3
    payload = data[header_end:]
    value_count = rows * columns
    if len(payload) != value_count * 4:
        raise ValueError(f"{entry}: tamanho incompatível com o cabeçalho NPY.")
    values = struct.unpack(f"<{value_count}f", payload)
    frames: list[list[tuple[float, float, float]]] = []
    for row in range(rows):
        start = row * columns
        points = [
            (values[start + index], values[start + index + 1], values[start + index + 2])
            for index in range(0, columns, 3)
        ]
        if not all(math.isfinite(value) for point in points for value in point):
            raise ValueError(f"{entry}: coordenada não finita no frame {row}.")
        frames.append(points)
    if point_count == 0:
        raise ValueError(f"{entry}: matriz sem landmarks.")
    return frames


def hand_is_present(points: list[tuple[float, float, float]]) -> bool:
    return (
        len(points) == HAND_COUNT
        and len(set(points)) > 1
        and any(abs(value) > 1e-8 for point in points for value in point)
    )


def verify_hand_pair(
    full_frames: list[list[tuple[float, float, float]]],
    hand_frames: list[list[tuple[float, float, float]]],
    full_entry: str,
    hand_entry: str,
) -> None:
    if (
        not full_frames
        or len(full_frames[0]) != FULL_POINT_COUNT
        or len(hand_frames) != len(full_frames)
        or len(hand_frames[0]) != HAND_POINT_COUNT
    ):
        raise ValueError(
            f"{full_entry}: esperado N x 106 completo e N x 42 de mãos; "
            f"recebido {len(full_frames)} x {len(full_frames[0]) if full_frames else 0} "
            f"e {len(hand_frames)} x {len(hand_frames[0]) if hand_frames else 0}."
        )
    for frame_index, (full, hands) in enumerate(zip(full_frames, hand_frames)):
        if any(
            abs(left - right) > 1e-6
            for full_point, hand_point in zip(full[64:106], hands)
            for left, right in zip(full_point, hand_point)
        ):
            raise ValueError(
                f"{full_entry}: os 42 landmarks não coincidem com {hand_entry} "
                f"no frame {frame_index}."
            )


def source_samples(archive: zipfile.ZipFile, class_name: str) -> list[str]:
    prefix = f"{LANDMARKS_ROOT}/{class_name}/"
    return sorted(
        name
        for name in archive.namelist()
        if name.startswith(prefix) and name.lower().endswith(".npy")
    )


def active_sides(frames: list[list[tuple[float, float, float]]]) -> dict[str, int]:
    return {
        side: sum(
            hand_is_present(frame[offset : offset + HAND_COUNT])
            for frame in frames
        )
        for side, offset in HAND_OFFSETS.items()
    }


def selected_sides(
    frames: list[list[tuple[float, float, float]]],
    entry: str,
) -> tuple[str, ...]:
    counts = active_sides(frames)
    maximum = max(counts.values(), default=0)
    if maximum == 0:
        raise ValueError(f"{entry}: nenhum dos dois grupos de mãos está presente.")
    selected = tuple(
        side for side, count in counts.items()
        if count >= max(2, math.ceil(maximum * 0.8))
    )
    if not selected:
        raise ValueError(f"{entry}: não foi possível identificar uma mão ativa.")
    return selected


def trim_to_detected_span(
    frames: list[list[tuple[float, float, float]]],
    sides: tuple[str, ...],
    entry: str,
) -> tuple[int, int]:
    offsets = [HAND_OFFSETS[side] for side in sides]
    active = [
        any(hand_is_present(frame[offset : offset + HAND_COUNT]) for offset in offsets)
        for frame in frames
    ]
    indices = [index for index, present in enumerate(active) if present]
    if len(indices) < 2:
        raise ValueError(f"{entry}: menos de dois frames com landmarks de mão.")
    first, last = indices[0], indices[-1]
    return first, last + 1


def joint_names(side: str) -> list[str]:
    names = [f"{side}HandWrist"]
    for finger, _ in FINGERS:
        names.extend(f"{side}{finger}{joint}" for joint in range(1, 5))
    return names


def resample_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(frames) <= MAX_TEMPLATE_FRAMES:
        return frames
    last_index = len(frames) - 1
    return [
        frames[math.floor(index * last_index / (MAX_TEMPLATE_FRAMES - 1) + 0.5)]
        for index in range(MAX_TEMPLATE_FRAMES)
    ]


def map_and_normalize(
    frame_points: list[tuple[float, float, float]],
    source_sides: tuple[str, ...],
    timestamp: int,
) -> dict[str, Any]:
    joints: dict[str, dict[str, float | int]] = {}
    for side in source_sides:
        offset = HAND_OFFSETS[side]
        points = frame_points[offset : offset + HAND_COUNT]
        if hand_is_present(points):
            joints[f"{side}HandWrist"] = camera_axes(points[0])
            for finger, start in FINGERS:
                for joint in range(4):
                    joints[f"{side}{finger}{joint + 1}"] = camera_axes(points[start + joint])
        else:
            joints[f"{side}HandWrist"] = missing_point()
            for finger, _ in FINGERS:
                for joint in range(1, 5):
                    joints[f"{side}{finger}{joint}"] = missing_point()

    origin, scale = point_cloud_bounds(list(joints.values()))
    normalized = {
        name: {
            "x": (point["x"] - origin[0]) / scale,
            "y": (point["y"] - origin[1]) / scale,
            "z": (point["z"] - origin[2]) / scale,
            "visibility": 1,
        }
        for name, point in joints.items()
    }
    return {"timestamp": timestamp, "joints": normalized}


def camera_axes(point: tuple[float, float, float]) -> dict[str, float]:
    return {"x": point[0], "y": -point[1], "z": -point[2], "visibility": 1}


def point_cloud_bounds(
    points: list[dict[str, float | int]],
) -> tuple[tuple[float, float, float], float]:
    points = [point for point in points if point.get("visibility", 1) != 0]
    if not points:
        return (0.0, 0.0, 0.0), 1.0
    mins = [min(point[axis] for point in points) for axis in ("x", "y", "z")]
    maxs = [max(point[axis] for point in points) for axis in ("x", "y", "z")]
    origin = tuple((minimum + maximum) / 2 for minimum, maximum in zip(mins, maxs))
    scale = max(
        max(maximum - minimum for minimum, maximum in zip(mins, maxs)),
        0.04,
    )
    return origin, scale


def missing_point() -> dict[str, float | int]:
    return {"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0}


def source_hand_frame(
    points: list[tuple[float, float, float]],
    sides: tuple[str, ...],
    timestamp: int,
) -> dict[str, Any]:
    frame: dict[str, Any] = {"timestamp": timestamp, "leftHand": [], "rightHand": []}
    for side in sides:
        offset = HAND_OFFSETS[side]
        hand = points[offset : offset + HAND_COUNT]
        if hand_is_present(hand):
            frame[f"{side}Hand"] = [list(point) for point in hand]
    return frame


def prepare_sample(
    archive: zipfile.ZipFile,
    entry: str,
    normalized: bool,
) -> tuple[tuple[str, ...], list[dict[str, Any]], int]:
    hand_entry = entry.replace(LANDMARKS_ROOT, HANDS_ROOT, 1)
    if hand_entry not in archive.namelist():
        raise ValueError(f"{entry}: landmarks de mãos correspondentes ausentes.")
    full_frames = read_npy(archive.read(entry), entry)
    hand_frames = read_npy(archive.read(hand_entry), hand_entry)
    verify_hand_pair(full_frames, hand_frames, entry, hand_entry)
    sides = selected_sides(full_frames, entry)
    start, end = trim_to_detected_span(full_frames, sides, entry)
    sequence = [
        map_and_normalize(full_frames[index], sides, index)
        if normalized
        else source_hand_frame(full_frames[index], sides, index)
        for index in range(start, end)
    ]
    return sides, sequence, len(full_frames)


def informant_from_entry(entry: str) -> str:
    return entry.split("/")[-2]


def sample_id(gloss: str, entry: str) -> str:
    informant = informant_from_entry(entry).lower().replace(" ", "-")
    filename = Path(entry).stem.lower().replace("_", "-")
    return f"libras-eqt-v4-{gloss.lower()}-{informant}-{filename}"


def template_document(entry: str, sides: tuple[str, ...], frames: list[dict[str, Any]], source_count: int) -> dict[str, Any]:
    joints = [joint for side in sides for joint in joint_names(side)]
    stored_frames = resample_frames(frames)
    return {
        "version": 1,
        "id": sample_id("sim", entry),
        "name": "SIM",
        "gloss": "SIM",
        "frames": stored_frames,
        "duration": None,
        "fps": None,
        "relevantJoints": joints,
        "metadata": {
            "sourceDataset": DATASET,
            "sourceRecord": RECORD,
            "sourceDoi": DOI,
            "sourceEntry": entry,
            "sourceLicense": LICENSE,
            "attribution": ATTRIBUTION,
            "adaptation": "Converted from paired 106-point / 42-hand-point NPY matrices to hand-only Canonical Skeleton v1; camera axes and the shared bounds fallback normalization are applied. Unobserved hand frames remain marked invisible; no pose or points are synthesized.",
            "sourceNonHandPoints": "64 points retained by source but not mapped; names and semantics are undocumented.",
            "sourceHandGroupOrder": "first 21 points -> left, second 21 points -> right (inferred; dataset does not publish an index map).",
            "sourceFrameRate": "unknown; source NPY does not store timestamps or FPS.",
            "sourceFrameCount": str(source_count),
            "trimmedFrameRange": f"{frames[0]['timestamp']}..{frames[-1]['timestamp']}",
            "storedFrameCount": str(len(stored_frames)),
            "templateSampling": f"uniformly resampled to at most {MAX_TEMPLATE_FRAMES} frames, matching the runtime feature-vector limit.",
            "activeHands": ",".join(sides),
            "timebase": "source frame index; DTW uses ordered frames, not elapsed seconds.",
            "comparisonNormalization": HAND_BOUNDS_NORMALIZATION,
            "split": "train",
        },
    }


def evaluation_sample(
    gloss: str,
    entry: str,
    sides: tuple[str, ...],
    frames: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": sample_id(gloss, entry),
        "gloss": gloss.upper(),
        "sourceEntry": entry,
        "handSides": list(sides),
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True, help="Landmarks.zip baixado do Zenodo.")
    parser.add_argument(
        "--output-templates",
        type=Path,
        default=Path("src/vision/templates"),
        help="Pasta de templates offline do Peter.",
    )
    parser.add_argument(
        "--evaluation-output",
        type=Path,
        default=Path("src/vision/pipeline/fixtures/libras-eqt-validation.json"),
        help="Fixture isolado de avaliação; nunca importado pelo runtime.",
    )
    parser.add_argument(
        "--holdout-informant",
        default="INFORMANTE 5",
        help="Informante completamente reservado para teste.",
    )
    parser.add_argument("--negative-class", default="100_Cair")
    args = parser.parse_args()

    if not args.archive.is_file():
        parser.error(f"arquivo não encontrado: {args.archive}")

    args.output_templates.mkdir(parents=True, exist_ok=True)
    args.evaluation_output.parent.mkdir(parents=True, exist_ok=True)
    positive: list[dict[str, Any]] = []
    negative: list[dict[str, Any]] = []
    training_count = 0

    with zipfile.ZipFile(args.archive) as archive:
        positives = source_samples(archive, "2_Sim")
        if len(positives) < 2:
            raise ValueError(f"Esperados exemplos da classe isolada 2_Sim; encontrados {len(positives)}.")

        for entry in positives:
            informant = informant_from_entry(entry)
            if informant == args.holdout_informant:
                sides, frames, _ = prepare_sample(archive, entry, normalized=False)
                positive.append(evaluation_sample("SIM", entry, sides, frames))
                continue

            sides, frames, source_count = prepare_sample(archive, entry, normalized=True)
            document = template_document(entry, sides, frames, source_count)
            output = args.output_templates / f"{document['id']}.template.json"
            output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            training_count += 1

        negative_entries = [
            entry
            for entry in source_samples(archive, args.negative_class)
            if informant_from_entry(entry) == args.holdout_informant
        ]
        for entry in negative_entries:
            sides, frames, _ = prepare_sample(archive, entry, normalized=False)
            negative.append(evaluation_sample("CAIR", entry, sides, frames))

    if not positive:
        raise ValueError(f"Nenhum exemplo de teste para {args.holdout_informant}.")
    if not negative:
        raise ValueError(
            f"Nenhum exemplo negativo de {args.negative_class} para {args.holdout_informant}."
        )

    fixture = {
        "version": 1,
        "sourceDataset": DATASET,
        "sourceRecord": RECORD,
        "sourceDoi": DOI,
        "sourceLicense": LICENSE,
        "attribution": ATTRIBUTION,
        "split": {
            "targetClass": "2_Sim",
            "negativeClass": args.negative_class,
            "trainingInformants": "all except holdout",
            "holdoutInformant": args.holdout_informant,
            "trainingSamples": training_count,
        },
        "positive": positive,
        "negative": negative,
    }
    args.evaluation_output.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    print(f"Sign: SIM (2_Sim)")
    print(f"Training templates: {training_count}")
    print(f"Holdout informant: {args.holdout_informant}")
    print(f"Positive test samples: {len(positive)}")
    print(f"Negative test samples ({args.negative_class}): {len(negative)}")
    print("Mapped hand joints: up to 21 per selected hand")
    print("Body/pose landmarks: unavailable in this dataset")
    print("FPS / duration: unavailable; temporal order preserved by frame index")
    print(f"Template directory: {args.output_templates}")
    print(f"Evaluation fixture: {args.evaluation_output}")


if __name__ == "__main__":
    main()

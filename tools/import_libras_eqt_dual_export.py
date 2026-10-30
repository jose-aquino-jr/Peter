#!/usr/bin/env python3
"""Validate and install the browser-generated RGB landmark export."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

CANONICAL_JOINTS = (
    "head",
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
    "leftHip",
    "rightHip",
    "leftKnee",
    "rightKnee",
    "leftAnkle",
    "rightAnkle",
    "leftHandWrist",
    "rightHandWrist",
    *(
        f"{side}{finger}{joint}"
        for side in ("left", "right")
        for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky")
        for joint in range(1, 5)
    ),
)
REPRESENTATION = "hand-shape-trajectory-v1"
EXPECTED_SPLIT_COUNTS = {
    "train": (18, 0),
    "validation": (6, 18),
    "test": (6, 18),
}


def load_document(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("evaluation"), dict):
        raise ValueError("Export inválido; esperado objeto com templates e evaluation.")
    if document["evaluation"].get("sourceLicense") != "CC BY-NC 4.0":
        raise ValueError("Licença inesperada; nenhum template foi instalado.")
    if document["evaluation"].get("representation") != REPRESENTATION:
        raise ValueError("Representação do export incompatível.")
    return document


def validate_sample(sample: dict[str, Any], expected_split: str) -> None:
    if sample.get("split") != expected_split or sample.get("sourceLicense", "CC BY-NC 4.0") != "CC BY-NC 4.0":
        raise ValueError(f"{sample.get('id')}: split/licença inválidos.")
    frames = sample.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError(f"{sample.get('id')}: sequência temporal curta ou ausente.")
    previous_timestamp = -math.inf
    for frame in frames:
        if not isinstance(frame, dict) or not isinstance(frame.get("joints"), dict):
            raise ValueError(f"{sample.get('id')}: frame canônico inválido.")
        timestamp = frame.get("timestamp")
        if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
            raise ValueError(f"{sample.get('id')}: timestamp inválido.")
        if timestamp <= previous_timestamp:
            raise ValueError(f"{sample.get('id')}: timestamps não crescentes.")
        previous_timestamp = timestamp
        for joint in CANONICAL_JOINTS:
            point = frame["joints"].get(joint)
            if not isinstance(point, dict):
                raise ValueError(f"{sample.get('id')}: falta articulação canônica {joint}.")
            if not all(
                isinstance(point.get(axis), (int, float)) and math.isfinite(point[axis])
                for axis in ("x", "y", "z")
            ):
                raise ValueError(f"{sample.get('id')}: coordenada inválida em {joint}.")


def validate_split(samples: list[dict[str, Any]], split: str, gloss: str) -> None:
    for sample in samples:
        validate_sample(sample, split)
        if gloss == "SIM" and sample.get("gloss") != "SIM":
            raise ValueError(f"{sample.get('id')}: exemplo positivo não é SIM.")
        if gloss == "negative" and sample.get("gloss") == "SIM":
            raise ValueError(f"{sample.get('id')}: negativo rotulado como SIM.")


def write_templates(templates: list[dict[str, Any]], directory: Path) -> None:
    for template in templates:
        if (
            template.get("version") != 1
            or template.get("gloss") != "SIM"
            or template.get("metadata", {}).get("featureRepresentation") != REPRESENTATION
            or template.get("metadata", {}).get("split") != "train"
        ):
            raise ValueError(f"Template de treino inválido: {template.get('id')}")
        validate_sample(
            {
                "id": template.get("id"),
                "split": "train",
                "frames": template.get("frames"),
            },
            "train",
        )
        filename = f"libras-eqt-dual-sim-{safe_name(template['id'])}.template.json"
        (directory / filename).write_text(
            json.dumps(template, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )


def safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="JSON recebido da ferramenta offline.")
    parser.add_argument("--templates-dir", type=Path, default=Path("src/vision/templates"))
    parser.add_argument(
        "--evaluation-output",
        type=Path,
        default=Path("src/vision/pipeline/fixtures/libras-eqt-dual-evaluation.json"),
    )
    args = parser.parse_args()
    document = load_document(args.input)
    templates = document.get("templates")
    evaluation = document["evaluation"]
    if not isinstance(templates, list) or len(templates) != EXPECTED_SPLIT_COUNTS["train"][0]:
        raise ValueError("Esperados 18 templates SIM somente dos informantes de treino.")
    validation = evaluation.get("validation", {})
    test = evaluation.get("test", {})
    for split_name, split in (("validation", validation), ("test", test)):
        positive = split.get("positive", [])
        negative = split.get("negative", [])
        expected_positive, expected_negative = EXPECTED_SPLIT_COUNTS[split_name]
        if len(positive) != expected_positive or len(negative) != expected_negative:
            raise ValueError(
                f"{split_name}: esperados {expected_positive} positivos e "
                f"{expected_negative} negativos."
            )
        validate_split(positive, split_name, "SIM")
        validate_split(negative, split_name, "negative")

    args.templates_dir.mkdir(parents=True, exist_ok=True)
    args.evaluation_output.parent.mkdir(parents=True, exist_ok=True)
    write_templates(templates, args.templates_dir)
    args.evaluation_output.write_text(
        json.dumps(evaluation, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Instalados {len(templates)} templates; validação/teste completos e separados.")


if __name__ == "__main__":
    main()

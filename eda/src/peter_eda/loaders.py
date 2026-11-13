"""Read-only loaders for the original Peter data.

The functions in this module never write to the project.  They accept the
original JSON files, validate the minimum structure needed for the EDA and
return plain Python dictionaries plus small, typed sample records.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from . import config


class DataNotFoundError(FileNotFoundError):
    """Raised when a required original dataset is missing."""


class DataValidationError(ValueError):
    """Raised when an original dataset exists but is structurally invalid."""


@dataclass(frozen=True)
class Sample:
    """A single landmark sequence with its provenance.

    ``frames`` keeps exactly the canonical skeleton format used by Peter:
    a list of ``{"timestamp": number, "joints": {joint: {x, y, z, visibility}}}``.
    """

    sample_id: str
    class_name: str
    informant: str
    informant_id: str
    split: str
    role: str
    frames: tuple[dict[str, Any], ...]
    file_path: Path
    source_entry: str | None = None
    duration_seconds: float | None = None
    fps: float | None = None
    hand_visibility: float | None = None
    pose_visibility: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    representation: str | None = None
    is_template: bool = False

    @property
    def frame_count(self) -> int:
        return len(self.frames)

    @property
    def is_positive(self) -> bool:
        return self.class_name == "SIM"


@dataclass(frozen=True)
class PeterDataset:
    """Everything the EDA needs from the original project."""

    templates: tuple[Sample, ...]
    evaluation: tuple[Sample, ...]
    prior_results: dict[str, Any] | None
    evaluation_document: dict[str, Any]
    template_paths: tuple[Path, ...]

    @property
    def active_samples(self) -> tuple[Sample, ...]:
        return self.templates + self.evaluation

    def by_split(self, split: str) -> tuple[Sample, ...]:
        return tuple(sample for sample in self.active_samples if sample.split == split)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def load_json(path: Path) -> Any:
    """Load a UTF-8 JSON file with a readable error message."""

    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as error:
        raise DataNotFoundError(f"Arquivo não encontrado: {path}") from error
    except json.JSONDecodeError as error:
        raise DataValidationError(f"JSON inválido em {path}: {error}") from error


def read_source_text(path: Path) -> str:
    """Read a TypeScript source file used as methodological reference."""

    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise DataNotFoundError(
            f"Não foi possível ler o arquivo original: {path}"
        ) from error


def normalise_informant(value: Any) -> tuple[str, str]:
    """Return ``(display, id)`` for an informant label.

    The dataset uses labels such as ``INFORMANTE 4``.  The numeric part is
    exposed separately for grouping, but it is not assumed to be a physical
    identity (see the split-policy limitation in the fixture).
    """

    text = "" if value is None else str(value).strip()
    match = re.search(r"(\d+)", text)
    identifier = match.group(1) if match else text
    return text or "desconhecido", identifier or "desconhecido"


def _metadata_float(metadata: dict[str, Any], key: str) -> float | None:
    value = metadata.get(key)
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def find_template_files(
    directory: Path | None = None,
    pattern: str = config.DUAL_TEMPLATE_GLOB,
) -> list[Path]:
    """List template JSON files, sorted for reproducibility."""

    directory = directory or config.TEMPLATES_DIR
    if not directory.exists():
        return []
    return sorted(directory.glob(pattern))


def _validate_frames(frames: Any, sample_id: str) -> tuple[dict[str, Any], ...]:
    if not isinstance(frames, list) or len(frames) < 2:
        raise DataValidationError(f"{sample_id}: sequência ausente ou com menos de 2 frames.")
    timestamps: list[float] = []
    for frame in frames:
        if not isinstance(frame, dict) or not isinstance(frame.get("joints"), dict):
            raise DataValidationError(f"{sample_id}: frame canônico inválido.")
        timestamp = frame.get("timestamp")
        if not isinstance(timestamp, (int, float)):
            raise DataValidationError(f"{sample_id}: timestamp inválido.")
        timestamps.append(float(timestamp))
        for joint, point in frame["joints"].items():
            if not isinstance(point, dict) or not all(
                isinstance(point.get(axis), (int, float))
                for axis in ("x", "y", "z")
            ):
                raise DataValidationError(
                    f"{sample_id}: coordenada inválida na articulação {joint}."
                )
    if any(current <= previous for previous, current in zip(timestamps, timestamps[1:])):
        raise DataValidationError(f"{sample_id}: timestamps não estritamente crescentes.")
    return tuple(frames)


def _template_to_sample(document: dict[str, Any], path: Path) -> Sample:
    sample_id = str(document.get("id", path.stem))
    metadata = document.get("metadata") or {}
    informant, informant_id = normalise_informant(metadata.get("informant"))
    frames = _validate_frames(document.get("frames"), sample_id)
    representation = metadata.get("featureRepresentation") or metadata.get("representation")
    duration = document.get("duration")
    fps = document.get("fps")
    return Sample(
        sample_id=sample_id,
        class_name=str(document.get("gloss") or document.get("name") or "desconhecido").upper(),
        informant=informant,
        informant_id=informant_id,
        split=str(metadata.get("split") or "train"),
        role="template",
        frames=frames,
        file_path=path,
        source_entry=metadata.get("sourceEntry"),
        duration_seconds=float(duration) if isinstance(duration, (int, float)) else None,
        fps=float(fps) if isinstance(fps, (int, float)) else None,
        hand_visibility=_metadata_float(metadata, "handCoverage"),
        pose_visibility=_metadata_float(metadata, "shoulderCoverage"),
        metadata=dict(metadata),
        representation=str(representation) if representation else None,
        is_template=True,
    )


def load_dual_templates(
    directory: Path | None = None,
) -> tuple[list[Sample], list[Path]]:
    """Load the 18 templates actually consumed by the runtime.

    The repository filters on ``metadata.featureRepresentation ==
    "hand-shape-trajectory-v1"``.  We apply the same filter so that legacy
    ``v4`` templates are not mixed with the active training set.
    """

    paths = find_template_files(directory, config.DUAL_TEMPLATE_GLOB)
    samples: list[Sample] = []
    for path in paths:
        document = load_json(path)
        metadata = document.get("metadata") or {}
        if metadata.get("featureRepresentation") != "hand-shape-trajectory-v1":
            continue
        samples.append(_template_to_sample(document, path))
    return samples, paths


def load_template_inventory(directory: Path | None = None) -> list[dict[str, Any]]:
    """Inventory every template file, including inactive legacy templates.

    The EDA manifest uses only the 18 active dual templates.  This inventory
    makes the older files visible without silently mixing them into analyses.
    """

    directory = directory or config.TEMPLATES_DIR
    records: list[dict[str, Any]] = []
    for pattern in (config.DUAL_TEMPLATE_GLOB, config.LEGACY_V4_TEMPLATE_GLOB):
        for path in find_template_files(directory, pattern):
            try:
                document = load_json(path)
            except (DataNotFoundError, DataValidationError) as error:
                records.append(
                    {
                        "file_path": str(path.relative_to(config.PROJECT_ROOT)),
                        "sample_id": path.stem,
                        "runtime_active": False,
                        "error": str(error),
                    }
                )
                continue
            metadata = document.get("metadata") or {}
            active = (
                pattern == config.DUAL_TEMPLATE_GLOB
                and metadata.get("featureRepresentation") == "hand-shape-trajectory-v1"
            )
            _, informant_id = normalise_informant(metadata.get("informant"))
            records.append(
                {
                    "file_path": str(path.relative_to(config.PROJECT_ROOT)),
                    "sample_id": document.get("id", path.stem),
                    "class_name": document.get("gloss"),
                    "informant": metadata.get("informant"),
                    "informant_id": informant_id,
                    "split": metadata.get("split"),
                    "frame_count": len(document.get("frames") or []),
                    "fps": document.get("fps"),
                    "duration_seconds": document.get("duration"),
                    "hand_visibility": metadata.get("handCoverage"),
                    "pose_visibility": metadata.get("shoulderCoverage"),
                    "feature_representation": metadata.get("featureRepresentation"),
                    "runtime_active": active,
                    "selection_reason": (
                        "consumido por OfflineAnimationTemplateRepository"
                        if active
                        else "não corresponde ao glob/filtro do runtime atual"
                    ),
                }
            )
    return records


# ---------------------------------------------------------------------------
# Evaluation fixtures
# ---------------------------------------------------------------------------


def _evaluation_sample_to_record(
    document: dict[str, Any], split: str, role: str, fixture_path: Path
) -> Sample:
    sample_id = str(document.get("id"))
    frames = _validate_frames(document.get("frames"), sample_id)
    informant, informant_id = normalise_informant(document.get("informant"))
    return Sample(
        sample_id=sample_id,
        class_name=str(document.get("gloss") or "desconhecido").upper(),
        informant=informant,
        informant_id=informant_id,
        split=split,
        role=role,
        frames=frames,
        file_path=fixture_path,
        source_entry=document.get("sourceEntry"),
        duration_seconds=(
            float(document["duration"])
            if isinstance(document.get("duration"), (int, float))
            else None
        ),
        fps=(
            float(document["sampleRate"])
            if isinstance(document.get("sampleRate"), (int, float))
            else None
        ),
        hand_visibility=(
            float(document["handCoverage"])
            if isinstance(document.get("handCoverage"), (int, float))
            else None
        ),
        pose_visibility=(
            float(document["shoulderCoverage"])
            if isinstance(document.get("shoulderCoverage"), (int, float))
            else None
        ),
        metadata={key: value for key, value in document.items() if key != "frames"},
        representation="hand-shape-trajectory-v1",
        is_template=False,
    )


def load_evaluation(
    path: Path | None = None,
) -> tuple[list[Sample], dict[str, Any]]:
    """Load positive/negative samples from the dual evaluation fixture."""

    path = path or config.DUAL_EVALUATION_JSON
    document = load_json(path)
    if document.get("representation") != "hand-shape-trajectory-v1":
        raise DataValidationError(
            f"{path}: representação inesperada {document.get('representation')!r}."
        )
    samples: list[Sample] = []
    for split in ("validation", "test"):
        split_document = document.get(split) or {}
        for role, key in (("positive", "positive"), ("negative", "negative")):
            for item in split_document.get(key, []):
                samples.append(_evaluation_sample_to_record(item, split, role, path))
    return samples, document


def load_prior_results(path: Path | None = None) -> dict[str, Any] | None:
    """Load the TypeScript evaluation report, when present."""

    path = path or config.DUAL_RESULTS_JSON
    if not path.exists():
        return None
    return load_json(path)


def load_dataset(
    templates_dir: Path | None = None,
    evaluation_path: Path | None = None,
    results_path: Path | None = None,
) -> PeterDataset:
    """Load every active sample and the prior evaluation report."""

    templates, template_paths = load_dual_templates(templates_dir)
    evaluation, evaluation_document = load_evaluation(evaluation_path)
    prior_results = load_prior_results(results_path)
    return PeterDataset(
        templates=tuple(templates),
        evaluation=tuple(evaluation),
        prior_results=prior_results,
        evaluation_document=evaluation_document,
        template_paths=tuple(template_paths),
    )


# ---------------------------------------------------------------------------
# Convenience iterators used by quality/visualisation code
# ---------------------------------------------------------------------------


def iter_samples(dataset: PeterDataset) -> Iterable[Sample]:
    yield from dataset.active_samples


def samples_to_documents(samples: Iterable[Sample]) -> list[dict[str, Any]]:
    """Convert samples back to the canonical frame dictionary format."""

    return [
        {
            "id": sample.sample_id,
            "gloss": sample.class_name,
            "split": sample.split,
            "informant": sample.informant,
            "frames": list(sample.frames),
        }
        for sample in samples
    ]

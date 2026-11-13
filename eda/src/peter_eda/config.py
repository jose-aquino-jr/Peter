"""Central configuration for the Peter EDA environment.

All paths are resolved relative to this package, so the notebooks work from
any current directory as long as the ``eda`` folder stays next to the Peter
project.  The original project is only ever read; every artefact produced by
the EDA is written under ``eda/outputs``.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

EDA_ROOT = Path(__file__).resolve().parents[2]
"""Absolute path of the ``eda`` directory."""

PROJECT_ROOT = Path(
    os.environ.get("PETER_PROJECT_ROOT", EDA_ROOT.parent)
).resolve()
"""Root of the Peter project that contains ``src/``.

The value can be overridden with the ``PETER_PROJECT_ROOT`` environment
variable when the EDA folder is analysed separately from the project.
"""

SRC_ROOT = EDA_ROOT / "src"
OUTPUTS_DIR = EDA_ROOT / "outputs"
FIGURES_DIR = OUTPUTS_DIR / "figures"
TABLES_DIR = OUTPUTS_DIR / "tables"
REPORTS_DIR = OUTPUTS_DIR / "reports"

# Original Peter files (read-only).
VISION_DIR = PROJECT_ROOT / "src" / "vision"
TEMPLATES_DIR = VISION_DIR / "templates"
PIPELINE_DIR = VISION_DIR / "pipeline"
FIXTURES_DIR = PIPELINE_DIR / "fixtures"

DUAL_TEMPLATE_GLOB = "libras-eqt-dual-*.template.json"
LEGACY_V4_TEMPLATE_GLOB = "libras-eqt-v4-*.template.json"
DUAL_EVALUATION_JSON = FIXTURES_DIR / "libras-eqt-dual-evaluation.json"
DUAL_RESULTS_JSON = FIXTURES_DIR / "libras-eqt-dual-evaluation-results.json"
LEGACY_VALIDATION_JSON = FIXTURES_DIR / "libras-eqt-validation.json"

SOURCE_FILES = {
    "runtime_config": PROJECT_ROOT / "src" / "core" / "config.ts",
    "dtw": PIPELINE_DIR / "dtw.ts",
    "feature_vector": PIPELINE_DIR / "feature-vector.ts",
    "matching_engine": PIPELINE_DIR / "sign-matching-engine.ts",
    "canonical_skeleton": PIPELINE_DIR / "canonical-skeleton.ts",
    "landmark_normalizer": PIPELINE_DIR / "landmark-normalizer.ts",
    "template_repository": PIPELINE_DIR / "offline-animation-template-repository.ts",
    "evaluation_test": PIPELINE_DIR / "libras-eqt-validation.test.ts",
    "extractor": PROJECT_ROOT / "tools" / "libras-eqt-extractor.ts",
}

# ---------------------------------------------------------------------------
# Constants that mirror the TypeScript implementation
# ---------------------------------------------------------------------------

CANONICAL_JOINTS: tuple[str, ...] = (
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

BODY_JOINTS: tuple[str, ...] = CANONICAL_JOINTS[:13]
HAND_POINT_COUNT = 21
HAND_SHAPE_DIM = HAND_POINT_COUNT * 4  # 84 per hand, 168 for both hands
TRAJECTORY_DIM = 4  # x, y, z, validity per hand, 8 for both hands
LANDMARK_COUNT = len(CANONICAL_JOINTS)  # 55

MIN_VISIBILITY = 0.35
MIN_PALM_SCALE = 0.015
MIN_SHOULDER_SCALE = 0.04
MAX_MATCH_FRAMES = 16
DTW_WINDOW_RATIO = 0.28
DEFAULT_THRESHOLD = 0.68
DEFAULT_MIN_MOTION = 0.018
DEFAULT_MIN_SCORE_MARGIN = 0.08
DEFAULT_TOP_K = 3
DEFAULT_WEIGHTS = {"handShape": 0.5, "handTrajectory": 0.5}

# Values found in the historical evaluation fixture.  They are kept here only
# as labels for the reproduction of previous experiments.
HISTORICAL_THRESHOLD = 0.565


@dataclass(frozen=True)
class RuntimeConfig:
    """Subset of ``src/core/config.ts`` relevant to the DTW pipeline."""

    process_fps: float = 15.0
    buffer_duration_ms: float = 1400.0
    min_buffer_frames: int = 8
    dtw_window_ratio: float = DTW_WINDOW_RATIO
    min_confidence: float = DEFAULT_THRESHOLD
    min_score_margin: float = DEFAULT_MIN_SCORE_MARGIN
    top_k: int = DEFAULT_TOP_K
    min_motion: float = DEFAULT_MIN_MOTION
    max_match_frames: int = MAX_MATCH_FRAMES


_NUMBER_RE = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def _vision_block(source: str) -> str:
    """Return the text of the ``vision`` object in ``config.ts``."""

    match = re.search(r"vision:\s*\{", source)
    if not match:
        return source
    start = match.end()
    depth = 1
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index]
    return source[start:]


def _read_number(block: str, key: str, default: float) -> float:
    match = re.search(rf"\b{key}\s*:\s*({_NUMBER_RE})", block)
    return float(match.group(1)) if match else default


def load_runtime_config(path: Path | None = None) -> RuntimeConfig:
    """Read the runtime parameters from the original TypeScript config.

    Parsing the original file (instead of hard-coding only) keeps the EDA
    honest when the team changes a threshold.  Missing or unreadable files
    fall back to the documented defaults.
    """

    config_path = path or SOURCE_FILES["runtime_config"]
    fallback = RuntimeConfig()
    try:
        source = config_path.read_text(encoding="utf-8")
    except OSError:
        return fallback
    block = _vision_block(source)
    return RuntimeConfig(
        process_fps=_read_number(block, "processFps", fallback.process_fps),
        buffer_duration_ms=_read_number(
            block, "bufferDurationMs", fallback.buffer_duration_ms
        ),
        min_buffer_frames=int(
            _read_number(block, "minBufferFrames", fallback.min_buffer_frames)
        ),
        dtw_window_ratio=_read_number(
            block, "dtwWindowRatio", fallback.dtw_window_ratio
        ),
        min_confidence=_read_number(
            block, "minConfidence", fallback.min_confidence
        ),
        min_score_margin=_read_number(
            block, "minScoreMargin", fallback.min_score_margin
        ),
        top_k=int(_read_number(block, "topK", fallback.top_k)),
        min_motion=_read_number(block, "minMotion", fallback.min_motion),
        max_match_frames=int(
            _read_number(block, "maxMatchFrames", fallback.max_match_frames)
        ),
    )


@dataclass(frozen=True)
class MatchConfiguration:
    """A complete, reproducible DTW matching configuration."""

    name: str
    threshold: float
    min_motion: float
    hand_shape_weight: float
    hand_trajectory_weight: float
    window_ratio: float = DTW_WINDOW_RATIO
    max_frames: int = MAX_MATCH_FRAMES
    min_score_margin: float = DEFAULT_MIN_SCORE_MARGIN
    top_k: int = DEFAULT_TOP_K

    @property
    def weights(self) -> dict[str, float]:
        return {
            "handShape": self.hand_shape_weight,
            "handTrajectory": self.hand_trajectory_weight,
        }


def default_configuration() -> MatchConfiguration:
    runtime = load_runtime_config()
    return MatchConfiguration(
        name="default",
        threshold=runtime.min_confidence,
        min_motion=runtime.min_motion,
        hand_shape_weight=DEFAULT_WEIGHTS["handShape"],
        hand_trajectory_weight=DEFAULT_WEIGHTS["handTrajectory"],
        window_ratio=runtime.dtw_window_ratio,
        max_frames=runtime.max_match_frames,
        min_score_margin=runtime.min_score_margin,
        top_k=runtime.top_k,
    )


def historical_configuration() -> MatchConfiguration:
    return MatchConfiguration(
        name="historical-experimental",
        threshold=HISTORICAL_THRESHOLD,
        min_motion=0.0,
        hand_shape_weight=0.5,
        hand_trajectory_weight=0.5,
        window_ratio=DTW_WINDOW_RATIO,
        max_frames=MAX_MATCH_FRAMES,
    )


def ensure_output_dirs() -> None:
    """Create the output tree if it does not exist yet."""

    for directory in (FIGURES_DIR, TABLES_DIR, REPORTS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def output_path(kind: str, filename: str) -> Path:
    """Return a path inside ``outputs/{figures,tables,reports}``."""

    kinds = {"figure": FIGURES_DIR, "table": TABLES_DIR, "report": REPORTS_DIR}
    if kind not in kinds:
        raise ValueError(f"Tipo de saída desconhecido: {kind!r}")
    directory = kinds[kind]
    directory.mkdir(parents=True, exist_ok=True)
    return directory / filename


def describe_paths() -> dict[str, Any]:
    """Small dictionary used by the notebooks to document the environment."""

    return {
        "eda_root": str(EDA_ROOT),
        "project_root": str(PROJECT_ROOT),
        "templates_dir": str(TEMPLATES_DIR),
        "fixtures_dir": str(FIXTURES_DIR),
        "outputs_dir": str(OUTPUTS_DIR),
        "project_root_exists": PROJECT_ROOT.exists(),
        "templates_dir_exists": TEMPLATES_DIR.exists(),
        "fixtures_dir_exists": FIXTURES_DIR.exists(),
    }

"""Peter EDA — exploracão isolada dos dados de reconhecimento de Libras.

The package only reads the original project.  See ``eda/README.md`` for the
recommended execution order and methodological caveats.
"""

from __future__ import annotations

from .config import (
    DEFAULT_THRESHOLD,
    DEFAULT_WEIGHTS,
    EDA_ROOT,
    PROJECT_ROOT,
    MatchConfiguration,
    RuntimeConfig,
    default_configuration,
    historical_configuration,
    load_runtime_config,
)

__all__ = [
    "DEFAULT_THRESHOLD",
    "DEFAULT_WEIGHTS",
    "EDA_ROOT",
    "PROJECT_ROOT",
    "MatchConfiguration",
    "RuntimeConfig",
    "default_configuration",
    "historical_configuration",
    "load_runtime_config",
]

__version__ = "0.1.0"

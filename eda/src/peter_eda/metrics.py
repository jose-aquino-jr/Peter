"""Evaluation metrics for the small LIBRAS-EQT evaluation sets.

Every helper is explicit about degenerate cases (0 positives / 0 negatives),
because the EDA works with only 6 positive and 18 negative samples per split.
"""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, roc_curve


def confusion_counts(y_true: Sequence[int], y_pred: Sequence[int]) -> dict[str, int]:
    """Return TP, FN, FP, TN for binary labels (1 = SIM)."""

    true = np.asarray(y_true, dtype=int)
    pred = np.asarray(y_pred, dtype=int)
    return {
        "true_positive": int(((true == 1) & (pred == 1)).sum()),
        "false_negative": int(((true == 1) & (pred == 0)).sum()),
        "false_positive": int(((true == 0) & (pred == 1)).sum()),
        "true_negative": int(((true == 0) & (pred == 0)).sum()),
    }


def _safe_divide(numerator: float, denominator: float) -> float | None:
    return float(numerator / denominator) if denominator else None


def classification_metrics(
    y_true: Sequence[int], y_pred: Sequence[int]
) -> dict[str, Any]:
    """Precision, recall, F1, balanced accuracy and false-positive rate."""

    counts = confusion_counts(y_true, y_pred)
    tp = counts["true_positive"]
    fn = counts["false_negative"]
    fp = counts["false_positive"]
    tn = counts["true_negative"]
    precision = _safe_divide(tp, tp + fp)
    recall = _safe_divide(tp, tp + fn)
    specificity = _safe_divide(tn, tn + fp)
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and (precision + recall) > 0
        else 0.0 if precision is not None and recall is not None else None
    )
    balanced_accuracy = (
        (recall + specificity) / 2
        if recall is not None and specificity is not None
        else None
    )
    return {
        **counts,
        "n": int(len(y_true)),
        "n_positive": tp + fn,
        "n_negative": tn + fp,
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "f1": f1,
        "false_positive_rate": (1 - specificity) if specificity is not None else None,
        "balanced_accuracy": balanced_accuracy,
        "accuracy": _safe_divide(tp + tn, len(y_true)),
    }


def roc_analysis(
    y_true: Sequence[int], scores: Sequence[float]
) -> dict[str, Any]:
    """ROC curve and AUC; returns ``None`` values for single-class input."""

    true = np.asarray(y_true, dtype=int)
    values = np.asarray(scores, dtype=float)
    if len(np.unique(true)) < 2 or len(true) < 2:
        return {"fpr": np.array([]), "tpr": np.array([]), "auc": None}
    fpr, tpr, _ = roc_curve(true, values)
    return {"fpr": fpr, "tpr": tpr, "auc": float(roc_auc_score(true, values))}


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a proportion.

    Appropriate for the very small counts in this dataset; unlike the normal
    approximation it does not collapse to a zero-width interval at 0% or 100%.
    """

    if total == 0:
        return (float("nan"), float("nan"))
    proportion = successes / total
    denominator = 1 + z**2 / total
    centre = (proportion + z**2 / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt(proportion * (1 - proportion) / total + z**2 / (4 * total**2))
        / denominator
    )
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def bootstrap_ci(
    y_true: Sequence[int],
    y_pred: Sequence[int],
    metric: str = "balanced_accuracy",
    n_bootstrap: int = 2000,
    seed: int = 2026,
) -> dict[str, float | None]:
    """Stratified bootstrap confidence interval for a classification metric.

    The small sample makes asymptotic intervals optimistic.  Resampling is
    stratified by class to avoid degenerate resamples with only one class.
    """

    true = np.asarray(y_true, dtype=int)
    pred = np.asarray(y_pred, dtype=int)
    rng = np.random.default_rng(seed)
    positives = np.flatnonzero(true == 1)
    negatives = np.flatnonzero(true == 0)
    if len(positives) == 0 or len(negatives) == 0:
        return {"low": None, "high": None, "samples": 0}
    values: list[float] = []
    for _ in range(n_bootstrap):
        selected = np.concatenate(
            [
                rng.choice(positives, size=len(positives), replace=True),
                rng.choice(negatives, size=len(negatives), replace=True),
            ]
        )
        result = classification_metrics(true[selected], pred[selected])
        value = result.get(metric)
        if value is not None:
            values.append(float(value))
    if not values:
        return {"low": None, "high": None, "samples": 0}
    return {
        "low": float(np.percentile(values, 2.5)),
        "high": float(np.percentile(values, 97.5)),
        "samples": len(values),
    }


def bootstrap_auc_ci(
    y_true: Sequence[int],
    scores: Sequence[float],
    n_bootstrap: int = 2000,
    seed: int = 2026,
) -> dict[str, float | None]:
    true = np.asarray(y_true, dtype=int)
    values = np.asarray(scores, dtype=float)
    positives = np.flatnonzero(true == 1)
    negatives = np.flatnonzero(true == 0)
    if len(positives) == 0 or len(negatives) == 0:
        return {"low": None, "high": None, "samples": 0}
    rng = np.random.default_rng(seed)
    aucs: list[float] = []
    for _ in range(n_bootstrap):
        selected = np.concatenate(
            [
                rng.choice(positives, size=len(positives), replace=True),
                rng.choice(negatives, size=len(negatives), replace=True),
            ]
        )
        try:
            aucs.append(float(roc_auc_score(true[selected], values[selected])))
        except ValueError:
            continue
    if not aucs:
        return {"low": None, "high": None, "samples": 0}
    return {
        "low": float(np.percentile(aucs, 2.5)),
        "high": float(np.percentile(aucs, 97.5)),
        "samples": len(aucs),
    }


def threshold_sweep(
    y_true: Sequence[int],
    scores: Sequence[float],
    motion: Sequence[float] | None = None,
    min_motion: float = 0.0,
    thresholds: Sequence[float] | None = None,
) -> pd.DataFrame:
    """Metrics as a function of the recognition threshold."""

    true = np.asarray(y_true, dtype=int)
    values = np.asarray(scores, dtype=float)
    motion_values = (
        np.asarray(motion, dtype=float)
        if motion is not None
        else np.full(len(values), np.inf)
    )
    if thresholds is None:
        thresholds = np.round(np.arange(0.30, 0.96, 0.01), 2)
    rows = []
    for threshold in thresholds:
        predicted = ((values >= threshold) & (motion_values >= min_motion)).astype(int)
        metrics = classification_metrics(true, predicted)
        rows.append({"threshold": float(threshold), **metrics})
    return pd.DataFrame(rows)


def distribution_summary(values: Sequence[float]) -> dict[str, float | int]:
    array = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if array.size == 0:
        return {"n": 0}
    return {
        "n": int(array.size),
        "mean": float(array.mean()),
        "std": float(array.std(ddof=1)) if array.size > 1 else 0.0,
        "min": float(array.min()),
        "q25": float(np.percentile(array, 25)),
        "median": float(np.median(array)),
        "q75": float(np.percentile(array, 75)),
        "max": float(array.max()),
    }


def cliffs_delta(group_a: Sequence[float], group_b: Sequence[float]) -> float | None:
    """Non-parametric effect size in [-1, 1] for two small samples."""

    a = np.asarray(group_a, dtype=float)
    b = np.asarray(group_b, dtype=float)
    if a.size == 0 or b.size == 0:
        return None
    comparisons = np.sign(a[:, None] - b[None, :])
    return float(comparisons.mean())


def metrics_row(name: str, y_true: Sequence[int], y_pred: Sequence[int]) -> dict[str, Any]:
    """Flatten metrics into a named row suitable for a DataFrame."""

    metrics = classification_metrics(y_true, y_pred)
    return {"configuration": name, **metrics}


def format_metric(value: Any) -> str:
    if value is None:
        return "n/d"
    if isinstance(value, (float, np.floating)):
        return f"{float(value):.3f}"
    return str(value)

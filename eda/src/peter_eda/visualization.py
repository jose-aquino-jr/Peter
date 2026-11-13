"""Matplotlib/Seaborn visualisations for the Peter EDA.

Figures are always saved under ``eda/outputs/figures``.  Plotting functions
receive plain DataFrames or :class:`~peter_eda.loaders.Sample` objects so the
notebooks stay short and reusable.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib.animation import FuncAnimation, PillowWriter
from matplotlib.lines import Line2D

from . import config
from .loaders import Sample
from .quality import _frame_array

BODY_CONNECTIONS = (
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    (3, 5),
    (4, 6),
    (1, 7),
    (2, 8),
    (7, 9),
    (8, 10),
    (9, 11),
    (10, 12),
    (5, 6),
)
HAND_CONNECTIONS = (
    (0, 1),
    (0, 5),
    (0, 9),
    (0, 13),
    (0, 17),
    (1, 2),
    (2, 3),
    (3, 4),
    (5, 6),
    (6, 7),
    (7, 8),
    (9, 10),
    (10, 11),
    (11, 12),
    (13, 14),
    (14, 15),
    (15, 16),
    (17, 18),
    (18, 19),
    (19, 20),
)
SPLIT_COLORS = {"train": "#4C72B0", "validation": "#DD8452", "test": "#55A868"}
CLASS_COLORS = {"SIM": "#2E7D32", "CAIR": "#C62828", "LUZ": "#F9A825", "JA": "#6A1B9A"}


def setup_style() -> None:
    sns.set_theme(style="whitegrid", context="notebook")
    plt.rcParams.update(
        {
            "figure.dpi": 110,
            "savefig.dpi": 160,
            "axes.titlesize": 12,
            "axes.labelsize": 10,
            "legend.fontsize": 9,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
            "figure.autolayout": False,
        }
    )


def save_figure(fig: plt.Figure, filename: str, dpi: int = 160) -> Path:
    config.ensure_output_dirs()
    path = config.output_path("figure", filename)
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white")
    return path


# ---------------------------------------------------------------------------
# Inventory and quality
# ---------------------------------------------------------------------------


def plot_sample_counts(manifest: pd.DataFrame, filename: str = "01_manifest_contagens.png") -> Path:
    setup_style()
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.2))
    order = ["train", "validation", "test"]
    sns.countplot(
        data=manifest,
        x="dataset_split",
        hue="dataset_role",
        order=order,
        ax=axes[0],
        palette="muted",
    )
    axes[0].set_title("Amostras por split e papel")
    axes[0].set_xlabel("Split")
    axes[0].set_ylabel("Número de amostras")
    axes[0].legend(title="Papel", frameon=True)

    sns.countplot(
        data=manifest,
        x="dataset_split",
        hue="class_name",
        order=order,
        ax=axes[1],
        palette=CLASS_COLORS,
    )
    axes[1].set_title("Classes por split")
    axes[1].set_xlabel("Split")
    axes[1].set_ylabel("Número de amostras")
    axes[1].legend(title="Classe", frameon=True)

    sns.countplot(
        data=manifest,
        x="informant_id",
        hue="dataset_split",
        hue_order=order,
        ax=axes[2],
        palette=SPLIT_COLORS,
    )
    axes[2].set_title("Amostras por informante")
    axes[2].set_xlabel("Informante (rótulo local do item)")
    axes[2].set_ylabel("Número de amostras")
    axes[2].legend(title="Split", frameon=True)
    fig.suptitle("Figura 1 — Inventário consolidado do Peter", y=1.02)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_frame_counts(manifest: pd.DataFrame, filename: str = "01_frames_por_amostra.png") -> Path:
    setup_style()
    fig, axis = plt.subplots(figsize=(9, 4.2))
    sns.histplot(
        data=manifest,
        x="frame_count",
        hue="dataset_split",
        hue_order=["train", "validation", "test"],
        palette=SPLIT_COLORS,
        multiple="stack",
        discrete=True,
        ax=axis,
    )
    axis.set_title("Quantidade de frames armazenados por amostra")
    axis.set_xlabel("Frames por sequência")
    axis.set_ylabel("Número de amostras")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_duration_distribution(
    manifest: pd.DataFrame, filename: str = "01_duracao_por_split.png"
) -> Path:
    setup_style()
    data = manifest.dropna(subset=["duration_seconds"])
    fig, axis = plt.subplots(figsize=(8.5, 4.2))
    sns.boxplot(
        data=data,
        x="dataset_split",
        y="duration_seconds",
        order=["train", "validation", "test"],
        color="#B0BEC5",
        width=0.5,
        ax=axis,
    )
    sns.stripplot(
        data=data,
        x="dataset_split",
        y="duration_seconds",
        order=["train", "validation", "test"],
        hue="dataset_split",
        palette=SPLIT_COLORS,
        size=6,
        jitter=0.15,
        ax=axis,
        legend=False,
    )
    axis.set_title("Duração dos vídeos de origem por split")
    axis.set_xlabel("Split")
    axis.set_ylabel("Duração (s)")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_coverage_by_informant(
    frame_quality: pd.DataFrame,
    filename: str = "02_cobertura_maos_por_informante.png",
) -> Path:
    setup_style()
    data = frame_quality.copy()
    data["grupo"] = data["class_name"] + " · " + data["dataset_split"]
    fig, axes = plt.subplots(1, 2, figsize=(14, 4.6), sharey=True)
    sns.stripplot(
        data=data,
        x="informant_id",
        y="hand_coverage_metadata",
        hue="grupo",
        dodge=True,
        size=6,
        alpha=0.85,
        ax=axes[0],
    )
    axes[0].set_title("Cobertura das mãos (metadados)")
    axes[0].set_xlabel("Informante")
    axes[0].set_ylabel("handCoverage (0–1)")
    axes[0].set_ylim(-0.02, 1.05)
    axes[0].legend(title="Classe · split", bbox_to_anchor=(1.01, 1), loc="upper left")

    sns.boxplot(
        data=data,
        x="informant_id",
        y="visible_ratio_mean",
        color="#CFD8DC",
        width=0.55,
        ax=axes[1],
    )
    sns.stripplot(
        data=data,
        x="informant_id",
        y="visible_ratio_mean",
        hue="class_name",
        palette=CLASS_COLORS,
        size=5,
        jitter=0.12,
        ax=axes[1],
        legend=True,
    )
    axes[1].set_title("Fração média de articulações visíveis nos 16 frames")
    axes[1].set_xlabel("Informante")
    axes[1].set_ylabel("Articulações visíveis / 55")
    axes[1].legend(title="Classe", bbox_to_anchor=(1.01, 1), loc="upper left")
    fig.suptitle("Figura 2 — Cobertura e visibilidade por informante", y=1.02)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_visibility_heatmap(
    frame_quality: pd.DataFrame,
    filename: str = "02_mapa_visibilidade.png",
) -> Path:
    """Heatmap of visible-hand frames per sample."""

    setup_style()
    data = frame_quality.sort_values(["dataset_split", "class_name", "sample_id"])
    fig, axis = plt.subplots(figsize=(7, max(6, 0.22 * len(data))))
    matrix = data.set_index("sample_id")[["any_hand_frames", "both_hands_frames"]]
    sns.heatmap(
        matrix,
        cmap="YlGnBu",
        vmin=0,
        vmax=16,
        cbar_kws={"label": "Frames (de 16)"},
        ax=axis,
    )
    axis.set_title("Frames com mão detectada (0–16)")
    axis.set_xlabel("Indicador")
    axis.set_ylabel("Amostra")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_sequence_completeness(
    frame_quality: pd.DataFrame, filename: str = "02_completude_sequencias.png"
) -> Path:
    setup_style()
    data = frame_quality.melt(
        id_vars=["sample_id", "dataset_split", "class_name", "informant_id"],
        value_vars=["any_hand_frames", "both_hands_frames", "low_visibility_frames"],
        var_name="indicador",
        value_name="frames",
    )
    fig, axis = plt.subplots(figsize=(10, 4.5))
    sns.boxplot(
        data=data,
        x="indicador",
        y="frames",
        hue="dataset_split",
        hue_order=["train", "validation", "test"],
        palette=SPLIT_COLORS,
        ax=axis,
    )
    axis.set_title("Completude das mãos nos 16 frames armazenados")
    axis.set_xlabel("Indicador")
    axis.set_ylabel("Frames")
    axis.legend(title="Split", frameon=True)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


# ---------------------------------------------------------------------------
# DTW diagnostics
# ---------------------------------------------------------------------------


def plot_score_distributions(
    scored: pd.DataFrame,
    filename: str = "04_distribuicao_scores.png",
    threshold: float | None = None,
) -> Path:
    setup_style()
    data = scored.copy()
    data["grupo"] = data["dataset_split"] + " · " + data["class_name"]
    fig, axis = plt.subplots(figsize=(11, 4.8))
    order = [
        "train · SIM",
        "validation · SIM",
        "validation · CAIR",
        "validation · LUZ",
        "validation · JA",
        "test · SIM",
        "test · CAIR",
        "test · LUZ",
        "test · JA",
    ]
    order = [item for item in order if item in set(data["grupo"])]
    sns.boxplot(
        data=data,
        x="grupo",
        y="best_score",
        order=order,
        color="#ECEFF1",
        width=0.55,
        ax=axis,
    )
    sns.stripplot(
        data=data,
        x="grupo",
        y="best_score",
        order=order,
        hue="class_name",
        palette=CLASS_COLORS,
        size=7,
        jitter=0.12,
        ax=axis,
    )
    if threshold is not None:
        axis.axhline(
            threshold,
            color="#C62828",
            linestyle="--",
            linewidth=1.2,
            label=f"limiar = {threshold:.2f}",
        )
        axis.legend(loc="upper left", frameon=True)
    axis.set_title("Melhor score DTW por amostra e grupo")
    axis.set_xlabel("Split · classe")
    axis.set_ylabel("Score combinado (1 / (1 + distância))")
    axis.tick_params(axis="x", rotation=25)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_confusion_matrix(
    metrics: dict[str, float | int | None],
    title: str,
    filename: str,
) -> Path:
    setup_style()
    matrix = np.array(
        [
            [metrics["true_negative"], metrics["false_positive"]],
            [metrics["false_negative"], metrics["true_positive"]],
        ]
    )
    fig, axis = plt.subplots(figsize=(4.6, 4.0))
    sns.heatmap(
        matrix,
        annot=True,
        fmt="d",
        cmap="Blues",
        cbar=False,
        xticklabels=["Previsto\nnão-SIM", "Previsto\nSIM"],
        yticklabels=["Real\nnão-SIM", "Real\nSIM"],
        ax=axis,
    )
    axis.set_title(title)
    axis.set_xlabel("Predição")
    axis.set_ylabel("Rótulo")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_roc_curves(
    curves: Sequence[tuple[str, Sequence[int], Sequence[float]]],
    filename: str = "04_roc.png",
) -> Path:
    setup_style()
    from sklearn.metrics import roc_auc_score, roc_curve

    fig, axis = plt.subplots(figsize=(5.8, 4.8))
    for name, y_true, scores in curves:
        true = np.asarray(y_true, dtype=int)
        values = np.asarray(scores, dtype=float)
        if len(np.unique(true)) < 2:
            continue
        fpr, tpr, _ = roc_curve(true, values)
        auc = roc_auc_score(true, values)
        axis.plot(fpr, tpr, linewidth=1.8, label=f"{name} (AUC = {auc:.2f})")
    axis.plot([0, 1], [0, 1], color="grey", linestyle=":", linewidth=1)
    axis.set_xlim(-0.02, 1.02)
    axis.set_ylim(-0.02, 1.02)
    axis.set_xlabel("Taxa de falsos positivos")
    axis.set_ylabel("Taxa de verdadeiros positivos (recall)")
    axis.set_title("Curva ROC — classificação binária SIM vs não-SIM")
    axis.legend(frameon=True, loc="lower right")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_threshold_sweep(
    sweep: pd.DataFrame,
    current_threshold: float | None = None,
    filename: str = "04_varredura_limiar.png",
) -> Path:
    setup_style()
    fig, axis = plt.subplots(figsize=(8.5, 4.6))
    axis.plot(sweep["threshold"], sweep["recall"], label="Recall (SIM)", color="#2E7D32")
    axis.plot(
        sweep["threshold"],
        sweep["false_positive_rate"],
        label="Taxa de falsos positivos",
        color="#C62828",
    )
    axis.plot(
        sweep["threshold"],
        sweep["balanced_accuracy"],
        label="Acurácia balanceada",
        color="#1565C0",
        linewidth=2.0,
    )
    if current_threshold is not None:
        axis.axvline(
            current_threshold,
            color="black",
            linestyle="--",
            linewidth=1.0,
            label=f"limiar analisado = {current_threshold:.2f}",
        )
    axis.set_ylim(-0.02, 1.02)
    axis.set_xlabel("Limiar de reconhecimento")
    axis.set_ylabel("Métrica (0–1)")
    axis.set_title("Efeito do limiar nas métricas")
    axis.legend(frameon=True, loc="best")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_score_vs_coverage(
    scored: pd.DataFrame, filename: str = "04_score_vs_cobertura.png"
) -> Path:
    setup_style()
    data = scored.dropna(subset=["hand_visibility"])
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.4), sharey=True)
    for axis, split in zip(axes, ["validation", "test"]):
        subset = data[data["dataset_split"] == split]
        sns.scatterplot(
            data=subset,
            x="hand_visibility",
            y="best_score",
            hue="class_name",
            style="class_name",
            palette=CLASS_COLORS,
            s=85,
            ax=axis,
        )
        axis.set_title(f"{split} — score vs cobertura das mãos")
        axis.set_xlabel("handCoverage (metadados)")
        axis.set_ylabel("Melhor score DTW")
        axis.set_xlim(-0.02, 1.05)
        axis.legend(title="Classe", frameon=True)
    fig.suptitle("Figura 4 — A cobertura das mãos não explica o colapso do teste", y=1.02)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_score_components(
    scored: pd.DataFrame, filename: str = "04_componentes_shape_trajetoria.png"
) -> Path:
    setup_style()
    data = scored.melt(
        id_vars=["sample_id", "dataset_split", "class_name", "informant_id"],
        value_vars=["best_hand_shape_score", "best_hand_trajectory_score"],
        var_name="componente",
        value_name="score",
    )
    data["componente"] = data["componente"].map(
        {
            "best_hand_shape_score": "Forma da mão",
            "best_hand_trajectory_score": "Trajetória do punho",
        }
    )
    data["grupo"] = data["dataset_split"] + " · " + data["class_name"]
    fig, axis = plt.subplots(figsize=(11, 4.6))
    sns.boxplot(
        data=data,
        x="grupo",
        y="score",
        hue="componente",
        palette=["#5C6BC0", "#26A69A"],
        ax=axis,
    )
    axis.set_title("Componentes do score: forma estática vs trajetória")
    axis.set_xlabel("Split · classe")
    axis.set_ylabel("Score do componente")
    axis.tick_params(axis="x", rotation=25)
    axis.legend(title="Componente", frameon=True)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_template_similarity_heatmap(
    matrix: pd.DataFrame,
    title: str,
    filename: str,
) -> Path:
    setup_style()
    fig, axis = plt.subplots(figsize=(10, 8))
    sns.heatmap(
        matrix,
        cmap="viridis",
        vmin=0,
        vmax=1,
        square=True,
        cbar_kws={"label": "Similaridade DTW"},
        ax=axis,
    )
    axis.set_title(title)
    axis.set_xlabel("Amostra")
    axis.set_ylabel("Amostra")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


# ---------------------------------------------------------------------------
# Signal visualisation
# ---------------------------------------------------------------------------


def _joint_xy(frame: dict, index: int) -> tuple[float, float, float] | None:
    joint = config.CANONICAL_JOINTS[index]
    point = frame.get("joints", {}).get(joint)
    if not point:
        return None
    return (
        float(point.get("x", 0.0)),
        float(point.get("y", 0.0)),
        float(point.get("visibility", 1.0)),
    )


def plot_wrist_trajectories(
    samples: Iterable[Sample],
    filename: str = "05_trajetorias_punhos.png",
    group_by: str = "informant_id",
    title: str = "Trajetórias 2D dos punhos",
) -> Path:
    """One panel per group, with left/right wrist paths in canonical axes."""

    setup_style()
    samples = list(samples)
    groups: dict[str, list[Sample]] = {}
    for sample in samples:
        key = getattr(sample, group_by)
        groups.setdefault(str(key), []).append(sample)
    n_groups = max(1, len(groups))
    ncols = min(3, n_groups)
    nrows = int(np.ceil(n_groups / ncols))
    fig, axes = plt.subplots(
        nrows, ncols, figsize=(4.6 * ncols, 4.1 * nrows), squeeze=False
    )
    for axis in axes.flat:
        axis.set_axis_off()
    for axis, (group, group_samples) in zip(axes.flat, sorted(groups.items())):
        axis.set_axis_on()
        for sample in group_samples:
            left_x, left_y, right_x, right_y = [], [], [], []
            for frame in sample.frames:
                left = _joint_xy(frame, 13)
                right = _joint_xy(frame, 14)
                if left and left[2] >= config.MIN_VISIBILITY:
                    left_x.append(left[0])
                    left_y.append(left[1])
                if right and right[2] >= config.MIN_VISIBILITY:
                    right_x.append(right[0])
                    right_y.append(right[1])
            color = CLASS_COLORS.get(sample.class_name, "#78909C")
            if left_x:
                axis.plot(left_x, left_y, color=color, alpha=0.55, linewidth=1.2)
                axis.scatter(left_x[0], left_y[0], marker="o", s=18, color=color)
            if right_x:
                axis.plot(
                    right_x,
                    right_y,
                    color=color,
                    alpha=0.55,
                    linewidth=1.2,
                    linestyle="--",
                )
                axis.scatter(
                    right_x[0], right_y[0], marker="s", s=18, color=color
                )
        axis.set_title(f"{group_by} = {group}")
        axis.set_xlabel("x canônico")
        axis.set_ylabel("y canônico")
        axis.set_aspect("equal", adjustable="datalim")
        axis.axhline(0, color="#B0BEC5", linewidth=0.6, linestyle=":")
        axis.axvline(0, color="#B0BEC5", linewidth=0.6, linestyle=":")
    handles = [
        Line2D([0], [0], color=CLASS_COLORS[name], label=name)
        for name in ("SIM", "CAIR", "LUZ", "JA")
    ]
    fig.legend(
        handles=handles,
        title="Classe",
        loc="lower center",
        ncol=4,
        frameon=True,
        bbox_to_anchor=(0.5, -0.03),
    )
    fig.suptitle(title, y=1.02)
    fig.text(
        0.5,
        -0.08,
        "Linha contínua = punho esquerdo; tracejada = punho direito; marcador = primeiro frame.",
        ha="center",
        fontsize=8,
        color="#455A64",
    )
    fig.subplots_adjust(top=0.88)
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def plot_trajectory_comparison(
    samples: Sequence[Sample],
    title: str,
    filename: str,
    labels: Sequence[str] | None = None,
) -> Path:
    """Overlay wrist trajectories for a small, explicit set of samples."""

    setup_style()
    fig, axis = plt.subplots(figsize=(7.2, 5.4))
    palette = plt.cm.tab10(np.linspace(0, 1, max(1, len(samples))))
    for index, sample in enumerate(samples):
        left = np.array(
            [
                [_joint_xy(frame, 13)[0], _joint_xy(frame, 13)[1]]
                for frame in sample.frames
                if _joint_xy(frame, 13) and _joint_xy(frame, 13)[2] >= config.MIN_VISIBILITY
            ]
        )
        right = np.array(
            [
                [_joint_xy(frame, 14)[0], _joint_xy(frame, 14)[1]]
                for frame in sample.frames
                if _joint_xy(frame, 14) and _joint_xy(frame, 14)[2] >= config.MIN_VISIBILITY
            ]
        )
        label = labels[index] if labels else sample.sample_id
        if len(left):
            axis.plot(left[:, 0], left[:, 1], color=palette[index], linewidth=1.8, label=f"{label} — E")
            axis.scatter(left[0, 0], left[0, 1], color=palette[index], marker="o", s=28)
        if len(right):
            axis.plot(
                right[:, 0],
                right[:, 1],
                color=palette[index],
                linewidth=1.5,
                linestyle="--",
                label=f"{label} — D",
            )
            axis.scatter(right[0, 0], right[0, 1], color=palette[index], marker="s", s=28)
    axis.set_title(title)
    axis.set_xlabel("x canônico")
    axis.set_ylabel("y canônico")
    axis.set_aspect("equal", adjustable="datalim")
    axis.legend(frameon=True, fontsize=7, loc="best")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path


def draw_skeleton(
    axis: plt.Axes,
    frame: dict,
    color: str = "#263238",
    alpha: float = 1.0,
    show_hands: bool = True,
) -> None:
    """Draw one canonical skeleton frame using only joints present in the data."""

    for start, end in BODY_CONNECTIONS:
        point_a = _joint_xy(frame, start)
        point_b = _joint_xy(frame, end)
        if (
            point_a
            and point_b
            and point_a[2] >= config.MIN_VISIBILITY
            and point_b[2] >= config.MIN_VISIBILITY
        ):
            axis.plot(
                [point_a[0], point_b[0]],
                [point_a[1], point_b[1]],
                color=color,
                linewidth=2.0,
                alpha=alpha,
            )
    for index in range(13):
        point = _joint_xy(frame, index)
        if point and point[2] >= config.MIN_VISIBILITY:
            axis.scatter(point[0], point[1], s=14, color=color, alpha=alpha)
    if not show_hands:
        return
    for side, wrist_index, finger_start in (("left", 13, 15), ("right", 14, 35)):
        wrist = _joint_xy(frame, wrist_index)
        if not wrist or wrist[2] < config.MIN_VISIBILITY:
            continue
        hand_color = "#1565C0" if side == "left" else "#AD1457"
        points = [wrist] + [_joint_xy(frame, finger_start + i) for i in range(20)]
        for start, end in HAND_CONNECTIONS:
            point_a = points[start]
            point_b = points[end]
            if point_a and point_b and point_a[2] >= config.MIN_VISIBILITY and point_b[2] >= config.MIN_VISIBILITY:
                axis.plot(
                    [point_a[0], point_b[0]],
                    [point_a[1], point_b[1]],
                    color=hand_color,
                    linewidth=1.2,
                    alpha=alpha,
                )
        for point in points:
            if point and point[2] >= config.MIN_VISIBILITY:
                axis.scatter(point[0], point[1], s=8, color=hand_color, alpha=alpha)


def plot_skeleton_montage(
    sample: Sample,
    frame_indices: Sequence[int] | None = None,
    filename: str | None = None,
) -> Path:
    setup_style()
    if frame_indices is None:
        frame_indices = [0, 3, 6, 9, 12, 15]
    frame_indices = [index for index in frame_indices if 0 <= index < len(sample.frames)]
    ncols = 3
    nrows = int(np.ceil(len(frame_indices) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(4.0 * ncols, 4.0 * nrows), squeeze=False)
    for axis in axes.flat:
        axis.set_axis_off()
    for axis, index in zip(axes.flat, frame_indices):
        axis.set_axis_on()
        draw_skeleton(axis, sample.frames[index])
        axis.set_title(f"frame {index} — t = {sample.frames[index].get('timestamp', 0):.0f} ms")
        axis.set_aspect("equal", adjustable="datalim")
        axis.axhline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
        axis.axvline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
    fig.suptitle(f"Esqueleto canônico — {sample.sample_id}", y=1.01)
    path = save_figure(fig, filename or "05_montagem_esqueleto.png")
    plt.close(fig)
    return path


def plot_hand_shape_montage(
    sample: Sample,
    frame_indices: Sequence[int] | None = None,
    filename: str | None = None,
) -> Path:
    """Plot normalised hand geometry relative to the wrist and palm scale."""

    setup_style()
    if frame_indices is None:
        frame_indices = [0, 5, 10, 15]
    frame_indices = [index for index in frame_indices if 0 <= index < len(sample.frames)]
    fig, axes = plt.subplots(
        2, max(1, len(frame_indices)), figsize=(3.1 * max(1, len(frame_indices)), 6.0), squeeze=False
    )
    for column, frame_index in enumerate(frame_indices):
        frame = sample.frames[frame_index]
        for row, (wrist_index, start, label) in enumerate(
            ((13, 15, "mão esquerda"), (14, 35, "mão direita"))
        ):
            axis = axes[row, column]
            wrist = _joint_xy(frame, wrist_index)
            points = [_joint_xy(frame, start + i) for i in range(20)]
            if not wrist or wrist[2] < config.MIN_VISIBILITY:
                axis.text(0.5, 0.5, "não visível", ha="center", va="center")
                axis.set_axis_off()
                continue
            middle = _joint_xy(frame, start + 8)
            scale = (
                float(np.hypot(middle[0] - wrist[0], middle[1] - wrist[1]))
                if middle and middle[2] >= config.MIN_VISIBILITY
                else 0.0
            )
            scale = max(scale, config.MIN_PALM_SCALE)
            xs = [(wrist[0])]
            ys = [(wrist[1])]
            for point in points:
                if point and point[2] >= config.MIN_VISIBILITY:
                    xs.append(point[0])
                    ys.append(point[1])
            xs = (np.array(xs) - wrist[0]) / scale
            ys = (np.array(ys) - wrist[1]) / scale
            axis.scatter(xs, ys, s=22, color="#1565C0" if row == 0 else "#AD1457")
            hand_points = [wrist] + points
            for start_joint, end_joint in HAND_CONNECTIONS:
                a = hand_points[start_joint]
                b = hand_points[end_joint]
                if a and b and a[2] >= config.MIN_VISIBILITY and b[2] >= config.MIN_VISIBILITY:
                    axis.plot(
                        [(a[0] - wrist[0]) / scale, (b[0] - wrist[0]) / scale],
                        [(a[1] - wrist[1]) / scale, (b[1] - wrist[1]) / scale],
                        color="#37474F",
                        linewidth=1.0,
                    )
            axis.set_title(f"{label} — frame {frame_index}")
            axis.set_xlabel("x / escala da palma")
            axis.set_ylabel("y / escala da palma")
            axis.set_aspect("equal", adjustable="datalim")
    fig.suptitle(f"Geometria normalizada das mãos — {sample.sample_id}", y=1.01)
    path = save_figure(fig, filename or "05_forma_maos.png")
    plt.close(fig)
    return path


def animate_skeleton(
    sample: Sample,
    filename: str = "05_animacao_esqueleto.gif",
    fps: int = 6,
) -> Path:
    """Save a simple GIF animation of one sequence."""

    setup_style()
    fig, axis = plt.subplots(figsize=(5.2, 5.2))
    all_x = []
    all_y = []
    for frame in sample.frames:
        for index in range(config.LANDMARK_COUNT):
            point = _joint_xy(frame, index)
            if point and point[2] >= config.MIN_VISIBILITY:
                all_x.append(point[0])
                all_y.append(point[1])
    if all_x:
        margin = 0.25
        axis.set_xlim(min(all_x) - margin, max(all_x) + margin)
        axis.set_ylim(min(all_y) - margin, max(all_y) + margin)
    axis.set_aspect("equal", adjustable="box")
    axis.set_xlabel("x canônico")
    axis.set_ylabel("y canônico")
    axis.axhline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
    axis.axvline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
    title = axis.set_title("")
    writer = PillowWriter(fps=fps)

    def update(index: int):
        axis.clear()
        axis.set_xlim(min(all_x) - 0.25, max(all_x) + 0.25)
        axis.set_ylim(min(all_y) - 0.25, max(all_y) + 0.25)
        axis.set_aspect("equal", adjustable="box")
        axis.set_xlabel("x canônico")
        axis.set_ylabel("y canônico")
        axis.axhline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
        axis.axvline(0, color="#CFD8DC", linewidth=0.5, linestyle=":")
        draw_skeleton(axis, sample.frames[index])
        axis.set_title(
            f"{sample.sample_id}\nframe {index + 1}/{len(sample.frames)}"
        )

    animation = FuncAnimation(
        fig, update, frames=len(sample.frames), interval=1000 / fps, blit=False
    )
    path = config.output_path("figure", filename)
    animation.save(path, writer=writer)
    plt.close(fig)
    return path


def plot_hand_visibility_timeline(
    frame_quality: pd.DataFrame,
    filename: str = "02_linha_tempo_visibilidade.png",
) -> Path:
    setup_style()
    data = frame_quality.sort_values(["dataset_split", "sample_id"]).reset_index(drop=True)
    fig, axis = plt.subplots(figsize=(9, max(6, 0.23 * len(data))))
    matrix = data[["any_hand_frames", "both_hands_frames", "left_hand_frames", "right_hand_frames"]]
    sns.heatmap(
        matrix,
        cmap="YlGnBu",
        vmin=0,
        vmax=16,
        yticklabels=data["sample_id"],
        cbar_kws={"label": "Frames (máx. 16)"},
        ax=axis,
    )
    axis.set_title("Linha de visibilidade das mãos por amostra")
    axis.set_xlabel("Indicador")
    axis.set_ylabel("Amostra")
    path = save_figure(fig, filename)
    plt.close(fig)
    return path

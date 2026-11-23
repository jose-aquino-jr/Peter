"""Create MediaPipe reference sequences from rendered VLibras animation videos."""
import argparse
from pathlib import Path
import sys

import mediapipe as mp
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.recognition import sequence_from_video


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path, help="VLibras animation video rendered against a plain background")
    parser.add_argument("--label", required=True, help="Canonical sign label, e.g. OBRIGADO")
    parser.add_argument("--translation", required=True, help="Portuguese display text")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "references")
    args = parser.parse_args()
    config = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    cfg = config["mediapipe"]
    args.out.mkdir(parents=True, exist_ok=True)
    with mp.solutions.hands.Hands(static_image_mode=False, max_num_hands=cfg["max_hands"],
            min_detection_confidence=cfg["min_detection_confidence"],
            min_tracking_confidence=cfg["min_tracking_confidence"]) as model:
        # The rendered reference and webcam must use the same mirroring convention.
        seq = sequence_from_video(args.video, model, mirror=config["camera"]["mirror"])
    if not seq[:, 126:128].any():
        print("Erro: nenhum landmark de mão detectado no vídeo de referência; ajuste o enquadramento/renderização.")
        return 2
    safe_label = "".join(c if c.isalnum() or c in "- _" else "_" for c in args.label).strip()
    out = args.out / f"{safe_label}.npz"
    np.savez_compressed(out, sequence=seq, label=args.label, translation=args.translation,
                        source_video=str(args.video))
    detected = int(seq[:, 126:128].any(axis=1).sum())
    print(f"Salvo: {out} ({len(seq)} frames; {detected} com alguma mão detectada)")
    if detected < len(seq) * 0.5:
        print("Aviso: menos da metade dos frames teve landmarks; revise a renderização.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Webcam 1:1 matching against VLibras-derived MediaPipe sequences."""
from datetime import datetime, timezone
from pathlib import Path
import sys

import cv2
import mediapipe as mp
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.landmarks import extract_hands, normalize_frame
from src.recognition import append_result, classify, load_references, trim_empty_edges


def main() -> int:
    config = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    refs_dir = ROOT / "data" / "references"
    references = load_references(refs_dir)
    if not references:
        print("Nenhuma referência. Gere vídeos de animação VLibras e rode scripts/build_references.py.")
        return 2
    expected = input("Sinal que você vai executar (para registrar a avaliação; vazio = não informado): ").strip().upper()
    cam, mp_cfg = config["camera"], config["mediapipe"]
    cap = cv2.VideoCapture(cam["index"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cam["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cam["height"])
    if not cap.isOpened():
        print("Erro: não foi possível abrir a câmera.")
        return 1
    frames, recording, result_text = [], False, "Espaço: iniciar/parar gravação | q: sair"
    model_cls = mp.solutions.hands
    with model_cls(static_image_mode=False, max_num_hands=mp_cfg["max_hands"],
            min_detection_confidence=mp_cfg["min_detection_confidence"],
            min_tracking_confidence=mp_cfg["min_tracking_confidence"]) as model:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if cam["mirror"]:
                frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            result = model.process(rgb)
            rgb.flags.writeable = True
            detected = extract_hands(result)
            if recording:
                frames.append(normalize_frame(detected))
            if result.multi_hand_landmarks:
                for hand in result.multi_hand_landmarks:
                    mp.solutions.drawing_utils.draw_landmarks(frame, hand, model_cls.HAND_CONNECTIONS)
            status = f"GRAVANDO {len(frames)} frames" if recording else result_text
            cv2.putText(frame, status[:100], (15, 35), cv2.FONT_HERSHEY_SIMPLEX, .65, (30, 240, 30), 2)
            cv2.imshow("Peter - validação 1:1", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == 32:
                if not recording:
                    frames = []
                    recording = True
                    result_text = "Gravando... pressione espaço para comparar"
                else:
                    recording = False
                    if len(frames) < 5:
                        result_text = "Sequência curta: grave novamente"
                        continue
                    ranked = classify(trim_empty_edges(np.stack(frames)), references)
                    best = ranked[0]
                    verdict = "" if not expected else expected == best["label"].upper()
                    record = {"timestamp_utc": datetime.now(timezone.utc).isoformat(),
                              "expected": expected or None, "predicted": best["label"],
                              "translation": best["translation"], "similarity_percent": best["similarity"],
                              "distance": best["distance"], "correct": verdict,
                              "frames": len(frames), "ranking": ranked}
                    append_result(ROOT / "data" / "results.jsonl", record)
                    result_text = f"Sinal: {best['label']} | Similaridade: {best['similarity']:.1f}% | {best['translation']}"
                    print(result_text, "| esperado:", expected or "não informado")
    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from pathlib import Path
import sys

import cv2
import mediapipe as mp
import yaml


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.landmarks import extract_hands


def load_config() -> dict:
    with (ROOT / "config.yaml").open("r", encoding="utf-8") as file:
        return yaml.safe_load(file)


def main() -> int:
    config = load_config()
    camera_config = config["camera"]
    media_config = config["mediapipe"]

    cap = cv2.VideoCapture(camera_config["index"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, camera_config["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, camera_config["height"])
    if not cap.isOpened():
        print("Erro: não foi possível abrir a câmera.")
        return 1

    mp_hands = mp.solutions.hands
    mp_drawing = mp.solutions.drawing_utils
    mp_styles = mp.solutions.drawing_styles

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=media_config["max_hands"],
        min_detection_confidence=media_config["min_detection_confidence"],
        min_tracking_confidence=media_config["min_tracking_confidence"],
    ) as hands:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("Erro: não foi possível ler um frame da câmera.")
                break

            if camera_config["mirror"]:
                frame = cv2.flip(frame, 1)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = hands.process(rgb)
            rgb.flags.writeable = True

            detected = extract_hands(results)
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        frame,
                        hand_landmarks,
                        mp_hands.HAND_CONNECTIONS,
                        mp_styles.get_default_hand_landmarks_style(),
                        mp_styles.get_default_hand_connections_style(),
                    )

            labels = " | ".join(
                f"{hand.handedness}: {hand.score:.2f}" for hand in detected
            )
            cv2.putText(
                frame,
                labels or "Nenhuma mão detectada",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )
            cv2.imshow("Etapa 1 - MediaPipe Hands", frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

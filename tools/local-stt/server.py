from __future__ import annotations

import json
import os
import array
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from vosk import KaldiRecognizer, Model, SetLogLevel


ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("PETER_VOSK_MODEL_PATH", ROOT / "model"))
HOST = "127.0.0.1"
PORT = 8765
MAX_AUDIO_BYTES = 20 * 1024 * 1024
SetLogLevel(-1)


class Handler(BaseHTTPRequestHandler):
    server_version = "PeterLocalSTT/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "endpoint não encontrado"})
            return
        self.send_json(200, {"status": "ready", "engine": "vosk", "language": "pt-BR"})

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            self.send_json(404, {"error": "endpoint não encontrado"})
            return
        started_at = time.monotonic()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            print(
                f"[Peter STT] Recebendo WAV: {length} bytes; transfer={self.headers.get('Transfer-Encoding', 'content-length')}",
                flush=True,
            )
            if length <= 44 or length > MAX_AUDIO_BYTES:
                raise ValueError("áudio vazio ou maior que o limite de 20 MB")
            audio = self.rfile.read(length)
            with wave.open(__import__("io").BytesIO(audio), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000:
                    raise ValueError("o áudio deve ser WAV mono PCM16 a 16 kHz")
                original_frames = wav.getnframes()
                pcm = wav.readframes(original_frames)
                trimmed_pcm = trim_silence(pcm, padding_frames=3200)
                if not trimmed_pcm:
                    self.send_json(200, {"text": ""})
                    return
                recognizer = KaldiRecognizer(self.server.model, 16000)
                recognizer.SetWords(False)
                print(
                    f"[Peter STT] Áudio: {original_frames / 16000:.1f}s; após remoção de silêncio: {len(trimmed_pcm) / 32000:.1f}s",
                    flush=True,
                )
                recognizer.AcceptWaveform(trimmed_pcm)
                result = json.loads(recognizer.FinalResult())
            print(f"[Peter STT] Reconhecimento concluiu em {time.monotonic() - started_at:.1f}s", flush=True)
            self.send_json(200, {"text": result.get("text", "")})
        except (ValueError, wave.Error) as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": f"falha ao reconhecer áudio localmente: {error}"})

    def send_json(self, status: int, value: dict[str, object]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: object) -> None:
        print(f"[Peter STT] {format % args}")


def main() -> None:
    if not ((MODEL_PATH / "am" / "final.mdl").is_file() or (MODEL_PATH / "final.mdl").is_file()):
        raise SystemExit(
            f"Modelo Vosk não encontrado em {MODEL_PATH}. Execute tools/local-stt/setup.ps1 primeiro."
        )
    print(f"Carregando modelo de português local: {MODEL_PATH}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.model = Model(str(MODEL_PATH))
    print(f"Transcrição local pronta em http://{HOST}:{PORT} (Ctrl+C para sair)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Encerrando serviço de transcrição.")
    finally:
        server.server_close()


def trim_silence(pcm_bytes: bytes, padding_frames: int = 3200, threshold: int = 400) -> bytes:
    samples = array.array("h")
    samples.frombytes(pcm_bytes)
    if os.sys.byteorder != "little":
        samples.byteswap()
    block_size = 1600  # 100 ms at 16 kHz
    levels: list[tuple[int, float]] = []
    for start in range(0, len(samples), block_size):
        block = samples[start : start + block_size]
        if not block:
            continue
        rms = (sum(sample * sample for sample in block) / len(block)) ** 0.5
        levels.append((start, rms))
    if not levels:
        return b""
    baseline_index = max(0, int(len(levels) * 0.2) - 1)
    noise_floor = sorted(level for _, level in levels)[baseline_index]
    active_threshold = max(threshold, noise_floor * 4.0)
    active_blocks = [start for start, level in levels if level >= active_threshold]
    print(
        f"[Peter STT] Nível de ruído estimado {noise_floor:.0f}; limiar {active_threshold:.0f}; blocos ativos {len(active_blocks)}/{len(levels)}",
        flush=True,
    )
    if not active_blocks:
        return b""
    first = max(0, active_blocks[0] - padding_frames)
    last = min(len(samples), active_blocks[-1] + block_size + padding_frames)
    selected = samples[first:last]
    if os.sys.byteorder != "little":
        selected.byteswap()
    return selected.tobytes()


if __name__ == "__main__":
    main()

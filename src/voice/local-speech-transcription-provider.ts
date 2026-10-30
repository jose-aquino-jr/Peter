import type { TranscriptionCallbacks, TranscriptionProvider } from "./speech-to-text-engine";

const TRANSCRIBE_URL = import.meta.env.DEV ? "/stt/transcribe" : "http://127.0.0.1:8765/transcribe";
const SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 60_000;

interface TranscriptionResult {
  readonly text?: unknown;
  readonly error?: unknown;
}

/** Captures audio in the browser and transcribes it with the local Vosk service. */
export class LocalSpeechTranscriptionProvider implements TranscriptionProvider {
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private chunks: Blob[] = [];
  private callbacks: TranscriptionCallbacks | undefined;
  private maxDurationTimer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  get supported(): boolean {
    return typeof window !== "undefined" &&
      window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined" &&
      typeof AudioContext !== "undefined" &&
      typeof OfflineAudioContext !== "undefined";
  }

  async start(callbacks: TranscriptionCallbacks): Promise<void> {
    if (!this.supported) throw new Error("Este navegador não oferece gravação de áudio local compatível.");
    if (this.recorder) throw new Error("A captura do microfone já está ativa.");

    this.callbacks = callbacks;
    this.chunks = [];
    this.stopping = false;
    try {
      let health: Response;
      try {
        health = await fetch(TRANSCRIBE_URL.replace(/\/transcribe$/, "/health"), {
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        throw new Error("O serviço de transcrição local está parado. Execute tools/local-stt/start.ps1.");
      }
      if (!health.ok) throw new Error("O serviço local de transcrição não está pronto. Execute tools/local-stt/start.ps1.");
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        void this.finish(new Error("A gravação do microfone foi interrompida."));
      };
      recorder.onstop = () => { void this.transcribeRecording(); };
      await new Promise<void>((resolve, reject) => {
        recorder.onstart = () => resolve();
        try { recorder.start(250); } catch (error) {
          reject(error instanceof Error ? error : new Error("Não foi possível iniciar o microfone."));
        }
      });
      this.maxDurationTimer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    } catch (error) {
      this.releaseCapture();
      throw normalizeMicrophoneError(error);
    }
  }

  stop(): void {
    if (!this.recorder || this.stopping) return;
    this.stopping = true;
    this.clearMaxDurationTimer();
    this.callbacks?.onInterimResult("");
    this.recorder.stop();
  }

  private async transcribeRecording(): Promise<void> {
    const callbacks = this.callbacks;
    const recorder = this.recorder;
    if (!callbacks || !recorder) return;
    try {
      callbacks.onInterimResult("Preparando gravação...");
      const recording = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
      if (recording.size === 0) throw new Error("Não foi gravado áudio. Toque no microfone e tente novamente.");
      callbacks.onInterimResult("Convertendo áudio para o reconhecedor local...");
      const wav = await this.toWav(recording);
      callbacks.onInterimResult("Reconhecendo fala localmente...");
      const response = await fetch(TRANSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
        signal: AbortSignal.timeout(45_000),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const detail = isTranscriptionResult(payload) && typeof payload.error === "string" ? payload.error : undefined;
        throw new Error(detail ?? `O serviço local de transcrição respondeu HTTP ${response.status}.`);
      }
      if (!isTranscriptionResult(payload) || typeof payload.text !== "string") {
        throw new Error("O serviço local retornou uma transcrição inválida.");
      }
      if (!payload.text.trim()) throw new Error("Não reconheci fala nesse áudio. Tente falar mais perto do microfone.");
      callbacks.onFinalResult(payload.text.trim());
    } catch (error) {
      callbacks.onError(error instanceof TypeError
        ? new Error("Não foi possível acessar o serviço local de transcrição. Confirme se ele está em execução.")
        : error instanceof Error ? error : new Error("Falha na transcrição local."));
    } finally {
      this.releaseCapture();
      callbacks.onEnd();
    }
  }

  private async toWav(blob: Blob): Promise<Blob> {
    const audioContext = new AudioContext();
    try {
      const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
      const frameCount = Math.ceil(decoded.duration * SAMPLE_RATE);
      const offline = new OfflineAudioContext(1, frameCount, SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const resampled = await offline.startRendering();
      const pcm = floatToPcm16(resampled.getChannelData(0));
      return new Blob([encodeWav(pcm, SAMPLE_RATE)], { type: "audio/wav" });
    } finally {
      await audioContext.close();
    }
  }

  private async finish(error: Error): Promise<void> {
    const callbacks = this.callbacks;
    this.releaseCapture();
    callbacks?.onError(error);
    callbacks?.onEnd();
  }

  private releaseCapture(): void {
    this.clearMaxDurationTimer();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.recorder = undefined;
    this.chunks = [];
    this.callbacks = undefined;
    this.stopping = false;
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.maxDurationTimer = undefined;
  }
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function isTranscriptionResult(value: unknown): value is TranscriptionResult {
  return typeof value === "object" && value !== null;
}

function normalizeMicrophoneError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return new Error("Permita o acesso ao microfone nas configurações do navegador.");
  }
  return error instanceof Error ? error : new Error("Não foi possível iniciar o microfone.");
}

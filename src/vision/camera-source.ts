import type { EventBus } from "../core/event-bus";
import { peterConfig } from "../core/config";
import { logger } from "../core/logger";

export class CameraSource {
  private videoStream: MediaStream | undefined;
  private videoElement: HTMLVideoElement | undefined;
  private requestId = 0;

  constructor(private readonly events: EventBus) {}

  async start(video: HTMLVideoElement): Promise<void> {
    const requestId = ++this.requestId;
    this.events.emit({ type: "vision.camera-status", status: "requesting" });
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Este navegador não oferece acesso à câmera.";
      this.events.emit({ type: "vision.camera-status", status: "error", message });
      throw new Error(message);
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: peterConfig.camera.video,
      });
      this.videoStream = videoStream;
      if (requestId !== this.requestId) {
        videoStream.getTracks().forEach((track) => track.stop());
        this.videoStream = undefined;
        return;
      }
      this.videoElement = video;
      video.srcObject = videoStream;
      await video.play();
      this.events.emit({ type: "vision.camera-status", status: "ready" });
      logger.info("vision", "Camera stream started");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível iniciar a câmera.";
      this.stop(video);
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      this.events.emit({
        type: "vision.camera-status",
        status: denied ? "denied" : "error",
        message,
      });
      logger.error("vision", "Camera startup failed", error);
      throw error;
    }
  }

  stop(video?: HTMLVideoElement): void {
    this.requestId += 1;
    this.videoStream?.getTracks().forEach((track) => track.stop());
    this.videoStream = undefined;
    const target = video ?? this.videoElement;
    if (target) {
      target.srcObject = null;
    }
    this.videoElement = undefined;
    this.events.emit({ type: "vision.camera-status", status: "idle" });
  }
}

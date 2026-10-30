import type { EventBus } from "../core/event-bus";
import type { AvatarCommand } from "../core/events";
import { logger } from "../core/logger";
import type { Emotion, Gesture } from "../core/messages";
import type { AvatarEngine } from "./avatar-engine";
import type { CanonicalSkeletonFrame } from "../vision/pipeline/canonical-skeleton";
import type { SignTemplate } from "../vision/pipeline/sign-template-repository";
import type { VlibrasAnimation, RetargetBinding } from "./vlibras-animation";

export interface AvatarRuntimePort {
  playGesture(gesture: Gesture): void;
  setEmotion(emotion: Emotion): void;
  lookAt(target: "camera"): void;
  stopGesture(): void;
  playLibrasFrames(frames: readonly CanonicalSkeletonFrame[]): void;
  cancelLibrasFrames(): void;
  playSourceAnimation(animation: VlibrasAnimation, bindings: readonly RetargetBinding[]): void;
  cancelSourceAnimation(): void;
  update(delta: number): void;
}

export class VrmAvatarController implements AvatarEngine {
  private runtime: AvatarRuntimePort | undefined;
  private emotion: Emotion = "neutral";
  private gesture: Gesture | undefined;
  private librasRun = 0;

  constructor(private readonly events: EventBus) {
    this.events.emit({
      type: "avatar.status",
      status: "mock",
      message: "Avatar em modo demonstrativo até um arquivo VRM ser carregado.",
    });
  }

  start(): void {
    this.events.emit({
      type: "avatar.status",
      status: "mock",
      message: "Avatar aguardando a conexão do renderer VRM.",
    });
  }

  stop(): void {
    this.runtime = undefined;
  }

  attachRuntime(runtime: AvatarRuntimePort): () => void {
    this.runtime = runtime;
    runtime.setEmotion(this.emotion);
    runtime.lookAt("camera");
    if (this.gesture) {
      runtime.playGesture(this.gesture);
    }
    this.events.emit({
      type: "avatar.status",
      status: "vrm-ready",
      message: "Avatar VRM carregado.",
    });

    return () => {
      if (this.runtime === runtime) {
        this.runtime = undefined;
        this.events.emit({
          type: "avatar.status",
          status: "mock",
          message: "VRM descarregado; comandos exibidos em modo demonstrativo.",
        });
      }
    };
  }

  playGesture(gesture: Gesture): void {
    this.gesture = gesture;
    this.execute({ type: "gesture", gesture }, () => this.runtime?.playGesture(gesture));
  }

  async playLibrasSequence(templates: readonly SignTemplate[]): Promise<void> {
    const run = ++this.librasRun;
    this.runtime?.cancelLibrasFrames();
    this.runtime?.cancelSourceAnimation();
    for (const template of templates) {
      if (run !== this.librasRun) return;
      if (!template.canonicalSequence || template.canonicalSequence.length < 2) continue;
      logger.info("VRM", `Executando sinal Libras: ${template.gloss}`);
      this.runtime?.playLibrasFrames(template.canonicalSequence);
      const durationMs = Math.max(400, ((template.duration ?? template.canonicalSequence.at(-1)?.timestamp ?? 1200) * 1000));
      await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
      logger.info("VRM", `Sinal concluído: ${template.gloss}`);
    }
    if (run === this.librasRun) this.runtime?.cancelLibrasFrames();
  }

  /** Kept visible in the development panel, but blocked until source rig calibration exists. */
  async playVLibrasSim(): Promise<void> {
    logger.warn(
      "VRM",
      "SIM bloqueado: o bundle contém curvas, mas não contém o rig/pose de repouso necessários para alinhar os eixos locais ao VRM do Peter.",
    );
  }

  cancelLibrasSequence(): void {
    this.librasRun += 1;
    this.runtime?.cancelLibrasFrames();
    this.runtime?.cancelSourceAnimation();
  }

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion;
    this.execute({ type: "emotion", emotion }, () => this.runtime?.setEmotion(emotion));
  }

  lookAt(target: "camera"): void {
    this.execute({ type: "look-at", target }, () => this.runtime?.lookAt(target));
  }

  stopGesture(): void {
    this.gesture = undefined;
    this.execute({ type: "stop-gesture" }, () => this.runtime?.stopGesture());
  }

  reportRuntimeError(message: string): void {
    this.events.emit({ type: "avatar.status", status: "error", message });
    this.events.emit({ type: "core.error", source: "avatar", message });
    logger.error("avatar", message);
  }

  private execute(command: AvatarCommand, apply: () => void): void {
    try {
      apply();
      this.events.emit({ type: "avatar.command", command });
      if (!this.runtime) {
        logger.info("avatar", "Mock command", command);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao executar comando do avatar.";
      this.events.emit({ type: "avatar.status", status: "error", message });
      this.events.emit({ type: "core.error", source: "avatar", message });
      logger.error("avatar", "Command failed", error);
    }
  }
}

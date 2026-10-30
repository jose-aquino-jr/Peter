import { useEffect, useRef } from "react";
import type { Emotion, Gesture } from "../../core/messages";
import type { VrmAvatarController } from "../vrm-avatar-controller";

interface AvatarStageProps {
  readonly controller: VrmAvatarController;
  readonly modelUrl?: string;
  readonly emotion: Emotion;
  readonly gesture?: Gesture;
}

export function AvatarStage({
  controller,
  modelUrl,
  emotion,
  gesture,
}: AvatarStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !modelUrl) {
      return;
    }
    let disposed = false;
    let disposeRenderer = () => {};
    void import("../vrm-renderer")
      .then(({ mountVrmAvatar }) => {
        if (!disposed) {
          disposeRenderer = mountVrmAvatar(canvas, modelUrl, controller);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          const message =
            error instanceof Error ? error.message : "Falha ao iniciar o renderizador VRM.";
          controller.reportRuntimeError(message);
        }
      });
    return () => {
      disposed = true;
      disposeRenderer();
    };
  }, [controller, modelUrl]);

  return (
    <div className={`avatar-stage${modelUrl ? " avatar-stage--vrm" : ""}`}>
      <div className="avatar-stage__ambient" aria-hidden="true" />
      <div className="avatar-stage__model">
        {!modelUrl ? <MockAvatar emotion={emotion} gesture={gesture} /> : null}
        <canvas
          ref={canvasRef}
          className="avatar-stage__canvas"
          aria-label={modelUrl ? "Avatar VRM" : undefined}
          hidden={!modelUrl}
        />
      </div>
    </div>
  );
}

function MockAvatar({ emotion, gesture }: { emotion: Emotion; gesture?: Gesture }) {
  return (
    <div
      className={`mock-avatar mock-avatar--${emotion}${gesture ? ` mock-avatar--${gesture}` : ""}`}
      aria-label={`Avatar demonstrativo: ${emotion}${gesture ? `, ${gesture}` : ""}`}
      role="img"
    >
      <svg viewBox="0 0 320 410" className="mock-avatar__illustration" aria-hidden="true">
        <defs>
          <linearGradient id="shirt" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#d8b553" />
            <stop offset="1" stopColor="#92732d" />
          </linearGradient>
          <linearGradient id="skin" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f5c7aa" />
            <stop offset="1" stopColor="#d99578" />
          </linearGradient>
        </defs>
        <ellipse cx="160" cy="385" rx="103" ry="18" fill="#06070b" opacity=".45" />
        <path d="M62 367c4-95 29-143 98-143s94 48 98 143z" fill="url(#shirt)" />
        <path d="M119 211h82v58c-19 20-63 20-82 0z" fill="url(#skin)" />
        <ellipse cx="160" cy="138" rx="78" ry="94" fill="url(#skin)" />
        <path d="M83 137c-8-69 27-107 82-107 55 0 80 38 72 105-12-7-21-23-25-42-27 23-67 32-124 25z" fill="#211f1a" />
        <path d="M100 136c12-7 27-7 39 0m42 0c12-7 27-7 39 0" fill="none" stroke="#50473a" strokeLinecap="round" strokeWidth="5" />
        <ellipse cx="121" cy="151" rx="5" ry="7" fill="#25221b" />
        <ellipse cx="198" cy="151" rx="5" ry="7" fill="#25221b" />
        <path className="mock-avatar__mouth" d="M139 185q21 15 42 0" fill="none" stroke="#98774b" strokeLinecap="round" strokeWidth="4" />
        <path d="M86 262 51 341m183-79 35 79" fill="none" stroke="#f0bc9d" strokeLinecap="round" strokeWidth="24" />
        <path className="mock-avatar__arm" d="M82 265 54 195" fill="none" stroke="#f0bc9d" strokeLinecap="round" strokeWidth="23" />
        <circle className="mock-avatar__hand" cx="52" cy="190" r="13" fill="#f0bc9d" />
      </svg>
      <span className="mock-avatar__label">MOCK</span>
    </div>
  );
}

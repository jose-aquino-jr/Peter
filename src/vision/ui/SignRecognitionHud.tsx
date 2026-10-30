import { useEffect, useRef } from "react";
import { drawLandmarkFrame } from "../mediapipe/draw-landmarks";
import type { SignRecognitionDebugSnapshot } from "../pipeline/debug";
import type { MvpSign } from "../pipeline/mvp-signs";
import { isRecommendedCalibration, RECOMMENDED_CALIBRATION_GLOSSES } from "../pipeline/mvp-signs";
import type { SignTemplate } from "../pipeline/sign-template-repository";

interface RecognitionUiProps {
  readonly snapshot?: SignRecognitionDebugSnapshot;
  readonly catalog: readonly MvpSign[];
  readonly templates: readonly SignTemplate[];
  readonly selectedGloss: string;
  readonly onSelectGloss: (gloss: string) => void;
  readonly onRecord: () => void;
  readonly onCancelCalibration: () => void;
  readonly onDeleteTemplate: (id: string) => void;
}

export function SignRecognitionHud({
  snapshot,
  cameraEnabled,
}: {
  readonly snapshot?: SignRecognitionDebugSnapshot;
  readonly cameraEnabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusLabel = snapshot?.matchStatus === "match"
    ? snapshot.detectedSign ?? "MATCH"
    : snapshot?.matchStatus === "calibrating"
      ? "GRAVANDO"
      : snapshot?.matchStatus === "no_match"
        ? "NO_MATCH"
        : "—";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    drawLandmarkFrame(canvas, snapshot?.frame);
  }, [snapshot?.frame]);

  if (!cameraEnabled) {
    return null;
  }

  return (
    <>
      <canvas ref={canvasRef} className="self-preview__landmarks" aria-hidden="true" />
      <div className="libras-hud" aria-live="polite">
        <p>
          <strong>CAMERA ●</strong>
          <span>{snapshot?.extractorStatus === "ready" ? "landmarks ok" : snapshot?.extractorStatus ?? "idle"}</span>
        </p>
        <p>
          <strong>Detected</strong>
          <span>{statusLabel}</span>
        </p>
        <p>
          <strong>Confidence</strong>
          <span>{snapshot?.confidence != null ? `${Math.round(snapshot.confidence * 100)}%` : "—"}</span>
        </p>
        <p>
          <strong>FPS</strong>
          <span>{snapshot?.fps ?? 0}</span>
        </p>
        <p>
          <strong>Latency</strong>
          <span>{snapshot?.latencyMs ?? 0} ms</span>
        </p>
        <p>
          <strong>Buffer</strong>
          <span>{snapshot?.bufferFrames ?? 0} frames</span>
        </p>
        <p>
          <strong>Best</strong>
          <span>
            {snapshot?.bestCandidate
              ? `${snapshot.bestCandidate.sign} ${Math.round(snapshot.bestCandidate.confidence * 100)}%`
              : "NO_MATCH"}
          </span>
        </p>
      </div>
    </>
  );
}

export function LibrasTestPanel({
  snapshot,
  catalog,
  templates,
  selectedGloss,
  onSelectGloss,
  onRecord,
  onCancelCalibration,
  onDeleteTemplate,
}: RecognitionUiProps) {
  const templatesForSign = templates.filter((template) => template.gloss === selectedGloss);
  return (
    <section className="libras-test-panel" aria-label="Teste de reconhecimento de Libras">
      <header>
        <h2>Teste de Libras</h2>
        <p>
          {snapshot?.extractorMessage
            ?? "Grave templates com a câmera e compare o movimento em tempo real."}
        </p>
      </header>
      <dl>
        <div>
          <dt>Melhor candidato</dt>
          <dd>
            {snapshot?.bestCandidate
              ? `${snapshot.bestCandidate.sign} · ${Math.round(snapshot.bestCandidate.confidence * 100)}%`
              : "NO_MATCH"}
          </dd>
        </div>
        <div>
          <dt>Templates</dt>
          <dd>{snapshot?.templateCount ?? templates.length}</dd>
        </div>
        <div>
          <dt>Memória</dt>
          <dd>{snapshot?.memoryMb != null ? `${snapshot.memoryMb} MB` : "n/d"}</dd>
        </div>
        <div>
          <dt>Mãos / pose</dt>
          <dd>
            {snapshot?.handsDetected ?? 0} / {snapshot?.poseDetected ? "sim" : "não"}
          </dd>
        </div>
      </dl>
      {snapshot?.candidates.length ? (
        <ol className="libras-test-panel__candidates">
          {snapshot.candidates.map((candidate) => (
            <li key={`${candidate.gloss}-${candidate.templateId ?? candidate.sign}`}>
              {candidate.sign}
              <span>{Math.round(candidate.confidence * 100)}%</span>
            </li>
          ))}
        </ol>
      ) : null}
      <label>
        Sinal para gravar
        <select value={selectedGloss} onChange={(event) => onSelectGloss(event.target.value)}>
          {catalog.map((sign) => (
            <option value={sign.gloss} key={sign.id}>
              {sign.gloss}
              {isRecommendedCalibration(sign.gloss) ? " · teste" : ""}
            </option>
          ))}
        </select>
      </label>
      {snapshot?.matchStatus === "calibrating" ? (
        <button type="button" onClick={onCancelCalibration}>
          Cancelar {snapshot.calibrationPhase === "countdown" ? "em" : "gravação"}{" "}
          {Math.ceil((snapshot.calibrationRemainingMs ?? 0) / 1000)}s
        </button>
      ) : (
        <button type="button" onClick={onRecord}>
          Gravar template de {selectedGloss}
        </button>
      )}
      <p className="libras-test-panel__hint">
        Comece pelos 5 sinais de teste: {RECOMMENDED_CALIBRATION_GLOSSES.join(", ")}.
        {" "}
        {templatesForSign.length} template(s) em {selectedGloss}.
      </p>
      {templatesForSign.length > 0 ? (
        <ul className="libras-test-panel__templates">
          {templatesForSign.map((template, index) => (
            <li key={template.id}>
              <span>
                template_{String(index + 1).padStart(2, "0")} ·{" "}
                {template.duration === null ? "duração indisponível" : `${template.duration.toFixed(1)}s`}
              </span>
              {template.metadata.source === "local-camera" ? (
                <button type="button" onClick={() => onDeleteTemplate(template.id)}>
                  Excluir
                </button>
              ) : (
                <span>referência offline · somente leitura</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

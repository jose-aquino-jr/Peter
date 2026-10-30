import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import type { ConversationMessage, ConversationState } from "../core/messages";
import { conversationStatusLabel } from "./conversation-status";
import type { VrmAvatarController } from "../avatar/vrm-avatar-controller";
import { AvatarStage } from "../avatar/ui/AvatarStage";
import type { SignRecognitionDebugSnapshot } from "../vision/pipeline/debug";
import { MVP_SIGNS } from "../vision/pipeline/mvp-signs";
import type { SignTemplate } from "../vision/pipeline/sign-template-repository";
import { LibrasTestPanel, SignRecognitionHud } from "../vision/ui/SignRecognitionHud";

type CallStatus = ConversationState;

interface CallScreenProps {
  readonly avatar: VrmAvatarController;
  readonly cameraError?: string;
  readonly microphoneError?: string;
  readonly voiceError?: string;
  readonly avatarError?: string;
  readonly brainError?: string;
  readonly llmStatus: {
    readonly status: "checking" | "available" | "unavailable" | "model-missing";
    readonly model: string;
    readonly message: string;
  };
  readonly cameraEnabled: boolean;
  readonly microphoneEnabled: boolean;
  readonly microphoneSupported: boolean;
  readonly cameraStarting: boolean;
  readonly callStatus: CallStatus;
  readonly messages: readonly ConversationMessage[];
  readonly interimTranscript: string;
  readonly modelUrl?: string;
  readonly onCameraToggle: () => void;
  readonly onMessageSend: (text: string) => void;
  readonly onMicrophoneToggle: () => void;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly debugVision: boolean;
  readonly librasTestMode: boolean;
  readonly onPlayVLibrasSim: () => void;
  readonly recognition?: SignRecognitionDebugSnapshot;
  readonly recognitionTemplates: readonly SignTemplate[];
  readonly selectedGloss: string;
  readonly onSelectGloss: (gloss: string) => void;
  readonly onRecordTemplate: () => void;
  readonly onCancelCalibration: () => void;
  readonly onDeleteTemplate: (id: string) => void;
}

export function CallScreen({
  avatar,
  cameraError,
  microphoneError,
  voiceError,
  avatarError,
  brainError,
  llmStatus,
  cameraEnabled,
  microphoneEnabled,
  microphoneSupported,
  cameraStarting,
  callStatus,
  messages,
  interimTranscript,
  modelUrl,
  onCameraToggle,
  onMessageSend,
  onMicrophoneToggle,
  videoRef,
  debugVision,
  librasTestMode,
  onPlayVLibrasSim,
  recognition,
  recognitionTemplates,
  selectedGloss,
  onSelectGloss,
  onRecordTemplate,
  onCancelCalibration,
  onDeleteTemplate,
}: CallScreenProps) {
  const [draft, setDraft] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  useEffect(() => {
    if (isChatOpen && conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [isChatOpen, messages]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) {
      return;
    }
    onMessageSend(draft);
    setDraft("");
  }

  return (
    <main className="call-screen">
      <header className="call-header">
        <div className="call-header__identity">
          <span className="call-header__mark" aria-hidden="true">P</span>
          <strong>Peter</strong>
        </div>
        <div className="connection-status" aria-live="polite">
          <span className={`connection-status__dot connection-status__dot--${callStatus}`} />
          <span>{cameraStarting ? "Conectando" : conversationStatusLabel[callStatus]}</span>
        </div>
        <span
          className={`llm-status llm-status--${llmStatus.status}`}
          title={llmStatus.message}
          aria-live="polite"
        >
          LLM {llmStatus.status === "available"
            ? "disponível"
            : llmStatus.status === "checking"
              ? "verificando"
              : "indisponível"} · {llmStatus.model}
        </span>
      </header>

      <section className="call-stage" aria-label="Chamada com Peter">
        <AvatarStage
          controller={avatar}
          modelUrl={modelUrl}
          emotion="neutral"
        />
        {librasTestMode ? (
          <aside className="libras-test-panel libras-poc-panel" aria-label="Teste de animação oficial SIM">
            <header>
              <h2>SINAL SIM · RETARGET BLOQUEADO</h2>
              <p>O bundle não inclui o rig nem a pose de repouso da origem. Sem esses dados, a orientação no VRM do Peter fica incorreta.</p>
            </header>
            <button
              type="button"
              onClick={onPlayVLibrasSim}
              disabled
              title="Aguardando o rig original com hierarquia, bind pose e eixos locais"
            >
              SIM indisponível · falta rig de origem
            </button>
          </aside>
        ) : null}
        <div
          className={`self-preview${debugVision ? " self-preview--test" : ""}`}
          hidden={!cameraEnabled}
        >
          <video ref={videoRef} muted playsInline autoPlay aria-label="Prévia da sua câmera" />
          {debugVision ? (
            <SignRecognitionHud snapshot={recognition} cameraEnabled={cameraEnabled} />
          ) : null}
          <span>Sua câmera</span>
        </div>
        {debugVision ? (
          <LibrasTestPanel
            snapshot={recognition}
            catalog={MVP_SIGNS}
            templates={recognitionTemplates}
            selectedGloss={selectedGloss}
            onSelectGloss={onSelectGloss}
            onRecord={onRecordTemplate}
            onCancelCalibration={onCancelCalibration}
            onDeleteTemplate={onDeleteTemplate}
          />
        ) : null}
        {cameraError ? <p className="call-notice call-notice--error" role="alert">{cameraError}</p> : null}
        {microphoneError ? (
          <p className="call-notice call-notice--error" role="alert">{microphoneError}</p>
        ) : null}
        {voiceError ? (
          <p className="call-notice call-notice--error" role="alert">{voiceError}</p>
        ) : null}
        {avatarError ? (
          <p className="call-notice call-notice--error" role="alert">{avatarError}</p>
        ) : null}
        {brainError ? (
          <p className="call-notice call-notice--error" role="alert">{brainError}</p>
        ) : null}
        {latestAssistantMessage ? (
          <div className="call-caption" aria-live="polite">
            <small>Peter · {latestAssistantMessage.source === "local-llm"
              ? "modelo local"
              : latestAssistantMessage.source === "rules"
                ? "resposta offline"
                : latestAssistantMessage.source === "api"
                  ? "API"
                  : "teste"}</small>
            <div>{latestAssistantMessage.text}</div>
          </div>
        ) : null}
        {latestUserMessage || interimTranscript ? (
          <div className="call-transcript" aria-live="polite">
            <span>Você</span>
            <p>{interimTranscript || latestUserMessage?.text}</p>
            {interimTranscript ? <small>fala em andamento</small> : null}
          </div>
        ) : null}
      </section>

      <div className="call-activity" aria-live="polite">
        <span className={`audio-indicator audio-indicator--${callStatus}`} aria-hidden="true">
          <i /><i /><i /><i /><i />
        </span>
        <span>{conversationStatusLabel[callStatus]}</span>
      </div>

      <form className="message-composer" onSubmit={submitMessage}>
        <label className="visually-hidden" htmlFor="message-input">Escrever mensagem para Peter</label>
        <input
          id="message-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escrever..."
          autoComplete="off"
        />
        <button
          className="send-button"
          type="submit"
          aria-label="Enviar mensagem"
          disabled={!draft.trim()}
        >
          <Icon name="send" />
        </button>
      </form>

      <nav className="call-controls" aria-label="Controles da chamada">
        <CallControl
          icon={microphoneEnabled ? "mic" : "micOff"}
          label={microphoneEnabled ? "Parar de ouvir" : "Microfone"}
          active={microphoneEnabled}
          disabled={!microphoneSupported}
          title={microphoneSupported ? undefined : "A transcrição de voz não é compatível com este navegador"}
          onClick={onMicrophoneToggle}
        />
        <CallControl
          icon={cameraEnabled ? "cameraOff" : "camera"}
          label={cameraStarting ? "Conectando" : "Câmera"}
          active={cameraEnabled}
          disabled={cameraStarting}
          onClick={onCameraToggle}
        />
        <CallControl
          icon="chat"
          label="Conversa"
          active={isChatOpen}
          onClick={() => setIsChatOpen((open) => !open)}
        />
      </nav>

      <p className="call-disclaimer">
        Voz transcrita localmente · LLM local quando Ollama estiver disponível
      </p>

      {isChatOpen ? (
        <div className="call-overlay" onClick={() => setIsChatOpen(false)}>
          <section
            className="call-sheet conversation-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" />
            <div className="sheet-heading">
              <div>
                <h2 id="conversation-title">Conversa</h2>
              <p>Mensagens desta sessão</p>
              </div>
              <button className="sheet-close" onClick={() => setIsChatOpen(false)} aria-label="Fechar conversa">
                <Icon name="close" />
              </button>
            </div>
            <div className="conversation-messages" ref={conversationRef}>
              {messages.length === 0 ? (
                <p className="conversation-empty">A conversa começa quando você escreve ou quando Peter reconhece um sinal.</p>
              ) : messages.slice(-20).map((message) => (
                <article className={`conversation-message conversation-message--${message.role}`} key={message.id}>
                  <span>
                    {message.role === "assistant" ? "Peter" : "Você"}
                    {message.role === "assistant" && message.source
                      ? ` · ${message.source === "local-llm" ? "modelo local" : message.source === "api" ? "API" : message.source === "rules" ? "regras locais" : "teste"}`
                      : ""}
                  </span>
                  <p>{message.text}</p>
                  <time>{new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

    </main>
  );
}

function CallControl({
  icon,
  label,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`call-control${active ? " call-control--active" : ""}`}
      type="button"
      aria-pressed={active}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="call-control__icon"><Icon name={icon} /></span>
      <span className="call-control__label">{label}</span>
    </button>
  );
}

type IconName = "mic" | "micOff" | "camera" | "cameraOff" | "chat" | "send" | "close";

function Icon({ name }: { name: IconName }) {
  const shared = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  const paths: Record<IconName, ReactNode> = {
    mic: <><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></>,
    micOff: <><path d="M9 9v2.5a3 3 0 0 0 5.3 1.9M15 9V5.5a3 3 0 0 0-5.8-1M5.5 11.5a6.5 6.5 0 0 0 11.1 4.6M12 18v3m-4 0h8M3 3l18 18" /></>,
    camera: <><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10 5-3v10l-5-3z" /></>,
    cameraOff: <><path d="m3 3 18 18M10 6h3.5A2.5 2.5 0 0 1 16 8.5v7M8 18h-.5A2.5 2.5 0 0 1 5 15.5v-7A2.5 2.5 0 0 1 6 6.6M16 10l5-3v10l-3.3-2" /></>,
    chat: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.2a7.5 7.5 0 1 1 17-4.3z" /><path d="M8 11h8m-8 4h5" /></>,
    send: <><path d="m21 3-7.2 18-3.9-7.9L2 9.2 21 3z" /><path d="M10 13l5-5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...shared}>
      {paths[name]}
    </svg>
  );
}

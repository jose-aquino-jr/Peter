import { useEffect, useRef, useState } from "react";
import { CallScreen } from "./call/CallScreen";
import { VrmAvatarController } from "./avatar/vrm-avatar-controller";
import { InMemoryEventBus } from "./core/event-bus";
import { logger } from "./core/logger";
import type { ConversationMessage, ConversationState } from "./core/messages";
import { EventDrivenBrainEngine } from "./brain/event-driven-brain-engine";
import { LocalLLMProvider } from "./brain/local-llm-engine";
import { FallbackRuleProvider } from "./brain/fallback-rule-provider";
import { CameraSource } from "./vision/camera-source";
import { ResponseController } from "./response/response-controller";
import { CompositeTemplateRepository } from "./vision/pipeline/composite-template-repository";
import type { SignRecognitionDebugSnapshot } from "./vision/pipeline/debug";
import { LocalTemplateRepository } from "./vision/pipeline/local-template-repository";
import { OfflineAnimationTemplateRepository } from "./vision/pipeline/offline-animation-template-repository";
import type { SignTemplate } from "./vision/pipeline/sign-template-repository";
import { RealtimeVisionEngine } from "./vision/realtime-vision-engine";
import { BrowserSpeechEngine } from "./voice/browser-speech-engine";
import { LocalSpeechTranscriptionProvider } from "./voice/local-speech-transcription-provider";
import { SpeechInputService } from "./voice/speech-input-service";

const DEFAULT_VRM_URL = new URL("../avatar.vrm", import.meta.url).href;

function createRuntime(debugVision: boolean) {
  const events = new InMemoryEventBus();
  const voice = new BrowserSpeechEngine(events);
  const speechInput = new SpeechInputService(events, new LocalSpeechTranscriptionProvider());
  const avatar = new VrmAvatarController(events);
  const model = new LocalLLMProvider();
  const fallback = new FallbackRuleProvider();
  const animationTemplates = new OfflineAnimationTemplateRepository();
  const templateRepository = debugVision
    ? new CompositeTemplateRepository(new LocalTemplateRepository(), [animationTemplates])
    : animationTemplates;
  return {
    events,
    vision: new RealtimeVisionEngine(events, templateRepository),
    brain: new EventDrivenBrainEngine(events, model, fallback),
    responseController: new ResponseController(events, voice, avatar),
    voice,
    speechInput,
    avatar,
    model,
    camera: new CameraSource(events),
  };
}

export function App() {
  const debugVision = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("debug") === "vision";
  const librasTestMode = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("librasTest") === "1";
  const [runtime] = useState(() => createRuntime(debugVision));
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [callStatus, setCallStatus] = useState<ConversationState>("idle");
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string>();
  const [avatarError, setAvatarError] = useState<string>();
  const [brainError, setBrainError] = useState<string>();
  const [llmStatus, setLlmStatus] = useState<{
    status: "checking" | "available" | "unavailable" | "model-missing";
    model: string;
    message: string;
  }>({
    status: "checking",
    model: runtime.model.modelName,
    message: "Verificando Ollama...",
  });
  const [recognition, setRecognition] = useState<SignRecognitionDebugSnapshot>();
  const [recognitionTemplates, setRecognitionTemplates] = useState<readonly SignTemplate[]>([]);
  const [selectedGloss, setSelectedGloss] = useState("OBRIGADO");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const unsubscribe = [
      runtime.events.on("vision.sign-recognized", ({ recognition }) => {
        setCallStatus("processing");
        setMessages((previous) => [
          ...previous.slice(-19),
          {
            id: `user-${recognition.timestamp}`,
            role: "user",
            text: recognition.gloss,
            timestamp: recognition.timestamp,
          },
        ]);
      }),
      runtime.events.on("voice.transcription", ({ text, timestamp }) => {
        setInterimTranscript("");
        setMessages((previous) => [
          ...previous.slice(-19),
          { id: `user-${timestamp}`, role: "user", text, timestamp },
        ]);
      }),
      runtime.events.on("response.ready", ({ response }) => {
        setMessages((previous) => [
          ...previous.slice(-19),
          {
            id: `assistant-${response.inReplyTo.timestamp}`,
            role: "assistant",
            text: response.text,
            source: response.source,
            timestamp: Date.now(),
          },
        ]);
      }),
      runtime.events.on("vision.camera-status", ({ status, message }) => {
        setCameraEnabled(status === "ready");
        setCameraError(status === "denied"
          ? "Acesso à câmera negado. Permita o uso nas configurações de site do navegador e recarregue a página."
          : status === "error"
            ? message
            : undefined);
        setCameraStarting(status === "requesting");
        if (status === "ready" && videoRef.current) {
          runtime.vision.attachVideo(videoRef.current);
        } else {
          runtime.vision.detachVideo();
        }
      }),
      runtime.events.on("voice.microphone-status", ({ enabled, message }) => {
        setMicrophoneEnabled(enabled);
        if (enabled) setMicrophoneError(undefined);
        else if (message) setMicrophoneError(message);
      }),
      runtime.events.on("voice.transcription-interim", ({ text }) => setInterimTranscript(text)),
      runtime.events.on("voice.transcription-status", ({ status, message }) => {
        if (status === "listening" || status === "transcribing") setCallStatus(status);
        else if (status === "error") {
          setCallStatus("error");
          setMicrophoneError(message);
        } else {
          setCallStatus((current) => current === "listening" || current === "transcribing" ? "idle" : current);
          setMicrophoneError(undefined);
        }
      }),
      runtime.events.on("conversation.state", ({ state }) => setCallStatus(state)),
      runtime.events.on("avatar.status", ({ status, message }) => {
        setAvatarError(status === "error" ? message : undefined);
      }),
      runtime.events.on("voice.status", ({ status, message }) => {
        setVoiceError(status === "error" ? message : undefined);
        if (status === "speaking") {
          setCallStatus("responding");
        } else if (status === "idle" || status === "error") {
          setCallStatus((current) => current === "responding" ? "idle" : current);
        }
      }),
      runtime.events.on("brain.llm-status", (status) => {
        setLlmStatus(status);
        if (status.status === "available") {
          setBrainError(undefined);
        }
      }),
      runtime.events.on("vision.recognition-debug", ({ snapshot }) => {
        setRecognition(snapshot);
      }),
      runtime.events.on("core.error", ({ source, message }) => {
        logger.error(source, message);
        if (source === "brain") {
          setBrainError(message);
        }
      }),
    ];

    runtime.brain.start();
    runtime.voice.start();
    runtime.avatar.start();
    runtime.responseController.start();
    runtime.vision.start();
    runtime.avatar.lookAt("camera");
    void runtime.vision.listTemplates().then(setRecognitionTemplates).catch((error: unknown) => {
      logger.error("vision", "Could not load local sign templates", error);
    });
    return () => {
      unsubscribe.forEach((removeListener) => removeListener());
      runtime.vision.stop();
      runtime.avatar.stop();
      runtime.responseController.stop();
      runtime.brain.stop();
      runtime.voice.stop();
      runtime.speechInput.stop();
      runtime.camera.stop(videoRef.current ?? undefined);
    };
  }, [runtime]);

  useEffect(() => {
    if (recognition?.templateCount === undefined) {
      return;
    }
    void runtime.vision.listTemplates().then(setRecognitionTemplates).catch((error: unknown) => {
      logger.error("vision", "Could not refresh local sign templates", error);
    });
  }, [runtime, recognition?.templateCount]);

  async function startCamera() {
    const video = videoRef.current;
    if (!video) {
      setCameraStarting(false);
      return;
    }
    setCameraStarting(true);
    setCameraError(undefined);
    try {
      await runtime.camera.start(video);
    } catch (error) {
      setCameraStarting(false);
      logger.error("vision", "Camera could not be started", error);
    }
  }

  function toggleCamera() {
    if (cameraEnabled) {
      runtime.camera.stop(videoRef.current ?? undefined);
      return;
    }
    void startCamera();
  }

  function sendMessage(text: string) {
    const message = text.trim();
    if (!message) {
      return;
    }
    runtime.events.emit({
      type: "voice.transcription",
      text: message,
      timestamp: Date.now(),
    });
  }

  function toggleMicrophone() {
    if (runtime.speechInput.listening) runtime.speechInput.stop();
    else void runtime.speechInput.start();
  }

  return (
    <CallScreen
      avatar={runtime.avatar}
      cameraError={cameraError}
      cameraEnabled={cameraEnabled}
      microphoneEnabled={microphoneEnabled}
      microphoneSupported={runtime.speechInput.supported}
      microphoneError={microphoneError}
      voiceError={voiceError}
      avatarError={avatarError}
      brainError={brainError}
      llmStatus={llmStatus}
      cameraStarting={cameraStarting}
      callStatus={callStatus}
      messages={messages}
      interimTranscript={interimTranscript}
      modelUrl={DEFAULT_VRM_URL}
      onCameraToggle={toggleCamera}
      onMessageSend={sendMessage}
      onMicrophoneToggle={toggleMicrophone}
      videoRef={videoRef}
      debugVision={debugVision}
      librasTestMode={librasTestMode}
      onPlayVLibrasSim={() => void runtime.avatar.playVLibrasSim()}
      recognition={recognition}
      recognitionTemplates={recognitionTemplates}
      selectedGloss={selectedGloss}
      onSelectGloss={setSelectedGloss}
      onRecordTemplate={() => runtime.vision.startCalibration(selectedGloss)}
      onCancelCalibration={() => runtime.vision.cancelCalibration()}
      onDeleteTemplate={(id) => {
        void runtime.vision.removeTemplate(id)
          .then(() => runtime.vision.listTemplates())
          .then(setRecognitionTemplates)
          .catch((error: unknown) => {
            logger.error("vision", "Could not delete local sign template", error);
          });
      }}
    />
  );
}

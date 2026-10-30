export const peterConfig = {
  brain: {
    ollamaUrl: import.meta.env.VITE_OLLAMA_URL
      ?? (import.meta.env.DEV ? "/ollama/api/chat" : "http://127.0.0.1:11434/api/chat"),
    ollamaModel: import.meta.env.VITE_OLLAMA_MODEL ?? "qwen2.5:0.5b",
    ollamaTimeoutMs: 45_000,
  },
  mockVisionIntervalMs: 12_000,
  camera: {
    video: {
      facingMode: "user",
      width: { ideal: 960 },
      height: { ideal: 540 },
    },
  },
  vision: {
    processFps: 15,
    bufferDurationMs: 1400,
    minBufferFrames: 8,
    matchEveryMs: 140,
    debugEveryMs: 120,
    dtwWindowRatio: 0.28,
    minConfidence: 0.68,
    minScoreMargin: 0.08,
    topK: 3,
    consecutiveHits: 3,
    cooldownMs: 1700,
    releaseConfidence: 0.5,
    minMotion: 0.018,
    maxMatchFrames: 16,
    calibrationDurationMs: 1500,
    countdownMs: 2500,
    mediapipeWasmBase:
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm",
    handModel:
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    poseModel:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
} as const;

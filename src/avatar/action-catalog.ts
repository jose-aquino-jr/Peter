import type { Emotion, Gesture } from "../core/messages";

export const gestureCatalog: Readonly<Record<Gesture, { label: string; mock: string }>> = {
  wave: { label: "Acenar", mock: "Aceno demonstrativo" },
  nod: { label: "Concordar", mock: "Inclinação demonstrativa de cabeça" },
  shake_head: { label: "Negar", mock: "Movimento demonstrativo de cabeça" },
  thinking: { label: "Pensar", mock: "Pose demonstrativa de reflexão" },
  point: { label: "Apontar", mock: "Gesto demonstrativo de apontar" },
  listen: { label: "Ouvir", mock: "Pose demonstrativa de escuta" },
};

export const emotionCatalog: Readonly<Record<Emotion, string>> = {
  happy: "Feliz",
  sad: "Triste",
  neutral: "Neutro",
  thinking: "Pensativo",
};

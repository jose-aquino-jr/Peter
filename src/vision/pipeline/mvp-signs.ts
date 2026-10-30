import type { LandmarkChannel } from "./contracts";

export interface MvpSign {
  readonly id: string;
  readonly name: string;
  readonly gloss: string;
  readonly relevantLandmarks: readonly LandmarkChannel[];
}

const HANDS_POSE = ["leftHand", "rightHand", "pose"] as const;
const HANDS_POSE_FACE = ["leftHand", "rightHand", "pose", "face"] as const;

function sign(
  id: string,
  gloss: string,
  relevantLandmarks: readonly LandmarkChannel[] = HANDS_POSE,
): MvpSign {
  return { id, name: gloss, gloss, relevantLandmarks };
}

export const MVP_SIGNS: readonly MvpSign[] = [
  sign("oi", "OI"),
  sign("tchau", "TCHAU"),
  sign("obrigado", "OBRIGADO"),
  sign("por-favor", "POR FAVOR"),
  sign("desculpa", "DESCULPA"),
  sign("sim", "SIM", HANDS_POSE_FACE),
  sign("nao", "NÃO", HANDS_POSE_FACE),
  sign("bom", "BOM"),
  sign("mal", "MAL"),
  sign("ajuda", "AJUDA"),
  sign("amigo", "AMIGO"),
  sign("pessoa", "PESSOA"),
  sign("homem", "HOMEM"),
  sign("mulher", "MULHER"),
  sign("crianca", "CRIANÇA"),
  sign("meu", "MEU"),
  sign("seu", "SEU"),
  sign("nome", "NOME"),
  sign("voce", "VOCÊ"),
  sign("eu", "EU"),
  sign("quem", "QUEM"),
  sign("o-que", "O QUE"),
  sign("como", "COMO"),
  sign("onde", "ONDE"),
  sign("quando", "QUANDO"),
  sign("por-que", "POR QUÊ"),
  sign("comer", "COMER"),
  sign("beber", "BEBER"),
  sign("querer", "QUERER"),
  sign("gostar", "GOSTAR"),
  sign("ir", "IR"),
  sign("vir", "VIR"),
  sign("ter", "TER"),
  sign("poder", "PODER"),
  sign("saber", "SABER"),
  sign("entender", "ENTENDER"),
  sign("aprender", "APRENDER"),
  sign("trabalhar", "TRABALHAR"),
  sign("estudar", "ESTUDAR"),
  sign("ler", "LER"),
  sign("escrever", "ESCREVER"),
  sign("agua", "ÁGUA"),
  sign("casa", "CASA"),
  sign("escola", "ESCOLA"),
  sign("trabalho", "TRABALHO"),
  sign("hoje", "HOJE"),
  sign("agora", "AGORA"),
  sign("amanha", "AMANHÃ"),
  sign("amor", "AMOR"),
  sign("telefone", "TELEFONE"),
];

export const RECOMMENDED_CALIBRATION_GLOSSES = [
  "OI",
  "TCHAU",
  "OBRIGADO",
  "SIM",
  "NÃO",
] as const;

export function findMvpSign(gloss: string): MvpSign | undefined {
  return MVP_SIGNS.find((item) => item.gloss === gloss);
}

export function isRecommendedCalibration(gloss: string): boolean {
  return (RECOMMENDED_CALIBRATION_GLOSSES as readonly string[]).includes(gloss);
}

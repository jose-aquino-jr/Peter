import { logger } from "../core/logger";
import type { SignTemplate } from "../vision/pipeline/sign-template-repository";

export type LibrasResolutionStatus = "validated" | "template_available" | "unsupported";

export interface LibrasSignal {
  readonly gloss: string;
  readonly status: LibrasResolutionStatus;
  readonly templates: readonly SignTemplate[];
}

export interface LibrasTranslation {
  readonly text: string;
  readonly signals: readonly LibrasSignal[];
}

export class TextToLibras {
  constructor(private readonly templates: readonly SignTemplate[]) {}

  translate(text: string): LibrasTranslation {
    const words = normalize(text).split(" ").filter(Boolean);
    const signals: LibrasSignal[] = [];
    let index = 0;
    logger.info("TextToLibras", `Texto: "${text}"`);

    while (index < words.length) {
      if (words[index] === "bom" && words[index + 1] === "dia") {
        const full = this.resolve("BOM DIA");
        if (full.status !== "unsupported") {
          signals.push(full);
          logger.info("TextToLibras", 'Expressão encontrada: "BOM DIA"');
          index += 2;
          continue;
        }
        const bom = this.resolve("BOM");
        const dia = this.resolve("DIA");
        if (bom.status !== "unsupported" && dia.status !== "unsupported") {
          signals.push(bom, dia);
          index += 2;
          continue;
        }
        signals.push({ gloss: "BOM DIA", status: "unsupported", templates: [] });
        logger.info("TextToLibras", "BOM DIA → UNSUPPORTED");
        index += 2;
        continue;
      }

      const gloss = words[index].toLocaleUpperCase("pt-BR");
      const resolved = this.resolve(gloss);
      signals.push(resolved);
      if (resolved.status === "unsupported") {
        logger.info("TextToLibras", `${gloss} → UNSUPPORTED`);
      }
      index += 1;
    }
    return { text, signals };
  }

  private resolve(gloss: string): LibrasSignal {
    const templates = this.templates.filter((template) => normalize(template.gloss) === normalize(gloss));
    if (templates.length === 0) {
      return { gloss, status: "unsupported", templates: [] };
    }
    const validated = templates.filter((template) => template.validated !== false);
    const status = validated.length > 0 ? "validated" : "template_available";
    logger.info("TemplateResolver", `Template: ${validated[0]?.id ?? templates[0].id}; Status: ${status.toUpperCase()}`);
    return { gloss, status, templates: validated.length > 0 ? validated : templates };
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

import { describe, expect, it } from "vitest";
import { OfflineAnimationTemplateRepository } from "../vision/pipeline/offline-animation-template-repository";
import { TextToLibras } from "./text-to-libras";

describe("legacy training templates are not treated as verified Libras output", () => {
  it("does not mark the RGB training sample SIM as a validated sign", async () => {
    const catalog = await new OfflineAnimationTemplateRepository().list();
    const sim = new TextToLibras(catalog).translate("SIM").signals[0];
    expect(sim.status).toBe("template_available");
    expect(sim.templates[0]?.metadata.sourceDataset).toBe("LIBRAS-EQT-UECE");
    expect(sim.templates[0]?.validated).toBe(false);
  });

  it.each(["OI", "TCHAU", "OBRIGADO", "BOM", "BOM DIA"])(
    "does not fabricate %s when no template is available",
    async (phrase) => {
      const catalog = await new OfflineAnimationTemplateRepository().list();
      const result = new TextToLibras(catalog).translate(phrase).signals;
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ gloss: phrase, status: "unsupported", templates: [] });
    },
  );
});

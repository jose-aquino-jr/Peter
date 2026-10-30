import { describe, expect, it } from "vitest";
import { FallbackRuleProvider } from "./fallback-rule-provider";

describe("FallbackRuleProvider", () => {
  it.each([
    ["Oi", "Olá! Eu sou o Peter. Como posso ajudar?", "greeting"],
    ["Tudo bem?", "Estou bem e pronto para conversar com você. E você?", "conversation"],
    ["Obrigado", "De nada! Estou aqui para ajudar.", "acknowledge"],
    ["Quem é você?", "Eu sou o Peter, um assistente acessível feito para conversar com você.", "conversation"],
  ] as const)("answers %s using a named local rule", async (text, expected, intent) => {
    const provider = new FallbackRuleProvider();
    await expect(provider.generateResponse(
      { type: "transcription", text, timestamp: 1 },
      [],
    )).resolves.toMatchObject({ text: expected, source: "rules", intent });
  });

  it("returns an honest generic fallback for unmatched text", async () => {
    const provider = new FallbackRuleProvider();
    await expect(provider.generateResponse(
      { type: "transcription", text: "Me fale sobre astronomia", timestamp: 1 },
      [],
    )).resolves.toMatchObject({ source: "rules", text: expect.stringContaining("Ainda estou aprendendo") });
  });
});

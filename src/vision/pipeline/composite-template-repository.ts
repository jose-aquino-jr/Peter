import type { SignTemplate, SignTemplateRepository } from "./sign-template-repository";

/**
 * Agrega origens independentes de templates. O matching não conhece VLibras,
 * câmera local ou importações futuras — só consome `list()`.
 * Gravações novas vão para o repositório gravável (em geral o local).
 */
export class CompositeTemplateRepository implements SignTemplateRepository {
  constructor(
    private readonly writable: SignTemplateRepository,
    private readonly extras: readonly SignTemplateRepository[] = [],
  ) {}

  async list(): Promise<readonly SignTemplate[]> {
    const groups = await Promise.all([
      this.writable.list(),
      ...this.extras.map((source) => source.list()),
    ]);
    const byId = new Map<string, SignTemplate>();
    for (const template of groups.flat()) {
      byId.set(template.id, template);
    }
    return [...byId.values()];
  }

  async findByGloss(gloss: string): Promise<readonly SignTemplate[]> {
    return (await this.list()).filter((template) => template.gloss === gloss);
  }

  save(template: SignTemplate): Promise<void> {
    return this.writable.save(template);
  }

  remove(id: string): Promise<void> {
    return this.writable.remove(id);
  }
}

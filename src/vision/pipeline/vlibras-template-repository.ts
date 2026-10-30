import type { SignTemplate, SignTemplateRepository } from "./sign-template-repository";

/**
 * The VLibras dictionary publishes Unity WebGL bundles, not MediaPipe
 * landmark sequences. This adapter deliberately exposes no templates until a
 * verified bundle-to-landmark conversion is available.
 */
export class VLibrasTemplateRepository implements SignTemplateRepository {
  async list(): Promise<readonly SignTemplate[]> {
    return [];
  }

  async findByGloss(_gloss: string): Promise<readonly SignTemplate[]> {
    return [];
  }

  async save(_template: SignTemplate): Promise<void> {
    throw new Error("Converta primeiro a animação para Canonical Skeleton com a ferramenta offline do Peter.");
  }

  async remove(_id: string): Promise<void> {
    throw new Error("Templates de origem VLibras são somente leitura no runtime.");
  }
}

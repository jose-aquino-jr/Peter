import type { SignTemplate, SignTemplateRepository } from "./sign-template-repository";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const STORAGE_KEY = "peter.sign-templates.v2";

function defaultStorage(): KeyValueStore {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // private mode / missing DOM storage
  }
  return new MemoryKeyValueStore();
}

export class LocalTemplateRepository implements SignTemplateRepository {
  constructor(
    private readonly storage: KeyValueStore = defaultStorage(),
    private readonly storageKey = STORAGE_KEY,
  ) {}

  async list(): Promise<readonly SignTemplate[]> {
    return this.readAll();
  }

  async findByGloss(gloss: string): Promise<readonly SignTemplate[]> {
    return this.readAll().filter((template) => template.gloss === gloss);
  }

  async save(template: SignTemplate): Promise<void> {
    const templates = this.readAll().filter((item) => item.id !== template.id);
    templates.push(template);
    this.writeAll(templates);
  }

  async remove(id: string): Promise<void> {
    this.writeAll(this.readAll().filter((template) => template.id !== id));
  }

  private readAll(): SignTemplate[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as SignTemplate[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(templates: readonly SignTemplate[]): void {
    this.storage.setItem(this.storageKey, JSON.stringify(templates));
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

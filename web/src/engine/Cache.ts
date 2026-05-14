import type { SemanticType, JsonValue } from "./types";

export class ConsistencyCache {
  private store = new Map<string, JsonValue>();

  private key(type: SemanticType, value: JsonValue): string {
    return `${type}:${JSON.stringify(value)}`;
  }

  get(type: SemanticType, value: JsonValue): JsonValue | undefined {
    return this.store.get(this.key(type, value));
  }

  set(type: SemanticType, value: JsonValue, fake: JsonValue): void {
    this.store.set(this.key(type, value), fake);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

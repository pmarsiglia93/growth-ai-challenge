import type { EnrichResult } from "@/lib/types";

/**
 * Cache em memória, no escopo do módulo. Sobrevive entre requests no mesmo
 * processo do servidor (mas não entre reinícios/cold starts). Chaveado por
 * productId. Mantido propositalmente simples — sem TTL — para o desafio.
 */
const store = new Map<string, EnrichResult>();

export function getCached(productId: string): EnrichResult | undefined {
  return store.get(productId);
}

export function setCached(productId: string, result: EnrichResult): void {
  store.set(productId, result);
}

export function invalidateCache(productId: string): void {
  store.delete(productId);
}

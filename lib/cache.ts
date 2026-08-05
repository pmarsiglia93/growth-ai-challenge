import type { EnrichResult, Locale } from "@/lib/types";

/**
 * Cache em memória, no escopo do módulo. Sobrevive entre requests no mesmo
 * processo do servidor (mas não entre reinícios/cold starts). Chaveado por
 * `productId + locale` — sem o locale na chave, trocar de idioma devolveria o
 * conteúdo cacheado no idioma errado. Mantido propositalmente simples (sem TTL).
 */
const store = new Map<string, EnrichResult>();

function cloneResult(result: EnrichResult): EnrichResult {
  return {
    bullets: [...result.bullets],
    faqs: result.faqs.map((faq) => ({ ...faq })),
  };
}

function cacheKey(productId: string, locale: Locale): string {
  return `${productId}:${locale}`;
}

export function getCached(
  productId: string,
  locale: Locale,
): EnrichResult | undefined {
  const cached = store.get(cacheKey(productId, locale));
  return cached ? cloneResult(cached) : undefined;
}

export function setCached(
  productId: string,
  locale: Locale,
  result: EnrichResult,
): void {
  store.set(cacheKey(productId, locale), cloneResult(result));
}

export function invalidateCache(productId: string, locale: Locale): void {
  store.delete(cacheKey(productId, locale));
}

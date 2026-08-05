/**
 * Tipos compartilhados entre front-end e back-end.
 * Nenhum `any` deve cruzar a fronteira da API.
 */

/** Produto do catálogo (espelha data/products.json). */
export interface Product {
  id: string;
  title: string;
  category: string;
  description: string;
}

/** Idiomas suportados pelo enriquecimento. */
export type Locale = "pt-BR" | "en";

/** Corpo aceito por POST /api/enrich-product. */
export interface EnrichRequest {
  productId: string;
  productTitle: string;
  productDescription: string;
  category: string;
  regenerate?: boolean;
  /** Idioma do conteúdo gerado. Default: pt-BR. */
  locale?: Locale;
}

/** Uma pergunta frequente com a respectiva resposta. */
export interface Faq {
  question: string;
  answer: string;
}

/** Conteúdo de enriquecimento gerado pelo LLM (resposta 200 da API). */
export interface EnrichResult {
  bullets: string[];
  faqs: Faq[];
}

/** Corpo de qualquer resposta de erro da API (4xx/5xx). */
export interface ApiError {
  error: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Type guard de `Faq`. */
export function isFaq(value: unknown): value is Faq {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isNonEmptyString(candidate.question) && isNonEmptyString(candidate.answer);
}

/**
 * Type guard do contrato completo de `EnrichResult`. A mesma regra é aplicada
 * nas duas fronteiras: resposta final da API e evento `done` do stream.
 */
export function isEnrichResult(value: unknown): value is EnrichResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.bullets) &&
    candidate.bullets.length >= 2 &&
    candidate.bullets.length <= 3 &&
    candidate.bullets.every(isNonEmptyString) &&
    Array.isArray(candidate.faqs) &&
    candidate.faqs.length === 3 &&
    candidate.faqs.every(isFaq)
  );
}

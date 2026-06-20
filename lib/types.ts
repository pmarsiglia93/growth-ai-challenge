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

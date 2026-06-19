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

/** Corpo aceito por POST /api/enrich-product. */
export interface EnrichRequest {
  productId: string;
  productTitle: string;
  productDescription: string;
  category: string;
  regenerate?: boolean;
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

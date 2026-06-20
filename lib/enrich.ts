import Anthropic from "@anthropic-ai/sdk";
import type { EnrichResult, Faq, Locale } from "@/lib/types";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

/** Erro tipado de enriquecimento — vira 500 na API. */
export class EnrichError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichError";
  }
}

interface BuildPromptArgs {
  title: string;
  category: string;
  description: string;
  locale: Locale;
}

function buildPrompt({
  title,
  category,
  description,
  locale,
}: BuildPromptArgs): string {
  const languageDirective =
    locale === "en"
      ? "TODO o conteúdo gerado (bullets, perguntas e respostas) deve ser escrito em INGLÊS (en-US)."
      : "TODO o conteúdo gerado (bullets, perguntas e respostas) deve ser escrito em PORTUGUÊS DO BRASIL (pt-BR).";

  return [
    "Você é um especialista em copywriting de e-commerce.",
    "Gere conteúdo de enriquecimento para o produto abaixo.",
    languageDirective,
    "NÃO invente especificações que não estejam na descrição.",
    "Responda EXCLUSIVAMENTE com um JSON válido, sem nenhum texto antes ou depois",
    "e sem cercas de código, no formato exato:",
    '{"bullets": string[], "faqs": [{"question": string, "answer": string}]}.',
    "Regras: 'bullets' deve ter 2 a 3 itens curtos destacando benefícios reais",
    "derivados da descrição; 'faqs' deve ter exatamente 3 perguntas comuns de quem",
    "vai comprar, com respostas úteis e honestas baseadas na descrição.",
    `Produto — Título: ${title} | Categoria: ${category} | Descrição: ${description}`,
  ].join(" ");
}

/**
 * Remove cercas ```json ... ``` e extrai o primeiro objeto JSON `{...}` do texto.
 * O modelo é instruído a não usar cercas, mas tratamos defensivamente mesmo assim.
 */
function extractJsonObject(raw: string): string {
  let text = raw.trim();

  // Remove cercas de código (```json ... ``` ou ``` ... ```).
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    text = fenced[1].trim();
  }

  // Recorta do primeiro "{" até o último "}" para descartar texto residual.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new EnrichError("Resposta do LLM não contém um objeto JSON.");
  }
  return text.slice(start, end + 1);
}

/** Type guard para `Faq`. */
function isFaq(value: unknown): value is Faq {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.question === "string" &&
    typeof candidate.answer === "string"
  );
}

/**
 * Valida que o objeto parseado tem a forma de `EnrichResult`:
 * bullets = array de 2-3 strings; faqs = array de exatamente 3 {question, answer}.
 * Lança `EnrichError` se inválido.
 */
function validateResult(parsed: unknown): EnrichResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new EnrichError("JSON do LLM não é um objeto.");
  }
  const obj = parsed as Record<string, unknown>;

  const { bullets, faqs } = obj;

  if (
    !Array.isArray(bullets) ||
    bullets.length < 2 ||
    bullets.length > 3 ||
    !bullets.every((b): b is string => typeof b === "string")
  ) {
    throw new EnrichError("'bullets' deve ser um array de 2 a 3 strings.");
  }

  if (!Array.isArray(faqs) || faqs.length !== 3 || !faqs.every(isFaq)) {
    throw new EnrichError(
      "'faqs' deve ser um array de exatamente 3 itens {question, answer}.",
    );
  }

  return { bullets, faqs };
}

/** Extrai o texto concatenado dos blocos de texto da resposta da Anthropic. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Faz o parse defensivo do texto cru do LLM e devolve um `EnrichResult` validado.
 * Reutilizado tanto pelo modo JSON quanto pelo modo streaming.
 * Lança `EnrichError` em qualquer falha de parse/validação.
 */
export function parseEnrichmentResponse(rawText: string): EnrichResult {
  const jsonText = extractJsonObject(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new EnrichError("Não foi possível parsear o JSON retornado pelo LLM.");
  }

  return validateResult(parsed);
}

interface EnrichArgs {
  title: string;
  category: string;
  description: string;
  /** Quando true, usa temperatura mais alta para variar o conteúdo. */
  regenerate?: boolean;
  /** Idioma do conteúdo gerado. Default: pt-BR. */
  locale?: Locale;
}

/** Cria o client Anthropic, validando a presença da chave. */
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new EnrichError("ANTHROPIC_API_KEY não está configurada no servidor.");
  }
  return new Anthropic({ apiKey });
}

/** Parâmetros compartilhados da chamada ao LLM (JSON e streaming). */
function buildRequestParams({
  title,
  category,
  description,
  regenerate = false,
  locale = "pt-BR",
}: EnrichArgs): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: process.env.LLM_MODEL || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    // Temperatura mais alta no regenerate garante variação real do conteúdo.
    temperature: regenerate ? 0.9 : 0.4,
    messages: [
      {
        role: "user",
        content: buildPrompt({ title, category, description, locale }),
      },
    ],
  };
}

/**
 * Chama o LLM (modo não-streaming) e devolve um `EnrichResult` validado.
 * Lança `EnrichError` em qualquer falha de chamada ou parse.
 */
export async function generateEnrichment(args: EnrichArgs): Promise<EnrichResult> {
  const client = getClient();

  let message: Anthropic.Message;
  try {
    message = await client.messages.create(buildRequestParams(args));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new EnrichError(`Falha ao chamar o LLM: ${detail}`);
  }

  return parseEnrichmentResponse(extractText(message));
}

/**
 * Cria um stream de mensagem do LLM (modo streaming).
 * O chamador itera os deltas de texto e, ao final, usa `finalMessage()` +
 * `parseEnrichmentResponse(extractText(...))` para validar e cachear.
 */
export function createEnrichmentStream(args: EnrichArgs) {
  const client = getClient();
  return client.messages.stream(buildRequestParams(args));
}

export { extractText };

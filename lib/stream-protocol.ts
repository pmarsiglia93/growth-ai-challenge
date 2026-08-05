import {
  isEnrichResult,
  isFaq,
  type EnrichResult,
  type Faq,
} from "@/lib/types";

/**
 * Protocolo de streaming: NDJSON (uma linha = um JSON = um evento).
 *
 * Escolhido em vez de SSE por ser trivial de produzir num `ReadableStream` do
 * Next e de consumir no browser (split por "\n"), sem o overhead de `event:`/
 * `data:` do SSE nem a necessidade de `EventSource` (que não faz POST).
 *
 * Ordem típica: snapshots de `bullet` → snapshots de `faq` → `done`. Eventos
 * com o mesmo índice substituem o snapshot anterior para revelar palavra a palavra.
 * Um `error` pode substituir o `done` se a geração falhar no meio do stream.
 */
export type StreamEvent =
  | { type: "bullet"; index: number; value: string }
  | { type: "faq"; index: number; value: Faq }
  | { type: "done"; result: EnrichResult }
  | { type: "error"; message: string };

/** Content-Type usado pela rota quando responde em modo streaming. */
export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** Serializa um evento como linha NDJSON (já com o "\n" final). */
export function encodeStreamEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Type guard de `StreamEvent` — linhas malformadas são descartadas pelo cliente. */
export function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;

  switch (event.type) {
    case "bullet":
      return (
        Number.isInteger(event.index) &&
        (event.index as number) >= 0 &&
        typeof event.value === "string" &&
        event.value.trim().length > 0
      );
    case "faq":
      return (
        Number.isInteger(event.index) &&
        (event.index as number) >= 0 &&
        isFaq(event.value)
      );
    case "done":
      return isEnrichResult(event.result);
    case "error":
      return typeof event.message === "string" && event.message.trim().length > 0;
    default:
      return false;
  }
}

/**
 * Divide um buffer acumulado em linhas completas, devolvendo o resto (a linha
 * ainda incompleta) para ser concatenado ao próximo chunk. É o que permite
 * lidar com chunks cortados no meio de um evento.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim() !== ""), rest };
}

/** Conteúdo já materializado a partir de um JSON ainda incompleto. */
export interface PartialEnrichment {
  bullets: string[];
  faqs: Faq[];
}

/**
 * Fecha um JSON truncado no último ponto seguro (fim de string-valor, fim de
 * objeto/array, ou antes de uma vírgula) e devolve o texto parseável, ou `null`
 * se ainda não há nada aproveitável.
 *
 * Necessário porque o LLM emite o JSON caractere a caractere: para mostrar
 * conteúdo progressivamente precisamos parsear o que já chegou sem esperar o
 * fechamento final.
 */
function repairPartialJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  const text = raw.slice(start);

  const open: string[] = [];
  let safeEnd = -1;
  let safeClosers = "";
  let inString = false;
  let escaped = false;

  const closers = (): string =>
    open
      .map((char) => (char === "{" ? "}" : "]"))
      .reverse()
      .join("");

  /**
   * Uma string só é ponto seguro se for valor. Dentro de um array sempre é;
   * dentro de um objeto, depende do que vem depois (":" indica que era chave).
   */
  const isValueString = (endIndex: number): boolean => {
    if (open[open.length - 1] === "[") return true;

    for (let j = endIndex; j < text.length; j++) {
      const next = text[j]!;
      if (next === " " || next === "\n" || next === "\r" || next === "\t") continue;
      return next !== ":";
    }
    // Fim do texto dentro de um objeto: ainda pode virar chave — conservador.
    return false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        inString = false;
        if (isValueString(i + 1)) {
          safeEnd = i + 1;
          safeClosers = closers();
        }
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      open.push(char);
    } else if (char === "}" || char === "]") {
      open.pop();
      safeEnd = i + 1;
      safeClosers = closers();
    } else if (char === ",") {
      // Trunca ANTES da vírgula: o item seguinte ainda não existe.
      safeEnd = i;
      safeClosers = closers();
    }
  }

  if (safeEnd === -1) return null;
  return text.slice(0, safeEnd) + safeClosers;
}

/**
 * Extrai de um texto de LLM ainda em construção os bullets e as FAQs que já
 * estão completos. Itens pela metade são simplesmente ignorados até fecharem.
 */
export function extractPartial(rawText: string): PartialEnrichment {
  const empty: PartialEnrichment = { bullets: [], faqs: [] };

  const repaired = repairPartialJson(rawText);
  if (!repaired) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    return empty;
  }

  if (typeof parsed !== "object" || parsed === null) return empty;
  const obj = parsed as Record<string, unknown>;

  const bullets = Array.isArray(obj.bullets)
    ? obj.bullets.filter((item): item is string => typeof item === "string")
    : [];
  const faqs = Array.isArray(obj.faqs) ? obj.faqs.filter(isFaq) : [];

  return { bullets, faqs };
}

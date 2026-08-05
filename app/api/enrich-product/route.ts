import { NextResponse } from "next/server";
import type { ApiError, EnrichRequest, Locale } from "@/lib/types";
import {
  generateEnrichment,
  createEnrichmentStream,
  parseEnrichmentResponse,
  extractText,
} from "@/lib/enrich";
import { getCached, setCached, invalidateCache } from "@/lib/cache";
import {
  NDJSON_CONTENT_TYPE,
  encodeStreamEvent,
  extractPartial,
  type StreamEvent,
} from "@/lib/stream-protocol";

const PUBLIC_ERROR_MESSAGE = "Não foi possível gerar o conteúdo no momento.";

/**
 * Streaming acontece quando o servidor permite (`STREAMING_ENABLED`, ligado por
 * padrão) E o cliente pede NDJSON explicitamente no `Accept`.
 *
 * A negociação por header é o que mantém consumidores não-browser (o fluxo n8n,
 * um `curl` simples) recebendo o JSON completo de uma vez, sem precisar de um
 * parâmetro extra no corpo nem de um ambiente diferente.
 */
function shouldStream(request: Request): boolean {
  if (process.env.STREAMING_ENABLED === "false") return false;
  return (request.headers.get("accept") ?? "").includes(NDJSON_CONTENT_TYPE);
}

/**
 * Converte uma falha de geração em HTTP 500 com mensagem pública genérica.
 * O erro completo (com stack) fica só no log do servidor — a resposta nunca
 * carrega detalhes internos nem valores de ambiente.
 */
function errorResponse(err: unknown): NextResponse<ApiError> {
  console.error("[enrich-product] falha ao gerar enriquecimento:", err);
  return NextResponse.json({ error: PUBLIC_ERROR_MESSAGE }, { status: 500 });
}

function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return mediaType === "application/json";
}

/** Requisição já validada: os campos opcionais viraram valores concretos. */
type ValidatedRequest = Required<EnrichRequest>;

const MAX_FIELD_LENGTH: Record<
  "productId" | "productTitle" | "productDescription" | "category",
  number
> = {
  productId: 128,
  productTitle: 300,
  productDescription: 5_000,
  category: 200,
};

/**
 * Valida o body cru e retorna uma requisição tipada, ou uma mensagem de erro.
 * Sem `any`: tudo passa por narrowing explícito.
 */
function parseBody(
  body: unknown,
): { ok: true; data: ValidatedRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Corpo da requisição deve ser um objeto JSON." };
  }
  const obj = body as Record<string, unknown>;

  const required: ReadonlyArray<keyof typeof MAX_FIELD_LENGTH> = [
    "productId",
    "productTitle",
    "productDescription",
    "category",
  ];

  for (const field of required) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim() === "") {
      return {
        ok: false,
        error: `Campo obrigatório ausente ou inválido: '${field}'.`,
      };
    }
    if (value.length > MAX_FIELD_LENGTH[field]) {
      return {
        ok: false,
        error: `Campo '${field}' excede o tamanho máximo permitido.`,
      };
    }
  }

  if ("regenerate" in obj && typeof obj.regenerate !== "boolean") {
    return { ok: false, error: "Campo 'regenerate' deve ser booleano." };
  }

  if (
    "locale" in obj &&
    obj.locale !== undefined &&
    obj.locale !== "pt-BR" &&
    obj.locale !== "en"
  ) {
    return { ok: false, error: "Campo 'locale' deve ser 'pt-BR' ou 'en'." };
  }

  return {
    ok: true,
    data: {
      productId: (obj.productId as string).trim(),
      productTitle: (obj.productTitle as string).trim(),
      productDescription: (obj.productDescription as string).trim(),
      category: (obj.category as string).trim(),
      regenerate: obj.regenerate === true,
      locale: (obj.locale as Locale | undefined) ?? "pt-BR",
    },
  };
}

/**
 * Caminho de streaming. Responde via `ReadableStream` em NDJSON: cada bullet e
 * cada FAQ vira um evento assim que o modelo termina de escrevê-lo, e o evento
 * final `done` carrega o resultado completo já validado (o mesmo shape do modo
 * JSON), que também é o que vai para o cache.
 *
 * Uma falha depois do primeiro byte não pode mais virar HTTP 500 — nesse caso
 * emitimos um evento `error` e fechamos o stream normalmente.
 */
function streamEnrichment(
  productId: string,
  locale: Locale,
  llmStream: ReturnType<typeof createEnrichmentStream>,
  requestSignal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;

  const abortUpstream = (): void => {
    if (cancelled) return;
    cancelled = true;
    llmStream.abort();
  };

  if (requestSignal.aborted) abortUpstream();
  else requestSignal.addEventListener("abort", abortUpstream, { once: true });

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // `start` retorna imediatamente; assim `reader.cancel()` não fica preso
      // esperando toda a geração terminar para executar o cancelamento.
      void (async () => {
        // O cliente pode desistir no meio (desmontagem, troca de idioma), o que
        // fecha o controller: escrever nele depois disso lança. Como o resultado
        // já não interessa a ninguém, engolir aqui é o comportamento correto.
        let closed = false;
        const send = (event: StreamEvent): void => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(encodeStreamEvent(event)));
          } catch {
            closed = true;
          }
        };

        let accumulated = "";
        let sentBullets = 0;
        let sentFaqs = 0;

        try {
          for await (const event of llmStream) {
            if (cancelled) break;
            if (
              event.type !== "content_block_delta" ||
              event.delta.type !== "text_delta"
            ) {
              continue;
            }

            accumulated += event.delta.text;

            // Reparseia o JSON parcial e emite apenas o que ainda não foi enviado.
            const partial = extractPartial(accumulated);
            for (; sentBullets < partial.bullets.length; sentBullets++) {
              send({
                type: "bullet",
                index: sentBullets,
                value: partial.bullets[sentBullets]!,
              });
            }
            for (; sentFaqs < partial.faqs.length; sentFaqs++) {
              send({
                type: "faq",
                index: sentFaqs,
                value: partial.faqs[sentFaqs]!,
              });
            }
          }

          // Validação + cache acontecem com o texto completo, ao final do stream.
          if (cancelled) return;

          const finalMessage = await llmStream.finalMessage();
          const result = parseEnrichmentResponse(extractText(finalMessage));
          setCached(productId, locale, result);
          send({ type: "done", result });
        } catch (err) {
          if (!cancelled) {
            console.error("[enrich-product] falha no streaming:", err);
            send({ type: "error", message: PUBLIC_ERROR_MESSAGE });
          }
        } finally {
          requestSignal.removeEventListener("abort", abortUpstream);
          if (!closed) {
            try {
              controller.close();
            } catch {
              // Já fechado pelo cliente — nada a fazer.
            }
          }
        }
      })();
    },
    cancel() {
      abortUpstream();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": NDJSON_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return NextResponse.json(
      { error: "Content-Type deve ser 'application/json'." },
      { status: 400 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON inválido no corpo da requisição." },
      { status: 400 },
    );
  }

  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const {
    productId,
    productTitle,
    productDescription,
    category,
    regenerate,
    locale,
  } = parsed.data;

  // Sem regenerate: serve do cache se já existir (rápido). Cache é por idioma.
  if (!regenerate) {
    const cached = getCached(productId, locale);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }
  } else {
    // Com regenerate: invalida ANTES de gerar — sem isso o "Regenerar"
    // devolveria sempre o mesmo conteúdo cacheado.
    invalidateCache(productId, locale);
  }

  const llmArgs = {
    title: productTitle,
    category,
    description: productDescription,
    regenerate,
    locale,
  };

  // Modo streaming. O stream é aberto ANTES de responder para que falhas de
  // pré-voo (ex.: chave ausente) ainda virem um 500 JSON honesto, em vez de um
  // evento de erro dentro de um 200.
  if (shouldStream(request)) {
    try {
      const llmStream = createEnrichmentStream(llmArgs);
      return streamEnrichment(productId, locale, llmStream, request.signal);
    } catch (err) {
      return errorResponse(err);
    }
  }

  try {
    const result = await generateEnrichment(llmArgs);
    setCached(productId, locale, result);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

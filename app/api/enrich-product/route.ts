import { NextResponse } from "next/server";
import type { EnrichRequest } from "@/lib/types";
import {
  generateEnrichment,
  createEnrichmentStream,
  parseEnrichmentResponse,
  extractText,
  EnrichError,
} from "@/lib/enrich";
import { getCached, setCached, invalidateCache } from "@/lib/cache";

/**
 * Valida o body cru e retorna um EnrichRequest tipado, ou uma mensagem de erro.
 * Sem `any`: tudo passa por narrowing explícito.
 */
function parseBody(
  body: unknown,
): { ok: true; data: EnrichRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Corpo da requisição deve ser um objeto JSON." };
  }
  const obj = body as Record<string, unknown>;

  const required: ReadonlyArray<keyof EnrichRequest> = [
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
  }

  if ("regenerate" in obj && typeof obj.regenerate !== "boolean") {
    return { ok: false, error: "Campo 'regenerate' deve ser booleano." };
  }

  return {
    ok: true,
    data: {
      productId: obj.productId as string,
      productTitle: obj.productTitle as string,
      productDescription: obj.productDescription as string,
      category: obj.category as string,
      regenerate: obj.regenerate === true,
    },
  };
}

/**
 * Caminho de streaming (atrás de STREAMING_ENABLED=true). Responde via
 * ReadableStream com os deltas de texto do modelo; ao final valida o JSON
 * acumulado e grava no cache. Não quebra o modo JSON, que segue como default.
 */
function streamEnrichment(
  productId: string,
  args: Parameters<typeof createEnrichmentStream>[0],
): Response {
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const llmStream = createEnrichmentStream(args);

        for await (const event of llmStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        // Validação + cache acontecem com o texto completo, ao final do stream.
        const finalMessage = await llmStream.finalMessage();
        const result = parseEnrichmentResponse(extractText(finalMessage));
        setCached(productId, result);
        controller.close();
      } catch (err) {
        console.error("[enrich-product] falha no streaming:", err);
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido no corpo da requisição." }, { status: 400 });
  }

  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { productId, productTitle, productDescription, category, regenerate } =
    parsed.data;

  // Sem regenerate: serve do cache se já existir (rápido).
  if (!regenerate) {
    const cached = getCached(productId);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }
  } else {
    // Com regenerate: invalida ANTES de gerar — sem isso o "Regenerar"
    // devolveria sempre o mesmo conteúdo cacheado.
    invalidateCache(productId);
  }

  // Modo streaming (opcional, desligado por padrão).
  if (process.env.STREAMING_ENABLED === "true") {
    return streamEnrichment(productId, {
      title: productTitle,
      category,
      description: productDescription,
      regenerate,
    });
  }

  try {
    const result = await generateEnrichment({
      title: productTitle,
      category,
      description: productDescription,
      regenerate,
    });
    setCached(productId, result);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message =
      err instanceof EnrichError ? err.message : "Erro inesperado ao gerar o conteúdo.";
    // Loga o erro completo no servidor; devolve mensagem descritiva ao cliente.
    console.error("[enrich-product] falha ao gerar enriquecimento:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

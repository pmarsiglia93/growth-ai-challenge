"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError, EnrichRequest, EnrichResult } from "@/lib/types";

interface ProductAIWidgetProps {
  productId: string;
  productTitle: string;
  productDescription: string;
  category: string;
}

/** Estado explícito via union type — nada de booleanos soltos. */
type WidgetState =
  | { status: "loading" }
  | { status: "success"; data: EnrichResult }
  | { status: "error"; message: string };

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).error === "string"
  );
}

export default function ProductAIWidget({
  productId,
  productTitle,
  productDescription,
  category,
}: ProductAIWidgetProps) {
  const [state, setState] = useState<WidgetState>({ status: "loading" });

  const fetchEnrichment = useCallback(
    async (regenerate: boolean, signal?: AbortSignal) => {
      setState({ status: "loading" });

      const payload: EnrichRequest = {
        productId,
        productTitle,
        productDescription,
        category,
        regenerate,
      };

      try {
        const response = await fetch("/api/enrich-product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });

        const body: unknown = await response.json();

        if (!response.ok) {
          const message = isApiError(body)
            ? body.error
            : "Não foi possível gerar o conteúdo.";
          setState({ status: "error", message });
          return;
        }

        setState({ status: "success", data: body as EnrichResult });
      } catch (err) {
        // Requisição abortada (ex.: desmontagem/novo clique) — ignora.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          status: "error",
          message: "Erro de conexão ao gerar o conteúdo. Tente novamente.",
        });
      }
    },
    [productId, productTitle, productDescription, category],
  );

  // Dispara no mount (e refaz se o produto mudar). Aborta ao desmontar.
  useEffect(() => {
    const controller = new AbortController();
    void fetchEnrichment(false, controller.signal);
    return () => controller.abort();
  }, [fetchEnrichment]);

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Enriquecimento com IA</h2>

      {state.status === "loading" && <WidgetSkeleton />}

      {state.status === "error" && (
        <div className="mt-4">
          <p className="text-sm text-red-600">{state.message}</p>
          <button
            type="button"
            onClick={() => void fetchEnrichment(false)}
            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-4 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500">Benefícios</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {state.data.bullets.map((bullet, index) => (
                <li key={index}>{bullet}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-500">
              Perguntas frequentes
            </h3>
            <dl className="mt-2 space-y-3">
              {state.data.faqs.map((faq, index) => (
                <div key={index}>
                  <dt className="text-sm font-medium">{faq.question}</dt>
                  <dd className="mt-0.5 text-sm text-gray-700">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </div>

          <button
            type="button"
            onClick={() => void fetchEnrichment(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Regenerar
          </button>
        </div>
      )}
    </section>
  );
}

function WidgetSkeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-3" aria-label="Carregando conteúdo">
      <div className="h-3 w-1/3 rounded bg-gray-200" />
      <div className="h-3 w-full rounded bg-gray-200" />
      <div className="h-3 w-5/6 rounded bg-gray-200" />
      <div className="h-3 w-2/3 rounded bg-gray-200" />
    </div>
  );
}

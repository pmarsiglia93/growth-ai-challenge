"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ApiError,
  EnrichRequest,
  EnrichResult,
  Locale,
} from "@/lib/types";

/** Rótulos da UI por idioma. */
const UI_TEXT: Record<Locale, {
  heading: string;
  benefits: string;
  faq: string;
  regenerate: string;
  retry: string;
  loading: string;
  genericError: string;
  connError: string;
}> = {
  "pt-BR": {
    heading: "Enriquecimento com IA",
    benefits: "Benefícios",
    faq: "Perguntas frequentes",
    regenerate: "Regenerar",
    retry: "Tentar novamente",
    loading: "Carregando conteúdo",
    genericError: "Não foi possível gerar o conteúdo.",
    connError: "Erro de conexão ao gerar o conteúdo. Tente novamente.",
  },
  en: {
    heading: "AI Enrichment",
    benefits: "Benefits",
    faq: "Frequently asked questions",
    regenerate: "Regenerate",
    retry: "Try again",
    loading: "Loading content",
    genericError: "Could not generate the content.",
    connError: "Connection error while generating the content. Try again.",
  },
};

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
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const t = UI_TEXT[locale];

  // Detecta o idioma do navegador uma vez no mount (default pt-BR evita
  // divergência de hidratação; ajusta para en só no cliente, se for o caso).
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      navigator.language.toLowerCase().startsWith("en")
    ) {
      setLocale("en");
    }
  }, []);

  const fetchEnrichment = useCallback(
    async (regenerate: boolean, signal?: AbortSignal) => {
      setState({ status: "loading" });

      const payload: EnrichRequest = {
        productId,
        productTitle,
        productDescription,
        category,
        regenerate,
        locale,
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
          const message = isApiError(body) ? body.error : t.genericError;
          setState({ status: "error", message });
          return;
        }

        setState({ status: "success", data: body as EnrichResult });
      } catch (err) {
        // Requisição abortada (ex.: desmontagem/novo clique) — ignora.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error", message: t.connError });
      }
    },
    [productId, productTitle, productDescription, category, locale, t],
  );

  // Dispara no mount, e refaz se o produto ou o idioma mudar. Aborta ao desmontar.
  useEffect(() => {
    const controller = new AbortController();
    void fetchEnrichment(false, controller.signal);
    return () => controller.abort();
  }, [fetchEnrichment]);

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.heading}</h2>
        <div className="flex gap-1" role="group" aria-label="Idioma / Language">
          {(["pt-BR", "en"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLocale(lang)}
              aria-pressed={locale === lang}
              className={`rounded-md border px-2 py-1 text-xs font-medium ${
                locale === lang
                  ? "border-gray-800 bg-gray-800 text-white"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              {lang === "pt-BR" ? "PT" : "EN"}
            </button>
          ))}
        </div>
      </div>

      {state.status === "loading" && <WidgetSkeleton label={t.loading} />}

      {state.status === "error" && (
        <div className="mt-4">
          <p className="text-sm text-red-600">{state.message}</p>
          <button
            type="button"
            onClick={() => void fetchEnrichment(false)}
            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            {t.retry}
          </button>
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-4 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500">{t.benefits}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {state.data.bullets.map((bullet, index) => (
                <li key={index}>{bullet}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-500">{t.faq}</h3>
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
            {t.regenerate}
          </button>
        </div>
      )}
    </section>
  );
}

function WidgetSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-4 animate-pulse space-y-3" aria-label={label}>
      <div className="h-3 w-1/3 rounded bg-gray-200" />
      <div className="h-3 w-full rounded bg-gray-200" />
      <div className="h-3 w-5/6 rounded bg-gray-200" />
      <div className="h-3 w-2/3 rounded bg-gray-200" />
    </div>
  );
}

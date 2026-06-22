"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type {
  ApiError,
  EnrichRequest,
  EnrichResult,
  Locale,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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

  const isLoading = state.status === "loading";

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <CardTitle>{t.heading}</CardTitle>
          <Badge variant="ai">
            <Sparkles aria-hidden="true" className="h-3 w-3" />
            {locale === "en" ? "AI-enriched" : "Enriquecido por IA"}
          </Badge>
        </div>
        <div className="flex gap-1" role="group" aria-label="Idioma / Language">
          {(["pt-BR", "en"] as const).map((lang) => (
            <Button
              key={lang}
              type="button"
              size="sm"
              variant={locale === lang ? "default" : "outline"}
              onClick={() => setLocale(lang)}
              aria-pressed={locale === lang}
              disabled={isLoading}
            >
              {lang === "pt-BR" ? "PT" : "EN"}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {state.status === "loading" && <WidgetSkeleton label={t.loading} />}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0" />
              <p className="text-sm font-medium">{state.message}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void fetchEnrichment(false)}
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              {t.retry}
            </Button>
          </div>
        )}

        {state.status === "success" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.benefits}
              </h3>
              <ul className="space-y-2.5">
                {state.data.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check aria-hidden="true" className="h-3 w-3" />
                    </span>
                    <span className="leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.faq}
              </h3>
              <Accordion
                type="single"
                collapsible
                defaultValue="faq-0"
                className="w-full"
              >
                {state.data.faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`faq-${index}`}>
                    <AccordionTrigger>{faq.question}</AccordionTrigger>
                    <AccordionContent>
                      <span className="leading-relaxed">{faq.answer}</span>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchEnrichment(true)}
              disabled={isLoading}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t.regenerate}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WidgetSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label} aria-busy="true">
      {/* Bloco de benefícios */}
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      {/* Bloco de FAQ */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

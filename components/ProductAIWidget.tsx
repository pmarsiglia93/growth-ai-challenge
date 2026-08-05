"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  isEnrichResult,
  type ApiError,
  type EnrichRequest,
  type EnrichResult,
  type Locale,
} from "@/lib/types";
import {
  NDJSON_CONTENT_TYPE,
  isStreamEvent,
  splitLines,
  type PartialEnrichment,
} from "@/lib/stream-protocol";
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
  streaming: string;
  genericError: string;
  connError: string;
  formatError: string;
}> = {
  "pt-BR": {
    heading: "Enriquecimento com IA",
    benefits: "Benefícios",
    faq: "Perguntas frequentes",
    regenerate: "Regenerar",
    retry: "Tentar novamente",
    loading: "Carregando conteúdo",
    streaming: "Gerando conteúdo",
    genericError: "Não foi possível gerar o conteúdo.",
    connError: "Erro de conexão ao gerar o conteúdo. Tente novamente.",
    formatError: "A resposta recebida veio em um formato inesperado.",
  },
  en: {
    heading: "AI Enrichment",
    benefits: "Benefits",
    faq: "Frequently asked questions",
    regenerate: "Regenerate",
    retry: "Try again",
    loading: "Loading content",
    streaming: "Generating content",
    genericError: "Could not generate the content.",
    connError: "Connection error while generating the content. Try again.",
    formatError: "The response came back in an unexpected format.",
  },
};

interface ProductAIWidgetProps {
  productId: string;
  productTitle: string;
  productDescription: string;
  category: string;
}

/**
 * Estado explícito via union type — nada de booleanos soltos.
 * `streaming` é o estado intermediário do modo NDJSON: já há conteúdo parcial
 * na tela, mas a geração ainda não terminou.
 */
type WidgetState =
  | { status: "loading" }
  | { status: "streaming"; partial: PartialEnrichment }
  | { status: "success"; data: EnrichResult }
  | { status: "error"; message: string };

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).error === "string"
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
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

  // Guarda a requisição em voo: qualquer nova chamada (ou a desmontagem)
  // cancela a anterior, evitando requisições duplicadas e updates órfãos.
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

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

  /**
   * Consome a resposta NDJSON progressivamente: lê `response.body` com um
   * `ReadableStreamDefaultReader`, decodifica com `TextDecoder` e processa
   * linha a linha, guardando a linha incompleta entre chunks.
   */
  const consumeStream = useCallback(
    async (
      body: ReadableStream<Uint8Array>,
      signal: AbortSignal,
      requestId: number,
    ) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let partial: PartialEnrichment = { bullets: [], faqs: [] };
      let settled = false;
      const cancelReader = (): void => {
        void reader.cancel().catch(() => {});
      };

      signal.addEventListener("abort", cancelReader, { once: true });

      const isCurrent = (): boolean =>
        !signal.aborted && requestSequenceRef.current === requestId;

      const handleLine = (line: string): boolean => {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return false;
        }
        if (!isStreamEvent(event) || !isCurrent()) return false;

        if (event.type === "bullet") {
          // O servidor emite índices contíguos. Ignorar repetidos ou fora de
          // ordem impede duplicação caso um intermediário repita uma linha.
          if (event.index !== partial.bullets.length || event.index >= 3) {
            return false;
          }
          partial = { ...partial, bullets: [...partial.bullets, event.value] };
          setState({ status: "streaming", partial });
        } else if (event.type === "faq") {
          if (event.index !== partial.faqs.length || event.index >= 3) {
            return false;
          }
          partial = { ...partial, faqs: [...partial.faqs, event.value] };
          setState({ status: "streaming", partial });
        } else if (event.type === "done") {
          settled = true;
          setState({ status: "success", data: event.result });
          return true;
        } else {
          settled = true;
          // Mensagens 500 do servidor não viram detalhes técnicos na UI.
          setState({ status: "error", message: t.genericError });
          return true;
        }
        return false;
      };

      try {
        while (isCurrent()) {
          const { done, value } = await reader.read();
          if (done) {
            // Finaliza um caractere UTF-8 pendente e processa a última linha
            // mesmo se o servidor encerrar sem a quebra "\n" final.
            buffer += decoder.decode();
            if (buffer.trim() !== "" && handleLine(buffer)) return;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { lines, rest } = splitLines(buffer);
          buffer = rest;

          for (const line of lines) {
            if (handleLine(line)) return;
          }
        }

        // Stream terminou sem `done` nem `error`: resultado final incompleto.
        if (!settled && isCurrent()) {
          setState({ status: "error", message: t.genericError });
        }
      } finally {
        // Fecha o corpo mesmo quando saímos cedo (evento final, erro ou abort),
        // para não deixar a conexão pendurada.
        signal.removeEventListener("abort", cancelReader);
        cancelReader();
      }
    },
    [t],
  );

  const fetchEnrichment = useCallback(
    async (regenerate: boolean) => {
      // Cancela a requisição anterior antes de abrir outra.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const requestId = ++requestSequenceRef.current;
      const isCurrent = (): boolean =>
        !signal.aborted && requestSequenceRef.current === requestId;

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
          headers: {
            "Content-Type": "application/json",
            // Sinaliza que sabemos consumir o stream; a rota decide o formato.
            Accept: `${NDJSON_CONTENT_TYPE}, application/json`,
          },
          body: JSON.stringify(payload),
          signal,
        });

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          if (!isCurrent()) return;
          const message =
            response.status < 500 && isApiError(body)
              ? body.error
              : t.genericError;
          setState({ status: "error", message });
          return;
        }

        // A rota responde NDJSON no modo streaming e JSON puro no modo
        // não-streaming (e sempre JSON num cache hit): o Content-Type decide.
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes(NDJSON_CONTENT_TYPE) && response.body) {
          await consumeStream(response.body, signal, requestId);
          return;
        }

        const body: unknown = await response.json();
        if (!isCurrent()) return;
        setState(
          isEnrichResult(body)
            ? { status: "success", data: body }
            : { status: "error", message: t.formatError },
        );
      } catch (err) {
        // Requisição abortada (ex.: desmontagem/novo clique) — ignora.
        if (isAbortError(err) || signal.aborted) return;
        setState({ status: "error", message: t.connError });
      }
    },
    [productId, productTitle, productDescription, category, locale, t, consumeStream],
  );

  // Dispara no mount, e refaz se o produto ou o idioma mudar. Aborta ao desmontar.
  useEffect(() => {
    void fetchEnrichment(false);
    return () => {
      requestSequenceRef.current += 1;
      abortRef.current?.abort();
    };
  }, [fetchEnrichment]);

  const isStreaming = state.status === "streaming";
  const isBusy = state.status === "loading" || isStreaming;
  const content =
    state.status === "success"
      ? state.data
      : state.status === "streaming"
        ? state.partial
        : null;

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
            >
              {lang === "pt-BR" ? "PT" : "EN"}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {state.status === "loading" && <WidgetSkeleton label={t.loading} />}

        {state.status === "error" && (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4"
          >
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

        {content && (
          <div className="space-y-6" aria-busy={isStreaming}>
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.benefits}
              </h3>
              <ul className="space-y-2.5">
                {content.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check aria-hidden="true" className="h-3 w-3" />
                    </span>
                    <span className="leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* No streaming as FAQs só existem depois dos bullets. */}
            {content.faqs.length > 0 && (
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
                  {content.faqs.map((faq, index) => (
                    <AccordionItem key={index} value={`faq-${index}`}>
                      <AccordionTrigger>{faq.question}</AccordionTrigger>
                      <AccordionContent>
                        <span className="leading-relaxed">{faq.answer}</span>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}

            {isStreaming ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-slate-500"
              >
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
                {t.streaming}…
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchEnrichment(true)}
                disabled={isBusy}
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {t.regenerate}
              </Button>
            )}
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

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductAIWidget from "@/components/ProductAIWidget";
import type { EnrichResult } from "@/lib/types";
import { NDJSON_CONTENT_TYPE, encodeStreamEvent } from "@/lib/stream-protocol";
import type { StreamEvent } from "@/lib/stream-protocol";

const props = {
  productId: "001",
  productTitle: "Tênis Running Pro X200",
  productDescription: "Tênis de corrida com amortecimento EVA duplo.",
  category: "Calçados Esportivos",
};

const sampleResult: EnrichResult = {
  bullets: ["Amortecimento confortável", "Bom para longas distâncias"],
  faqs: [
    { question: "Serve para asfalto?", answer: "Sim, é indicado para asfalto." },
    { question: "Tem amortecimento?", answer: "Sim, EVA duplo." },
    { question: "É respirável?", answer: "Sim, cabedal em mesh." },
  ],
};

/** Response-like em JSON (modo não-streaming / cache hit). */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Response-like em NDJSON cujos eventos são liberados manualmente, para
 * observar a renderização progressiva evento a evento.
 */
function ndjsonResponse(): {
  response: Response;
  push: (event: StreamEvent) => Promise<void>;
  close: () => Promise<void>;
} {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": NDJSON_CONTENT_TYPE }),
    body,
    json: async () => {
      throw new Error("json() não deve ser chamado numa resposta NDJSON");
    },
  } as unknown as Response;

  // `act` garante que o React processe o setState disparado por cada evento.
  const push = async (event: StreamEvent): Promise<void> => {
    await act(async () => {
      controller.enqueue(encoder.encode(encodeStreamEvent(event)));
      await Promise.resolve();
    });
  };

  // O widget cancela o corpo assim que recebe o evento final, então o stream
  // pode já estar fechado quando o teste chama close() — o que é o esperado.
  const close = async (): Promise<void> => {
    await act(async () => {
      try {
        controller.close();
      } catch {
        // Já cancelado pelo widget.
      }
      await Promise.resolve();
    });
  };

  return { response, push, close };
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("ProductAIWidget — modo JSON", () => {
  it("(a) mostra o estado de loading inicialmente", () => {
    // fetch que nunca resolve — mantém o widget em loading.
    global.fetch = jest.fn(() => new Promise<Response>(() => {}));

    render(<ProductAIWidget {...props} />);

    expect(screen.getByLabelText("Carregando conteúdo")).toBeInTheDocument();
  });

  it("(b) chama a API automaticamente no mount com o payload do produto", async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse(sampleResult),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);
    await screen.findByText("Amortecimento confortável");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall?.[1]) throw new Error("primeira chamada de fetch sem init");
    const [url, init] = firstCall;
    expect(url).toBe("/api/enrich-product");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      productId: props.productId,
      productTitle: props.productTitle,
      productDescription: props.productDescription,
      category: props.category,
      regenerate: false,
    });
  });

  it("(c) renderiza todos os bullets e as 3 FAQs no sucesso", async () => {
    global.fetch = jest.fn(async () => jsonResponse(sampleResult));

    render(<ProductAIWidget {...props} />);

    for (const bullet of sampleResult.bullets) {
      expect(await screen.findByText(bullet)).toBeInTheDocument();
    }
    for (const faq of sampleResult.faqs) {
      expect(screen.getByText(faq.question)).toBeInTheDocument();
    }
    expect(screen.getByText("Perguntas frequentes")).toBeInTheDocument();
  });

  it("(d) mostra mensagem amigável quando o fetch falha", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("network down");
    });

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText(/erro de conexão/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  });

  it("(e) exibe a mensagem de erro devolvida pela API em respostas não-ok", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: "Campo obrigatório ausente ou inválido: 'category'." }, false, 400),
    );

    render(<ProductAIWidget {...props} />);

    expect(
      await screen.findByText(/Campo obrigatório ausente ou inválido/),
    ).toBeInTheDocument();
  });

  it("(f) trata 200 com corpo fora do contrato como erro de formato", async () => {
    // 200 OK, mas sem bullets/faqs — não pode quebrar a renderização.
    global.fetch = jest.fn(async () => jsonResponse({ unexpected: true }));

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText(/formato inesperado/i)).toBeInTheDocument();
  });

  it("rejeita conteúdo incompleto mesmo quando bullets e faqs são arrays", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        bullets: ["Apenas um"],
        faqs: sampleResult.faqs.slice(0, 2),
      }),
    );

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText(/formato inesperado/i)).toBeInTheDocument();
  });

  it("trata JSON malformado na resposta como erro de conexão amigável", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => {
        throw new SyntaxError("JSON truncado");
      },
    })) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/erro de conexão/i);
  });

  it("o botão de retry refaz a chamada depois de um erro", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Falha temporária" }, false, 500))
      .mockResolvedValueOnce(jsonResponse(sampleResult));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);
    await screen.findByText("Não foi possível gerar o conteúdo.");

    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" }),
    );

    expect(await screen.findByText("Amortecimento confortável")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("(g) clicar em Regenerar dispara novo fetch com regenerate: true", async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse(sampleResult),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    await screen.findByText("Amortecimento confortável");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Regenerar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const init = fetchMock.mock.calls[1]?.[1];
    if (!init) throw new Error("segunda chamada de fetch sem init");
    const body = JSON.parse(init.body as string) as { regenerate: boolean };
    expect(body.regenerate).toBe(true);
  });

  it("(h) trocar para EN dispara novo fetch com locale 'en' e traduz a UI", async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse(sampleResult),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    await screen.findByText("Amortecimento confortável");
    const firstInit = fetchMock.mock.calls[0]?.[1];
    if (!firstInit) throw new Error("primeira chamada sem init");
    expect(JSON.parse(firstInit.body as string).locale).toBe("pt-BR");

    await userEvent.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const enInit = fetchMock.mock.calls[1]?.[1];
    if (!enInit) throw new Error("segunda chamada sem init");
    expect(JSON.parse(enInit.body as string).locale).toBe("en");

    // Os rótulos acompanham o idioma escolhido.
    expect(await screen.findByText("Benefits")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerate" }),
    ).toBeInTheDocument();
  });

  it("(i) aborta a requisição em voo ao desmontar, sem atualizar o estado depois", async () => {
    const abortSpy = jest.fn();
    let capturedSignal: AbortSignal | undefined;

    global.fetch = jest.fn((_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      capturedSignal?.addEventListener("abort", abortSpy);
      // Nunca resolve: a única saída é o abort da desmontagem.
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<ProductAIWidget {...props} />);

    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(true);
    // Um setState após a desmontagem apareceria como warning do React.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("(j) uma nova requisição cancela a anterior, evitando respostas duplicadas", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return jsonResponse(sampleResult);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);
    await screen.findByText("Amortecimento confortável");

    await userEvent.click(screen.getByRole("button", { name: "Regenerar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // O signal da 1ª chamada foi abortado pela 2ª; o da 2ª segue ativo.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("ignora uma resposta antiga que termina depois da requisição atual", async () => {
    const first = deferred<Response>();
    const currentResult: EnrichResult = {
      ...sampleResult,
      bullets: ["Conteúdo atual A", "Conteúdo atual B"],
    };
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(jsonResponse(currentResult));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { rerender } = render(<ProductAIWidget {...props} />);
    rerender(<ProductAIWidget {...props} productId="002" />);

    expect(await screen.findByText("Conteúdo atual A")).toBeInTheDocument();

    await act(async () => {
      first.resolve(jsonResponse(sampleResult));
      await Promise.resolve();
    });

    expect(screen.queryByText("Amortecimento confortável")).not.toBeInTheDocument();
    expect(screen.getByText("Conteúdo atual A")).toBeInTheDocument();
  });

  it("permite trocar o idioma durante o loading e aborta a chamada anterior", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = jest
      .fn()
      .mockImplementationOnce((_url: unknown, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => {});
      })
      .mockImplementationOnce((_url: unknown, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return Promise.resolve(jsonResponse(sampleResult));
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(await screen.findByText("Benefits")).toBeInTheDocument();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe("ProductAIWidget — modo streaming (NDJSON)", () => {
  it("(k) renderiza bullets e FAQs progressivamente e fecha com o resultado final", async () => {
    const stream = ndjsonResponse();
    global.fetch = jest.fn(async () => stream.response) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);
    expect(screen.getByLabelText("Carregando conteúdo")).toBeInTheDocument();

    // Primeiro bullet: já aparece antes de o restante do JSON existir.
    await stream.push({ type: "bullet", index: 0, value: sampleResult.bullets[0]! });
    expect(await screen.findByText(sampleResult.bullets[0]!)).toBeInTheDocument();
    expect(screen.queryByText(sampleResult.bullets[1]!)).not.toBeInTheDocument();
    // Ainda gerando: indicador visível e nada de botão Regenerar.
    expect(screen.getByText(/gerando conteúdo/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Regenerar" }),
    ).not.toBeInTheDocument();

    await stream.push({ type: "bullet", index: 1, value: sampleResult.bullets[1]! });
    expect(await screen.findByText(sampleResult.bullets[1]!)).toBeInTheDocument();

    await stream.push({ type: "faq", index: 0, value: sampleResult.faqs[0]! });
    expect(
      await screen.findByText(sampleResult.faqs[0]!.question),
    ).toBeInTheDocument();

    // Evento final: estado tipado completo e UI liberada.
    await stream.push({ type: "done", result: sampleResult });
    await stream.close();

    expect(
      await screen.findByRole("button", { name: "Regenerar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/gerando conteúdo/i)).not.toBeInTheDocument();
    for (const faq of sampleResult.faqs) {
      expect(screen.getByText(faq.question)).toBeInTheDocument();
    }
  });

  it("(l) lida com eventos partidos entre chunks", async () => {
    const encoder = new TextEncoder();
    const line = encodeStreamEvent({
      type: "bullet",
      index: 0,
      value: "Bullet cortado ao meio",
    });
    const cut = Math.floor(line.length / 2);

    // Duas metades de uma mesma linha NDJSON, entregues em chunks separados.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(line.slice(0, cut)));
        controller.enqueue(encoder.encode(line.slice(cut)));
        controller.enqueue(
          encoder.encode(
            encodeStreamEvent({
              type: "done",
              result: {
                bullets: ["Bullet cortado ao meio", "Segundo bullet"],
                faqs: sampleResult.faqs,
              },
            }),
          ),
        );
        controller.close();
      },
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": NDJSON_CONTENT_TYPE }),
      body,
    })) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText("Bullet cortado ao meio")).toBeInTheDocument();
    expect(await screen.findByText("Segundo bullet")).toBeInTheDocument();
  });

  it("(m) mostra mensagem amigável quando o stream emite um evento de erro", async () => {
    const stream = ndjsonResponse();
    global.fetch = jest.fn(async () => stream.response) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    await stream.push({ type: "bullet", index: 0, value: "Bullet parcial" });
    await stream.push({
      type: "error",
      message: "'faqs' deve ser um array de exatamente 3 itens {question, answer}.",
    });
    await stream.close();

    expect(
      await screen.findByText("Não foi possível gerar o conteúdo."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  });

  it("(n) trata stream encerrado sem evento final como erro", async () => {
    const stream = ndjsonResponse();
    global.fetch = jest.fn(async () => stream.response) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    await stream.push({ type: "bullet", index: 0, value: "Bullet órfão" });
    await stream.close();

    expect(
      await screen.findByText("Não foi possível gerar o conteúdo."),
    ).toBeInTheDocument();
  });

  it("processa vários eventos em um chunk e a última linha sem quebra final", async () => {
    const encoder = new TextEncoder();
    const finalLine = encodeStreamEvent({ type: "done", result: sampleResult }).trimEnd();
    const chunk =
      encodeStreamEvent({
        type: "bullet",
        index: 0,
        value: sampleResult.bullets[0]!,
      }) + finalLine;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": NDJSON_CONTENT_TYPE }),
      body,
    })) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText(sampleResult.bullets[1]!)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Regenerar" }),
    ).toBeInTheDocument();
  });

  it("cancela explicitamente o reader do stream ao desmontar", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": NDJSON_CONTENT_TYPE }),
      body,
    })) as unknown as typeof fetch;

    const { unmount } = render(<ProductAIWidget {...props} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    unmount();

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });

  it("decodifica UTF-8 quando um caractere multibyte é dividido entre chunks", async () => {
    const encoder = new TextEncoder();
    const result: EnrichResult = {
      ...sampleResult,
      bullets: ["Benefício rápido", "Outro benefício"],
    };
    const bytes = encoder.encode(
      encodeStreamEvent({
        type: "bullet",
        index: 0,
        value: result.bullets[0]!,
      }) + encodeStreamEvent({ type: "done", result }),
    );
    const firstMultibyte = bytes.findIndex((byte) => byte >= 0xc0);
    if (firstMultibyte < 0) throw new Error("fixture sem caractere multibyte");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, firstMultibyte + 1));
        controller.enqueue(bytes.slice(firstMultibyte + 1));
        controller.close();
      },
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": NDJSON_CONTENT_TYPE }),
      body,
    })) as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    expect(await screen.findByText("Benefício rápido")).toBeInTheDocument();
    expect(screen.getByText("Outro benefício")).toBeInTheDocument();
  });
});

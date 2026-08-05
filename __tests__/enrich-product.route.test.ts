/**
 * @jest-environment node
 *
 * Testes da rota POST /api/enrich-product. O SDK da Anthropic é mockado por
 * completo: nenhum teste toca uma API real.
 */
import { POST } from "@/app/api/enrich-product/route";
import type { EnrichResult } from "@/lib/types";
import { isStreamEvent, type StreamEvent } from "@/lib/stream-protocol";

/** Deltas de texto que o "modelo" emite no modo streaming. */
type Delta = { type: "content_block_delta"; delta: { type: "text_delta"; text: string } };

const mockCreate = jest.fn();
const mockStream = jest.fn();

// `jest.mock` é içado acima dos imports, então `lib/enrich` já recebe este
// client falso ao ser carregado pela rota.
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

const VALID_RESULT: EnrichResult = {
  bullets: ["Bullet um", "Bullet dois"],
  faqs: [
    { question: "P1?", answer: "R1." },
    { question: "P2?", answer: "R2." },
    { question: "P3?", answer: "R3." },
  ],
};

const VALID_JSON = JSON.stringify(VALID_RESULT);

/** Resposta não-streaming do SDK. */
function llmMessage(text: string) {
  return { content: [{ type: "text", text }] };
}

/** Stream do SDK: async-iterável de deltas + `finalMessage()`. */
function llmStream(chunks: string[], finalText = chunks.join("")) {
  const deltas: Delta[] = chunks.map((text) => ({
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  }));

  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) yield delta;
    },
    finalMessage: async () => llmMessage(finalText),
    abort: jest.fn(),
  };
}

/** Requisição em modo JSON (sem pedir NDJSON no Accept). */
function postRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/enrich-product", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Requisição pedindo streaming, como o widget faz. */
function streamRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/enrich-product", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson, application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Payload válido; cada teste usa um productId próprio por causa do cache. */
function validPayload(productId: string, extra: Record<string, unknown> = {}) {
  return {
    productId,
    productTitle: "Tênis Running Pro X200",
    productDescription: "Tênis de corrida com amortecimento EVA duplo.",
    category: "Calçados Esportivos",
    ...extra,
  };
}

/** Lê a resposta NDJSON inteira e devolve os eventos já validados. */
async function readEvents(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown)
    .filter(isStreamEvent);
}

beforeEach(() => {
  mockCreate.mockReset();
  mockStream.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key-nao-real";
  // Modo JSON é o default dos testes; o bloco de streaming liga explicitamente.
  process.env.STREAMING_ENABLED = "false";
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/enrich-product — validação do payload", () => {
  it("aceita um payload válido e devolve bullets + faqs", async () => {
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));

    const response = await POST(postRequest(validPayload("val-1")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VALID_RESULT);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["productId", { productId: undefined }],
    ["productTitle", { productTitle: undefined }],
    ["productDescription", { productDescription: undefined }],
    ["category", { category: undefined }],
  ])("rejeita com 400 quando falta '%s'", async (field, override) => {
    const payload = { ...validPayload("val-missing"), ...override };
    delete (payload as Record<string, unknown>)[field];

    const response = await POST(postRequest(payload));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(field);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["productId numérico", validPayload("x", { productId: 123 })],
    ["category vazia", validPayload("val-empty", { category: "   " })],
    [
      "descrição excessiva",
      validPayload("val-long", { productDescription: "x".repeat(5_001) }),
    ],
    ["regenerate string", validPayload("val-regen", { regenerate: "sim" })],
    ["locale desconhecido", validPayload("val-loc", { locale: "fr" })],
  ])("rejeita com 400 tipos inválidos: %s", async (_label, payload) => {
    const response = await POST(postRequest(payload));

    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejeita com 400 um corpo que não é JSON", async () => {
    const response = await POST(postRequest("isto não é json"));

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([undefined, "text/plain", "application/json-patch+json"])(
    "rejeita Content-Type ausente ou incompatível: %s",
    async (contentType) => {
      const headers = contentType ? { "Content-Type": contentType } : undefined;
      const request = new Request("http://localhost:3000/api/enrich-product", {
        method: "POST",
        headers,
        body: JSON.stringify(validPayload("content-type-invalid")),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Content-Type/);
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  it("aceita application/json com charset", async () => {
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));
    const request = new Request("http://localhost:3000/api/enrich-product", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(validPayload("content-type-charset")),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VALID_RESULT);
  });
});

describe("POST /api/enrich-product — resposta do LLM", () => {
  it("devolve 500 quando o LLM responde algo que não é JSON", async () => {
    mockCreate.mockResolvedValue(llmMessage("Claro! Aqui vão os benefícios:"));

    const response = await POST(postRequest(validPayload("llm-1")));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe(
      "Não foi possível gerar o conteúdo no momento.",
    );
  });

  it("devolve 500 quando o JSON do LLM tem contagem fora do contrato", async () => {
    // 1 bullet (mínimo é 2) e 2 FAQs (precisa ser exatamente 3).
    mockCreate.mockResolvedValue(
      llmMessage(
        JSON.stringify({ bullets: ["só um"], faqs: VALID_RESULT.faqs.slice(0, 2) }),
      ),
    );

    const response = await POST(postRequest(validPayload("llm-2")));

    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toMatch(/bullets/);
  });

  it("aceita JSON envolto em cercas de código", async () => {
    mockCreate.mockResolvedValue(llmMessage(`\`\`\`json\n${VALID_JSON}\n\`\`\``));

    const response = await POST(postRequest(validPayload("llm-3")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VALID_RESULT);
  });

  it("devolve 500 quando o provedor falha, sem vazar detalhes internos", async () => {
    mockCreate.mockRejectedValue(new Error("529 overloaded_error"));

    const response = await POST(postRequest(validPayload("llm-4")));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toMatch(/529|overloaded/i);
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("trata rejeição inesperada do SDK sem expor o valor recebido", async () => {
    mockCreate.mockRejectedValue({ token: "detalhe-interno", status: 503 });

    const response = await POST(postRequest(validPayload("llm-unexpected")));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("detalhe-interno");
    expect(text).not.toContain("503");
  });

  it("devolve 500 descritivo quando a chave de API não está configurada", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await POST(postRequest(validPayload("llm-5")));

    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("não devolve o valor da chave em nenhuma resposta de erro", async () => {
    process.env.ANTHROPIC_API_KEY = "chave-secreta-de-teste";
    mockCreate.mockRejectedValue(new Error("falha"));

    const response = await POST(postRequest(validPayload("llm-6")));

    expect(await response.text()).not.toContain("chave-secreta-de-teste");
  });
});

describe("POST /api/enrich-product — cache", () => {
  it("cache miss chama o LLM; o hit seguinte responde sem chamar de novo", async () => {
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));

    const first = await POST(postRequest(validPayload("cache-1")));
    expect(first.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const second = await POST(postRequest(validPayload("cache-1")));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(VALID_RESULT);
    expect(mockCreate).toHaveBeenCalledTimes(1); // continua 1: veio do cache.
  });

  it("regenerate ignora o cache e devolve conteúdo novo", async () => {
    const outro: EnrichResult = { ...VALID_RESULT, bullets: ["Novo A", "Novo B"] };
    mockCreate
      .mockResolvedValueOnce(llmMessage(VALID_JSON))
      .mockResolvedValueOnce(llmMessage(JSON.stringify(outro)));

    await POST(postRequest(validPayload("cache-2")));
    const regenerated = await POST(
      postRequest(validPayload("cache-2", { regenerate: true })),
    );

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await regenerated.json()).toEqual(outro);
  });

  it("separa o cache por idioma", async () => {
    const emIngles: EnrichResult = {
      ...VALID_RESULT,
      bullets: ["Bullet one", "Bullet two"],
    };
    mockCreate
      .mockResolvedValueOnce(llmMessage(VALID_JSON))
      .mockResolvedValueOnce(llmMessage(JSON.stringify(emIngles)));

    const pt = await POST(postRequest(validPayload("cache-3", { locale: "pt-BR" })));
    const en = await POST(postRequest(validPayload("cache-3", { locale: "en" })));

    // Mesmo productId, idiomas diferentes: o 'en' NÃO pode vir do cache do 'pt-BR'.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await pt.json()).toEqual(VALID_RESULT);
    expect(await en.json()).toEqual(emIngles);

    // E cada idioma continua servindo o seu próprio cache.
    const ptDeNovo = await POST(
      postRequest(validPayload("cache-3", { locale: "pt-BR" })),
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await ptDeNovo.json()).toEqual(VALID_RESULT);
  });

  it("passa o idioma pedido para o prompt enviado ao LLM", async () => {
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));

    await POST(postRequest(validPayload("cache-4", { locale: "en" })));

    const prompt = mockCreate.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain("INGLÊS");
    expect(prompt).toContain("Tênis Running Pro X200");
  });
});

describe("POST /api/enrich-product — streaming NDJSON", () => {
  beforeEach(() => {
    process.env.STREAMING_ENABLED = "true";
  });

  it("responde NDJSON com um evento por bullet/FAQ e um 'done' final", async () => {
    // O JSON chega picotado, como num stream real.
    mockStream.mockReturnValue(
      llmStream([
        '{"bullets": ["Bullet um"',
        ', "Bullet dois"], "faqs": [{"question": "P1?", ',
        '"answer": "R1."}, {"question": "P2?", "answer": "R2."}, ',
        '{"question": "P3?", "answer": "R3."}]}',
      ]),
    );

    const response = await POST(streamRequest(validPayload("stream-1")));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");

    const events = await readEvents(response);
    expect(events.filter((e) => e.type === "bullet")).toHaveLength(2);
    expect(events.filter((e) => e.type === "faq")).toHaveLength(3);

    const last = events[events.length - 1];
    expect(last?.type).toBe("done");
    if (last?.type === "done") expect(last.result).toEqual(VALID_RESULT);

    // Os eventos parciais chegam antes do resultado final.
    expect(events[0]?.type).toBe("bullet");
  });

  it("grava no cache o resultado do stream e o hit seguinte volta em JSON", async () => {
    mockStream.mockReturnValue(llmStream([VALID_JSON]));

    const streamed = await POST(streamRequest(validPayload("stream-2")));
    await readEvents(streamed);

    const cached = await POST(streamRequest(validPayload("stream-2")));

    expect(cached.headers.get("content-type")).toContain("application/json");
    expect(await cached.json()).toEqual(VALID_RESULT);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("emite um evento de erro quando o JSON acumulado é inválido", async () => {
    mockStream.mockReturnValue(llmStream(["conteúdo que não é JSON"]));

    const response = await POST(streamRequest(validPayload("stream-3")));
    const events = await readEvents(response);

    expect(response.status).toBe(200); // o header já foi enviado.
    const last = events[events.length - 1];
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.message).toBe("Não foi possível gerar o conteúdo no momento.");
    }
  });

  it("falha de pré-voo (sem chave) ainda vira HTTP 500 em JSON", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await POST(streamRequest(validPayload("stream-4")));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it("valida o payload antes de abrir qualquer stream", async () => {
    const response = await POST(streamRequest({ productId: "stream-5" }));

    expect(response.status).toBe(400);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("responde JSON para quem não pede NDJSON no Accept (ex.: n8n, curl)", async () => {
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));

    const response = await POST(postRequest(validPayload("stream-6")));

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(VALID_RESULT);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("STREAMING_ENABLED=false força JSON mesmo com Accept NDJSON", async () => {
    process.env.STREAMING_ENABLED = "false";
    mockCreate.mockResolvedValue(llmMessage(VALID_JSON));

    const response = await POST(streamRequest(validPayload("stream-7")));

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(VALID_RESULT);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("aborta o stream do provedor quando o consumidor cancela a resposta", async () => {
    const abort = jest.fn();
    const pendingStream = {
      async *[Symbol.asyncIterator]() {
        await new Promise<void>(() => {});
      },
      finalMessage: async () => llmMessage(VALID_JSON),
      abort,
    };
    mockStream.mockReturnValue(pendingStream);

    const response = await POST(streamRequest(validPayload("stream-abort")));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("resposta streaming sem body");

    await reader.cancel();

    expect(abort).toHaveBeenCalledTimes(1);
  });
});

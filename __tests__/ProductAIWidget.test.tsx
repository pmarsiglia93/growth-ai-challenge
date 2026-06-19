import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProductAIWidget from "@/components/ProductAIWidget";
import type { EnrichResult } from "@/lib/types";

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

/** Helper: cria um Response-like com json() resolvido. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("ProductAIWidget", () => {
  it("(a) mostra o estado de loading inicialmente", () => {
    // fetch que nunca resolve — mantém o widget em loading.
    global.fetch = jest.fn(() => new Promise<Response>(() => {}));

    render(<ProductAIWidget {...props} />);

    expect(screen.getByLabelText("Carregando conteúdo")).toBeInTheDocument();
  });

  it("(b) renderiza bullets e FAQ no sucesso", async () => {
    global.fetch = jest.fn(async () => jsonResponse(sampleResult));

    render(<ProductAIWidget {...props} />);

    // Um bullet e uma pergunta aparecem após a resposta.
    expect(
      await screen.findByText("Amortecimento confortável"),
    ).toBeInTheDocument();
    expect(screen.getByText("Serve para asfalto?")).toBeInTheDocument();
    expect(screen.getByText("Sim, é indicado para asfalto.")).toBeInTheDocument();
    expect(screen.getByText("Perguntas frequentes")).toBeInTheDocument();
  });

  it("(c) mostra mensagem de erro quando o fetch falha", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("network down");
    });

    render(<ProductAIWidget {...props} />);

    expect(
      await screen.findByText(/erro de conexão/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  });

  it("(d) clicar em Regenerar dispara novo fetch com regenerate: true", async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse(sampleResult),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProductAIWidget {...props} />);

    // Aguarda o primeiro fetch (mount, regenerate: false) resolver.
    await screen.findByText("Amortecimento confortável");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Regenerar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Inspeciona o corpo da segunda chamada.
    const secondCall = fetchMock.mock.calls[1];
    if (!secondCall) throw new Error("segunda chamada de fetch não ocorreu");
    const init = secondCall[1];
    if (!init) throw new Error("segunda chamada de fetch sem init");
    const body = JSON.parse(init.body as string) as { regenerate: boolean };
    expect(body.regenerate).toBe(true);
  });
});

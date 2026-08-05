import {
  encodeStreamEvent,
  extractPartial,
  isStreamEvent,
  splitLines,
} from "@/lib/stream-protocol";

/** JSON completo que o LLM deve produzir — a base dos testes de parse parcial. */
const FULL_JSON = JSON.stringify({
  bullets: ["Bullet um", "Bullet dois"],
  faqs: [
    { question: "P1?", answer: "R1." },
    { question: "P2?", answer: "R2." },
    { question: "P3?", answer: "R3." },
  ],
});

describe("splitLines", () => {
  it("devolve as linhas completas e guarda a incompleta", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c":',
    });
  });

  it("não devolve nada quando ainda não há quebra de linha", () => {
    expect(splitLines('{"a"')).toEqual({ lines: [], rest: '{"a"' });
  });

  it("ignora linhas vazias", () => {
    expect(splitLines("\n\n{\"a\":1}\n").lines).toEqual(['{"a":1}']);
  });
});

describe("isStreamEvent", () => {
  it("aceita os quatro tipos de evento válidos", () => {
    expect(isStreamEvent({ type: "bullet", index: 0, value: "x" })).toBe(true);
    expect(
      isStreamEvent({ type: "faq", index: 0, value: { question: "q", answer: "a" } }),
    ).toBe(true);
    expect(
      isStreamEvent({
        type: "done",
        result: {
          bullets: ["a", "b"],
          faqs: [
            { question: "q1", answer: "a1" },
            { question: "q2", answer: "a2" },
            { question: "q3", answer: "a3" },
          ],
        },
      }),
    ).toBe(true);
    expect(isStreamEvent({ type: "error", message: "falhou" })).toBe(true);
  });

  it("rejeita eventos desconhecidos ou malformados", () => {
    expect(isStreamEvent({ type: "bullet", value: 42 })).toBe(false);
    expect(isStreamEvent({ type: "faq", index: 0, value: { question: "q" } })).toBe(
      false,
    );
    expect(isStreamEvent({ type: "outro" })).toBe(false);
    expect(isStreamEvent({ type: "bullet", index: -1, value: "x" })).toBe(false);
    expect(isStreamEvent({ type: "bullet", index: 0.5, value: "x" })).toBe(false);
    expect(isStreamEvent({ type: "error", message: "   " })).toBe(false);
    expect(isStreamEvent({ type: "done", result: { bullets: [], faqs: [] } })).toBe(
      false,
    );
    expect(isStreamEvent(null)).toBe(false);
    expect(isStreamEvent("texto")).toBe(false);
  });

  it("faz round-trip com encodeStreamEvent", () => {
    const line = encodeStreamEvent({ type: "bullet", index: 1, value: "x" });
    expect(line.endsWith("\n")).toBe(true);
    expect(isStreamEvent(JSON.parse(line))).toBe(true);
  });
});

describe("extractPartial", () => {
  it("não extrai nada de um texto sem JSON iniciado", () => {
    expect(extractPartial("")).toEqual({ bullets: [], faqs: [] });
    expect(extractPartial("Claro! Aqui está")).toEqual({ bullets: [], faqs: [] });
  });

  it("extrai o JSON completo", () => {
    expect(extractPartial(FULL_JSON)).toEqual({
      bullets: ["Bullet um", "Bullet dois"],
      faqs: [
        { question: "P1?", answer: "R1." },
        { question: "P2?", answer: "R2." },
        { question: "P3?", answer: "R3." },
      ],
    });
  });

  it("ignora a chave 'bullets' antes de existir qualquer valor", () => {
    expect(extractPartial('{"bullets"')).toEqual({ bullets: [], faqs: [] });
    expect(extractPartial('{"bullets": [')).toEqual({ bullets: [], faqs: [] });
  });

  it("libera cada bullet só depois que a string fecha", () => {
    expect(extractPartial('{"bullets": ["Bullet u').bullets).toEqual([]);
    expect(extractPartial('{"bullets": ["Bullet um"').bullets).toEqual(["Bullet um"]);
    expect(extractPartial('{"bullets": ["Bullet um", "Bullet do').bullets).toEqual([
      "Bullet um",
    ]);
  });

  it("libera uma FAQ só quando pergunta E resposta existem", () => {
    const semResposta = '{"bullets": ["a", "b"], "faqs": [{"question": "P1?"';
    expect(extractPartial(semResposta).faqs).toEqual([]);
    expect(extractPartial(semResposta).bullets).toEqual(["a", "b"]);

    const comResposta = `${semResposta}, "answer": "R1."}`;
    expect(extractPartial(comResposta).faqs).toEqual([
      { question: "P1?", answer: "R1." },
    ]);
  });

  it("cresce monotonicamente conforme o texto chega caractere a caractere", () => {
    // Simula o LLM escrevendo: nenhum prefixo pode "perder" itens já emitidos.
    let anteriorBullets = 0;
    let anteriorFaqs = 0;

    for (let i = 1; i <= FULL_JSON.length; i++) {
      const partial = extractPartial(FULL_JSON.slice(0, i));
      expect(partial.bullets.length).toBeGreaterThanOrEqual(anteriorBullets);
      expect(partial.faqs.length).toBeGreaterThanOrEqual(anteriorFaqs);
      anteriorBullets = partial.bullets.length;
      anteriorFaqs = partial.faqs.length;
    }

    expect(anteriorBullets).toBe(2);
    expect(anteriorFaqs).toBe(3);
  });

  it("lida com aspas escapadas dentro dos valores", () => {
    const texto = '{"bullets": ["Compartimento 15,6\\" acolchoado", "Outro"';
    expect(extractPartial(texto).bullets).toEqual([
      'Compartimento 15,6" acolchoado',
      "Outro",
    ]);
  });

  it("ignora cercas de código e texto antes do JSON", () => {
    expect(extractPartial('```json\n{"bullets": ["a", "b"]').bullets).toEqual([
      "a",
      "b",
    ]);
  });

  it("descarta itens que não são do tipo esperado", () => {
    expect(extractPartial('{"bullets": ["ok", 42, null]').bullets).toEqual(["ok"]);
    expect(extractPartial('{"faqs": [{"question": 1, "answer": 2}]').faqs).toEqual([]);
  });
});

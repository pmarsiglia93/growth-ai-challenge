/** @jest-environment node */

import { getCached, setCached } from "@/lib/cache";
import type { EnrichResult } from "@/lib/types";

describe("cache em memória", () => {
  it("isola o valor armazenado de mutações do chamador e do consumidor", () => {
    const original: EnrichResult = {
      bullets: ["A", "B"],
      faqs: [
        { question: "P1?", answer: "R1." },
        { question: "P2?", answer: "R2." },
        { question: "P3?", answer: "R3." },
      ],
    };

    setCached("cache-clone", "pt-BR", original);
    original.bullets[0] = "mutado fora";

    const firstRead = getCached("cache-clone", "pt-BR");
    expect(firstRead?.bullets[0]).toBe("A");
    if (!firstRead) throw new Error("cache miss inesperado");
    firstRead.faqs[0]!.answer = "mutado no consumidor";

    expect(getCached("cache-clone", "pt-BR")?.faqs[0]?.answer).toBe("R1.");
  });
});

import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";
import { ReadableStream } from "node:stream/web";

// O jsdom não implementa as Web Streams nem TextEncoder/TextDecoder, que o
// widget usa para consumir o NDJSON. Usamos as implementações do próprio Node
// (as mesmas do runtime do Next), sem sobrescrever nada que já exista.
const globals = globalThis as unknown as Record<string, unknown>;
globals.TextEncoder ??= TextEncoder;
globals.TextDecoder ??= TextDecoder;
globals.ReadableStream ??= ReadableStream;

// jsdom usa navigator.language = "en-US" por padrão. Fixamos pt-BR para que a
// detecção automática de idioma do widget não altere o locale nos testes.
// (Nos testes de API o ambiente é `node` e não existe `navigator`.)
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "pt-BR",
  });
}

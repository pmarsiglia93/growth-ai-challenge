import "@testing-library/jest-dom";

// jsdom usa navigator.language = "en-US" por padrão. Fixamos pt-BR para que a
// detecção automática de idioma do widget não altere o locale nos testes.
Object.defineProperty(navigator, "language", {
  configurable: true,
  value: "pt-BR",
});

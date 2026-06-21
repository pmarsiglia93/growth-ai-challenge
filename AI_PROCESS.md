# Processo de uso de IA

Relato honesto de como construí este projeto com apoio de IA.

## Ferramentas de IA usadas

- **Claude Code** (CLI da Anthropic, com modelo Claude) como par de programação,
  conduzindo o projeto de forma incremental, etapa a etapa, com um commit pequeno
  por entrega.
- A própria **API da Anthropic** (`@anthropic-ai/sdk`, modelo `claude-haiku-4-5`)
  é o motor de enriquecimento do produto final.

## Técnicas de prompt utilizadas

- **Especificação detalhada antecipada**: abri o trabalho com um prompt extenso
  definindo stack, estrutura de arquivos, contratos de tipos, comportamento de
  cada parte e um plano de execução em commits pequenos. Isso reduziu idas e
  vindas e manteve a IA dentro do escopo.
- **Trabalho incremental com checkpoint humano**: pedi para a IA mostrar o plano
  antes de gerar muito código e aprovei cada etapa antes de seguir.
- **Pedido explícito de sinalização de decisões técnicas** e de perguntar em vez
  de adivinhar quando algo estivesse ambíguo (ex.: implementar ou não o streaming).
- **Priorizar entrega** sobre perfeição: soluções simples e corretas.

## Gerado pela IA vs. escrito/revisado à mão

- **Gerado pela IA**: a maior parte do código (scaffold do Next, `lib/`, a rota da
  API, o `ProductAIWidget`, os testes, o suporte a pt-BR/en e os fluxos n8n) e a
  documentação (README, n8n, este arquivo). O projeto cobre os obrigatórios e os
  cinco diferenciais (testes, tipagem forte, streaming, multi-idioma e 2º fluxo n8n).
- **Dirigido/revisado por mim**: o escopo e a ordem das etapas, as decisões
  técnicas aprovadas a cada commit, e a verificação do app rodando com a chave real
  — testei os 4 produtos, o botão Regenerar e o toggle PT/EN, validei os caminhos
  400/500 da API e rodei os fluxos n8n ao vivo (import via CLI + disparo do webhook
  nos ramos de sucesso e de erro).

## O que corrigi ou rejeitei

- **`jest.config.ts` → `jest.config.js`**: a config em TypeScript exigia `ts-node`;
  troquei por CommonJS para não adicionar dependência só para isso.
- **Guards nos testes**: o TypeScript estrito (`noUncheckedIndexedAccess`) acusou
  acesso indexado possivelmente `undefined` em `fetch.mock.calls`; ajustei com
  verificações explícitas em vez de afrouxar o tsconfig.
- **Streaming não fiado na UI**: optei por deixar o streaming pronto no backend
  (atrás de `STREAMING_ENABLED`), mas mantive o widget no contrato JSON — consumir
  JSON parcial no cliente exigiria reescrever o parser sem ganho real para o escopo.
- **`.env.example` vs `.env`**: por engano colei a chave no `.env.example` (rastreado
  pelo Git); corrigi movendo para o `.env` (ignorado) e restaurando o exemplo. Bom
  lembrete de que segredo nunca vai para arquivo versionado.
- **Exatidão dos dados**: ao cruzar o `products.json` com a spec oficial, achei uma
  divergência de acento ("ergonómicas" vs "ergonômicas") e corrigi — o desafio pede
  "usar exatamente estes dados".
- **Cache por idioma**: ao adicionar pt-BR/en, percebi que o cache por `productId`
  devolveria o idioma errado ao trocar; ajustei a chave para `productId + locale`.
- **ESLint não configurado**: numa auditoria final, `npm run lint` caía num prompt
  interativo por falta de config. Adicionei `.eslintrc.json` (`next/core-web-vitals`)
  e as devDependencies — sem tocar em código; o lint passou limpo de primeira.

## Aprendizados

- **Commits pequenos são o melhor ponto de controle ao programar com IA**: cada
  etapa fechada e verificável tornou trivial revisar e confiar no que foi gerado.
- **Tipos compartilhados e parse defensivo são essenciais ao integrar um LLM**: a
  saída do modelo é texto, não um contrato; centralizar tipos entre front e back e
  validar a resposta (formato dos bullets/FAQs) evita que conteúdo inválido vaze
  para a interface.
- **Cuidado com segredos e com schema de ferramentas externas**: a chave do LLM
  fica só no `.env`; e o JSON do n8n varia entre versões, então documentei o passo
  a passo de validação em vez de prometer um import 100% automático.

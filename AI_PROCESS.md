# Processo de uso de IA

Relato honesto de como construí este projeto com apoio de IA.

## Ferramentas de IA usadas

- **Claude Code** (CLI da Anthropic, com modelo Claude) como par de programação,
  conduzindo o projeto de forma incremental, etapa a etapa, com um commit pequeno
  por entrega.
- **OpenAI Codex** na auditoria final: releu o repositório e o histórico, executou
  a baseline, identificou lacunas não cobertas e implementou/testou as correções.
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
  documentação (README, n8n, este arquivo).
- **Dirigido/revisado por mim**: o escopo e a ordem das etapas, as decisões
  técnicas aprovadas a cada commit, e a verificação do app rodando com a chave real
  — testei os 4 produtos, o botão Regenerar e o toggle PT/EN, validei os caminhos
  400/500 da API e rodei os fluxos n8n ao vivo (import via CLI + disparo do webhook
  nos ramos de sucesso e de erro).

### Status dos diferenciais

| Diferencial | Status | Evidência |
| ----------- | ------ | --------- |
| Testes automatizados | Implementado | 74 testes em `__tests__/`: widget, rota, protocolo NDJSON e isolamento do cache; Anthropic totalmente mockada |
| Tipagem forte no backend | Implementado | `tsconfig.json` com `strict` + `noUncheckedIndexedAccess`; validação por type guards em `lib/types.ts` e `lib/enrich.ts`; zero `any` |
| Streaming com `ReadableStream` | Implementado ponta a ponta | A rota emite snapshots NDJSON palavra a palavra e o widget os substitui por índice; validado por cliente HTTP real e testes de UI |
| Suporte a `pt-BR` e `en` | Implementado | Toggle PT/EN no widget, `locale` no payload, prompt por idioma e cache chaveado por `productId + locale` |
| 2º fluxo n8n com `Schedule Trigger` | Implementado | `n8n/flow-schedule.json`, Schedule Trigger/execução imediata → Code (4 produtos) → HTTP → Log; validado no n8n 2.33.3 |

## O que corrigi ou rejeitei

- **`jest.config.ts` → `jest.config.js`**: a config em TypeScript exigia `ts-node`;
  troquei por CommonJS para não adicionar dependência só para isso.
- **Guards nos testes**: o TypeScript estrito (`noUncheckedIndexedAccess`) acusou
  acesso indexado possivelmente `undefined` em `fetch.mock.calls`; ajustei com
  verificações explícitas em vez de afrouxar o tsconfig.
- **Streaming meio implementado (o erro mais sério que corrigi)**: numa primeira
  versão o backend já produzia um `ReadableStream`, mas devolvia **texto cru** e o
  widget continuava chamando `response.json()`. Como o modo ficava atrás de
  `STREAMING_ENABLED=false`, o defeito não aparecia no uso normal — só ao ligar a
  flag, quando a UI passava a mostrar apenas "erro de conexão". Eu tinha aceitado
  a justificativa da IA de que "o streaming está pronto no backend"; na auditoria
  final, ficou claro que meio caminho ligado numa flag é pior do que nada. Corrigi
  fechando o protocolo (NDJSON, `lib/stream-protocol.ts`), consumindo o stream de
  verdade no cliente e negociando o formato pelo `Accept` — o que também evitou
  quebrar o fluxo n8n, que espera JSON. Aprendizado: **feature atrás de flag
  desligada não é feature entregue; ou liga e testa, ou documenta como não feito.**
- **`.env.example` vs `.env`**: o registro do autor informa que, enquanto escrevia
  o exemplo, uma chave real foi colada no `.env.example` **antes de commitar** e
  movida em seguida para o `.env` (ignorado). O histórico confirma que o vazamento
  não chegou ao Git: o
  `.env.example` tem um único commit (`7a5cc69`) e nele o campo já está vazio, e
  `git grep` por padrões de chave em todos os commits não retorna nada. O evento
  transitório não é verificável pelo Git; o que a auditoria confirma é que nenhuma
  chave foi versionada e, por essa evidência, não há revogação exigida.
  (Uma versão anterior deste arquivo dizia que o arquivo "rastreado" chegou a
  conter a chave; era impreciso e foi corrigido após conferir o histórico.)
- **Exatidão dos dados**: ao cruzar o `products.json` com a spec oficial, achei uma
  divergência de acento ("ergonómicas" vs "ergonômicas") e corrigi — o desafio pede
  "usar exatamente estes dados".
- **Cache por idioma**: ao adicionar pt-BR/en, percebi que o cache por `productId`
  devolveria o idioma errado ao trocar; ajustei a chave para `productId + locale`.
- **ESLint não configurado**: numa auditoria final, `npm run lint` caía num prompt
  interativo por falta de config. Adicionei `next/core-web-vitals`; na migração
  final para Next 16/ESLint 9, converti a configuração para `eslint.config.mjs`.
- **Documentação otimista demais**: este arquivo chegou a afirmar que o projeto
  cobria "os cinco diferenciais" na mesma página em que admitia que o streaming
  não estava na UI. Troquei a afirmação genérica por uma tabela com status e
  evidência de cada diferencial, que é conferível.
- **Resposta da API não validada no cliente**: o widget fazia
  `body as EnrichResult` — um `200` fora do contrato quebraria a renderização em
  `.bullets.map`. Passei a validar com type guard (`isEnrichResult`) e a mostrar
  uma mensagem de formato inesperado.
- **Testes que só existiam de um lado**: havia 5 testes de UI e nenhum da API.
  Cobri a rota (validação, cache, idioma, erro do provedor, chave ausente,
  streaming) com o SDK inteiramente mockado. A auditoria com Codex ampliou a
  cobertura para 74 testes, incluindo `Content-Type`, contrato estrito, resposta
  obsoleta, linha final sem `\n`, cancelamento upstream e mutação do cache.
- **Cancelamento incompleto no servidor**: abortar o `fetch` fechava a UI, mas não
  havia ligação explícita com o stream da Anthropic. A auditoria passou a cancelar
  o reader no cliente e chamar `abort()` no stream do provedor quando a resposta
  é abandonada, evitando trabalho e custo órfãos.
- **Erros internos expostos**: mensagens de parse e do provedor podiam atravessar
  a API. Mantive o diagnóstico somente no log do servidor e padronizei a resposta
  pública amigável, com teste que impede vazamento de detalhes.
- **Seletor de idioma no mobile**: a validação manual revelou que título, selo e
  botões PT/EN competiam pela mesma linha. Reorganizei o cabeçalho em duas linhas
  nas telas estreitas, mantive o layout horizontal no desktop e marquei o widget
  com `lang="pt-BR"` ou `lang="en"` para tecnologias assistivas.
- **Exports do n8n incompatíveis com 2.x**: a importação real no n8n 2.33.3
  detectou que faltava o `id` no nível dos workflows. Adicionei IDs estáveis aos
  dois arquivos e um `Execute Workflow Trigger` ao fluxo agendado, mantendo o
  `Schedule Trigger`, para que a execução dos quatro produtos seja reproduzível
  por CLI. Validei o webhook nos ramos 200/400 e o fluxo agendado com 4 respostas 200.
- **Dependências vulneráveis**: `npm audit` identificou vulnerabilidades altas no
  Next 14/PostCSS e em dependências de desenvolvimento. Migrei de forma controlada
  para Next 16.3, PostCSS 8.5.25 e ESLint 9, adaptei o App Router e encerrei a
  auditoria com zero vulnerabilidades, sem usar atualização forçada.

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
- **A IA acerta o difícil e erra a integração**: o parser de JSON parcial (a parte
  "cabeluda" do streaming) saiu bem; o que faltou foi ligar as duas pontas —
  servidor mandando texto, cliente esperando JSON. Aprendi a testar sempre o
  caminho completo, não cada metade isoladamente, e a desconfiar de código atrás
  de flag que ninguém liga.

## Limitações

- Cache em memória, sem TTL nem compartilhamento entre instâncias.
- Sem rate limiting, autenticação ou persistência (fora do escopo do desafio).
- Validação da saída do LLM é de forma, não de veracidade.
- Sem teste de browser end-to-end: o streaming na UI é coberto por testes com
  `ReadableStream` real e por verificação manual com `curl -N`.
- Os exports do n8n foram validados na versão 2.33.3; por usarem schemas internos
  de nós, versões diferentes podem exigir migração de `typeVersion`.

# Growth AI Challenge — Widget de Enriquecimento de Produto com IA

App standalone em Next.js (App Router) que, dado um produto (título, categoria,
descrição), chama um LLM da Anthropic e gera **2–3 bullets de benefícios** e
**3 perguntas frequentes com respostas**. 100% local — sem auth, sem banco, sem deploy.

## Comece aqui

Use **Node.js 22.22.0** para o app e para o n8n. O arquivo `.nvmrc` evita troca
manual de versão:

```bash
# Com nvm (recomendado)
nvm install
nvm use

# Instala exatamente o lockfile
npm ci

# Cria a configuração local; preencha ANTHROPIC_API_KEY no arquivo .env
cp .env.example .env

# Inicia o app
npm run dev
```

Abra **http://localhost:3000**. A chave fica somente no `.env`, que é ignorado
pelo Git. Não é necessário banco, conta, seed ou serviço adicional para testar o app.

### Validação automática

Este comando não consome a API da Anthropic; o SDK é mockado nos testes:

```bash
npm run validate
```

Ele executa, em sequência: **74 testes**, ESLint, TypeScript estrito e build de
produção. Para rodar separadamente: `npm test`, `npm run lint`,
`npm run typecheck` e `npm run build`.

### Roteiro manual de 5 minutos

1. Abra qualquer produto e aguarde benefícios e FAQs surgirem palavra a palavra.
2. Clique em **Regenerar** e confirme que um novo conteúdo é produzido.
3. Alterne entre **PT** e **EN**; somente o conteúdo de IA muda de idioma.
4. Recarregue a página e observe a resposta imediata do cache em memória.
5. No modo mobile, confirme que os botões PT/EN ocupam uma linha própria.

## Visão geral

- **Catálogo** (`/`) lista 4 produtos de `data/products.json`.
- **Página de produto** (`/product/[id]`) mostra os dados crus e o widget de IA.
- **`ProductAIWidget`** (client) faz `POST /api/enrich-product` no mount, com
  estados explícitos (loading / streaming / success / error) e botão **Regenerar**.
- **`/api/enrich-product`** valida o body, consulta um cache em memória, chama o
  LLM via `@anthropic-ai/sdk`, faz parse defensivo do JSON e devolve o resultado
  — em **streaming NDJSON** (default) ou em JSON de uma vez só.

### Stack

- Next.js 16 (App Router) + React 18 + TypeScript em modo estrito (zero `any` no backend).
- Tailwind CSS (visual simples — não é o foco da avaliação).
- LLM: Anthropic via SDK oficial (`anthropic.messages.create` / `.stream`).

### Status dos diferenciais

| Diferencial | Status |
| ----------- | ------ |
| Testes automatizados | Implementado (74 testes de widget, API, protocolo e cache) |
| Tipagem forte no backend | Implementado (`strict` + `noUncheckedIndexedAccess`, zero `any`) |
| Streaming com `ReadableStream` | Implementado ponta a ponta (NDJSON palavra a palavra, server → UI) |
| Suporte a `pt-BR` e `en` | Implementado (toggle + cache por idioma) |
| 2º fluxo n8n com `Schedule Trigger` | Implementado (`n8n/flow-schedule.json`) |

Limitações conhecidas estão listadas no fim deste arquivo.

Variáveis de ambiente (ver `.env.example`):

| Variável            | Default                     | Descrição                                                        |
| ------------------- | --------------------------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | —                           | Chave da Anthropic (obrigatória).                                  |
| `LLM_MODEL`         | `claude-haiku-4-5-20251001` | Modelo do LLM (trocável por sonnet/opus).                          |
| `STREAMING_ENABLED` | `true`                      | Kill switch do streaming: `false` faz a rota sempre responder JSON. |

> O streaming só é usado quando o cliente pede `Accept: application/x-ndjson`
> (o widget pede; o n8n e um `curl` comum, não). Consumidores que esperam JSON
> continuam recebendo JSON, sem configuração extra.

### Como conferir cada requisito manualmente

Com `npm run dev` no ar:

| O quê | Como |
| ----- | ---- |
| Catálogo | `http://localhost:3000` — 4 produtos |
| Páginas de produto | `/product/001` … `/product/004` |
| Produto inexistente | `/product/999` → página "Produto não encontrado" (404) |
| Geração + streaming | abra um produto: benefícios e respostas aparecem palavra a palavra |
| Regeneração | botão **Regenerar** — o conteúdo muda (cache invalidado antes) |
| Cache | recarregue a página: a 2ª carga é instantânea (JSON do cache) |
| Idioma | toggle **PT/EN** no cabeçalho do widget |
| Método errado | `curl -i http://localhost:3000/api/enrich-product` → `405` |
| Payload inválido | `curl -X POST .../api/enrich-product -H 'Content-Type: application/json' -d '{"productId":"001"}'` → `400` |
| Sem chave | `ANTHROPIC_API_KEY= npm run dev` → o widget mostra a mensagem de erro |

## Testar o n8n

Mantenha o app rodando em `localhost:3000`. Em outro terminal, use os dois
comandos abaixo; eles fixam o n8n em **2.33.3**, importam os fluxos e guardam os
dados numa pasta local isolada (`.n8n-local`, ignorada pelo Git):

```bash
nvm use
npm run n8n:import
npm run n8n
```

Na primeira execução, o `npx` baixa o n8n e pode levar alguns minutos. Nas
próximas execuções ele reutiliza o download local.

Abra **http://localhost:5678**. No primeiro acesso, o n8n pode solicitar a criação
de um usuário local; isso não exige conta no n8n Cloud.

### Fluxo principal

Abra **Growth AI - Enriquecimento de Produto**, clique em **Execute Workflow** e
dispare a URL de teste mostrada no nó Webhook:

```bash
curl -X POST http://localhost:5678/webhook-test/produto \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "001",
    "productTitle": "Tênis Running Pro X200",
    "productDescription": "Tênis de corrida com solado de borracha carbono, cabedal em mesh respirável, amortecimento EVA duplo e drop de 8mm. Indicado para treinos de longa distância em asfalto.",
    "category": "Calçados Esportivos"
  }'
```

O retorno deve ter `status: "sucesso"`, 2–3 `bullets` e exatamente 3 `faqs`.
Envie `{}` para a mesma URL para confirmar o ramo alternativo com HTTP 400 tratado.

```text
Webhook → HTTP /api/enrich-product → IF statusCode == 200
                                      ├─ sucesso → Log Sucesso
                                      └─ falha   → Tratar Erro
```

### Fluxo agendado

Abra **Growth AI - Enriquecimento Agendado (todos os produtos)** e clique em
**Execute Workflow**. O fluxo processa os quatro produtos em sequência; o último
nó deve mostrar quatro itens com `statusCode: 200`. O `Schedule Trigger` está
configurado para 30 minutos e o gatilho `Executar Agora` permite o teste imediato.

Os dois fluxos foram importados e executados de ponta a ponta no n8n 2.33.3. O
principal passou nos ramos 200 e 400; o agendado concluiu os quatro produtos com
status `success`.

> Alternativa com Docker: a imagem `n8nio/n8n:2.33.3` também foi validada. O
> caminho com Node 22 acima é o mais simples para avaliar este repositório.

## Como eu integraria isso em produção (VTEX IO)

- Criaria um app `vendor.product-ai-widget`: `manifest.json` declara versão, dependências e os builders `react`, `store` e `node`.
- Em `react/`, o widget vira um componente registrado como bloco em `store/interfaces.json` e incluído no template `store.product` do tema.
- O bloco usa `useProduct()` de `vtex.product-context` para obter ID, nome, descrição e categoria; props ficam como fallback configurável.
- Em `node/`, um service expõe a rota interna de enriquecimento; as policies do `manifest.json` limitam somente os hosts e recursos necessários.
- A chave do LLM fica em app settings/secret do workspace e é lida apenas pelo service, nunca pelo app React ou pelo bundle do navegador.
- O `Map` vira VBase/Redis com TTL e chave por produto+idioma; logs estruturados, métricas de latência/cache/erro e tracing cobrem a observabilidade.
- Depois de validar em workspace de desenvolvimento, publicaria com VTEX Toolbelt, promoveria a versão estável e instalaria o app nas contas desejadas.

## Decisões técnicas e por quê

- **App Router (Next 16).** A rota de API (`app/api/.../route.ts`) e as páginas
  Server/Client convivem no mesmo projeto; o widget é o único client component.
- **Cache em memória + invalidação no regenerate.** Um `Map` em escopo de módulo
  guarda uma cópia do resultado por `productId + locale`. Sem `regenerate`, serve
  do cache (rápido);
  com `regenerate`, o cache é invalidado **antes** de gerar — caso contrário o
  botão "Regenerar" devolveria sempre o mesmo conteúdo.
- **Parse defensivo do JSON do LLM.** Removemos eventuais cercas ```` ```json ````,
  recortamos do primeiro `{` ao último `}` e validamos a forma (bullets 2–3,
  faqs == 3) com type guards. JSON inválido vira `EnrichError` → HTTP 500.
- **Tipos compartilhados.** `lib/types.ts` define os contratos usados por front e
  back (`EnrichRequest`, `EnrichResult`, `Faq`, `ApiError`), evitando divergência.
- **Escolha do modelo.** Default `claude-haiku-4-5` (rápido e barato) via env
  `LLM_MODEL`; trocável sem alterar código. `temperature` mais alta no
  `regenerate` para garantir variação real do conteúdo.
- **Multi-idioma (pt-BR / en).** O widget detecta `navigator.language` no mount e
  oferece um toggle **PT/EN**; o `locale` vai no corpo da requisição e o prompt
  instrui o idioma de saída. O **cache é chaveado por `productId + locale`** —
  sem isso, trocar de idioma devolveria o conteúdo cacheado no idioma errado.
- **Streaming real via NDJSON (ligado por padrão).** No cache miss a rota devolve
  um `ReadableStream` com **NDJSON** — uma linha por evento:

  ```
  {"type":"bullet","index":0,"value":"..."}
  {"type":"faq","index":0,"value":{"question":"...","answer":"..."}}
  {"type":"done","result":{"bullets":[...],"faqs":[...]}}
  ```

  Escolhi NDJSON em vez de SSE porque é trivial de produzir num `ReadableStream`
  do Next e de consumir no browser (`split("\n")`), sem o overhead de `event:`/
  `data:` nem o `EventSource` (que não faz `POST`).

  O formato é **negociado pelo header `Accept`**: só quem pede
  `application/x-ndjson` recebe stream. Foi assim que evitei quebrar os
  consumidores não-browser — o fluxo n8n e um `curl` comum continuam recebendo o
  JSON completo, sem parâmetro extra no corpo nem variável de ambiente diferente.

  O servidor **reparseia o JSON parcial do modelo a cada delta**
  (`lib/stream-protocol.ts`) e emite cada bullet/FAQ assim que ele fecha — não é
  um JSON pronto fatiado artificialmente: o conteúdo chega enquanto o modelo
  ainda está escrevendo. O evento `done` carrega o resultado completo já
  validado, que é o que vai para o cache e para o estado final tipado da UI.

  No cliente, o `ProductAIWidget` decide pelo `Content-Type`: `application/x-ndjson`
  → lê `response.body` com `ReadableStreamDefaultReader` + `TextDecoder`,
  processando linha a linha e guardando chunks incompletos; qualquer outro →
  `response.json()`. Por isso **os dois modos funcionam**, e um cache hit (que
  sempre responde JSON) também. Erros: antes do primeiro byte viram HTTP 4xx/5xx
  normais; depois, viram um evento `{"type":"error"}` — em ambos os casos a UI
  mostra a mesma mensagem amigável com botão de repetir.

  Para ver o stream cru:

  ```bash
  npm run dev
  # noutro terminal (o Accept é o que liga o stream):
  curl -N -X POST http://localhost:3000/api/enrich-product \
    -H "Content-Type: application/json" \
    -H "Accept: application/x-ndjson" \
    -d '{"productId":"001","productTitle":"Tênis Running Pro X200","productDescription":"Tênis de corrida com amortecimento EVA duplo.","category":"Calçados Esportivos"}'
  ```

## Limitações conhecidas

- **Cache é um `Map` em memória, sem TTL nem limite de tamanho.** Some a cada
  restart/cold start e não é compartilhado entre instâncias. Em produção seria
  Redis/VBase (ver a seção VTEX acima).
- **Sem persistência e sem rate limiting.** A rota é aberta: qualquer cliente
  pode disparar gerações e, portanto, custo de LLM. Num ambiente real entraria
  rate limit por IP/sessão e autenticação.
- **A qualidade do conteúdo depende do modelo.** Há validação de *forma*
  (2–3 bullets, exatamente 3 FAQs, tipos), não de *veracidade* — o prompt pede
  para não inventar especificações, mas isso não é garantia formal.
- **Uma resposta inválida do LLM vira erro, sem retry.** Não há reprocessamento
  automático nem fallback para outro modelo; o usuário clica em "Tentar novamente".
- **O idioma é escolhido no cliente** (`navigator.language` + toggle). Não há
  rotas `/pt-BR` e `/en` nem i18n de rota — só o conteúdo do widget é traduzido;
  o resto da página está em português.
- **`n8n/*.json` depende da versão do n8n.** Os dois arquivos foram importados e
  executados no n8n 2.33.3; outra versão pode pedir ajuste de `typeVersion`.
- **A verificação do streaming no navegador foi feita via testes automatizados**
  (com `ReadableStream` real) **e via cliente HTTP contra dev e produção**; não há
  teste de browser end-to-end (Playwright/Cypress) no projeto.

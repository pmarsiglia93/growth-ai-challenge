# Growth AI Challenge — Widget de Enriquecimento de Produto com IA

App standalone em Next.js (App Router) que, dado um produto (título, categoria,
descrição), chama um LLM da Anthropic e gera **2–3 bullets de benefícios** e
**3 perguntas frequentes com respostas**. 100% local — sem auth, sem banco, sem deploy.

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

## Pré-requisitos

- Node.js 20.9+ (app testado em Node 20.20) e npm.
- Uma chave de API da Anthropic (`ANTHROPIC_API_KEY`).
- Para o n8n: Docker (recomendado) ou Node.js 22 para executar a versão 2.33.3.

## Como rodar local

```bash
# 1. Instalar exatamente as dependências do lockfile
npm ci

# 2. Criar o .env a partir do exemplo e preencher a chave
cp .env.example .env
#   edite .env e defina ANTHROPIC_API_KEY=sk-ant-...

# 3. Subir em desenvolvimento
npm run dev

# 4. Abrir no navegador
#   http://localhost:3000
```

Variáveis de ambiente (ver `.env.example`):

| Variável            | Default                     | Descrição                                                        |
| ------------------- | --------------------------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | —                           | Chave da Anthropic (obrigatória).                                  |
| `LLM_MODEL`         | `claude-haiku-4-5-20251001` | Modelo do LLM (trocável por sonnet/opus).                          |
| `STREAMING_ENABLED` | `true`                      | Kill switch do streaming: `false` faz a rota sempre responder JSON. |

> O streaming só é usado quando o cliente pede `Accept: application/x-ndjson`
> (o widget pede; o n8n e um `curl` comum, não). Consumidores que esperam JSON
> continuam recebendo JSON, sem configuração extra.

### Testes, lint, tipagem e build

```bash
npm test          # Jest + Testing Library (74 testes, nenhuma chamada real de API)
npm run lint      # ESLint (next/core-web-vitals)
npm run typecheck # tsc --noEmit
npm run build     # build de produção (Webpack, estável no ambiente do case)
```

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

## Como rodar e importar o fluxo n8n

O arquivo `n8n/flow.json` representa o fluxo:

```
Webhook (POST /webhook/produto)
  → HTTP Request (POST http://localhost:3000/api/enrich-product)
      → IF (statusCode == 200)
          ├─ true  → Set "Log Sucesso"  (loga a resposta)
          └─ false → Set "Tratar Erro"  (loga statusCode + mensagem de falha)
```

O nó HTTP usa **Continue On Fail** (`onError: continueRegularOutput`) + `neverError`,
então erros 4xx/5xx da API não derrubam o fluxo: caem no ramo `false` do IF.

### Validação e ressalva de versão

Na auditoria final, os dois arquivos foram importados e executados no **n8n 2.33.3**
oficial via Docker. O fluxo principal passou no ramo de sucesso (resposta real da
Anthropic) e no ramo de erro HTTP 400. O fluxo agendado processou os quatro produtos,
com quatro respostas HTTP 200, e chegou ao nó `Log por Produto` com status `success`.

Os workflows possuem IDs estáveis para importação por CLI. O fluxo agendado também
tem o gatilho `Executar Agora`, além do `Schedule Trigger`, para permitir um teste
imediato e reproduzível sem esperar os 30 minutos. Como o schema interno do n8n muda
entre versões, use a versão 2.33.3 indicada abaixo.

### Passo a passo

1. **Suba o app** (noutro terminal): `npm run dev` (ou `npm start` após `npm run build`).
   Garanta que `http://localhost:3000/api/enrich-product` responde.
2. **Suba o n8n 2.33.3** e abra `http://localhost:5678`:

   ```bash
   # Opção recomendada no Linux: usa o Node da imagem e alcança o app em localhost:3000
   docker run --rm --name growth-ai-n8n --network host \
     -v growth-ai-n8n:/home/node/.n8n \
     n8nio/n8n:2.33.3

   # Alternativa sem Docker (requer Node.js 22)
   npx --yes n8n@2.33.3
   ```

3. **Importe o fluxo**: menu (⋯) → **Import from File** → selecione `n8n/flow.json`.
4. **Valide os nós**: abra cada nó e confirme — em especial o **IF** (`statusCode == 200`)
   e o **HTTP Request** (URL, método POST e o JSON do body). Reconecte qualquer
   conexão que não tenha vindo na importação.
5. **Ative/execute**: clique em **Execute Workflow** (ou ative o webhook em produção).
   Copie a **Test URL** do nó Webhook.
6. **Dispare um teste** (noutro terminal):

   ```bash
   curl -X POST http://localhost:5678/webhook-test/produto \
     -H "Content-Type: application/json" \
     -d '{
       "productId": "001",
       "productTitle": "Tênis Running Pro X200",
       "productDescription": "Tênis de corrida com amortecimento EVA duplo.",
       "category": "Calçados Esportivos"
     }'
   ```

   > A URL exata (`/webhook/produto` vs `/webhook-test/produto`) aparece no próprio
   > nó Webhook — use a que o n8n mostrar.
7. **Confira a execução** na aba *Executions*: o ramo Sucesso deve conter `bullets`
   e `faqs`; force um erro (ex.: app desligado) para ver o ramo de falha tratado.
8. **Reexporte** se ajustar algo: **Download** / *Export* → salve por cima de `n8n/flow.json`.

### Segundo fluxo (opcional) — agendado, processa os 4 produtos

`n8n/flow-schedule.json` é um **diferencial**: um **Schedule Trigger** que, a cada
X minutos (default 30), dispara o enriquecimento dos 4 produtos em sequência.

```
Schedule Trigger (a cada 30 min) ou Executar Agora
  → Code "Lista de Produtos" (emite os 4 produtos como itens)
      → HTTP Request (roda 1x por produto, batchSize 1) → Set "Log por Produto"
```

Importe da mesma forma (`Import from File` → `n8n/flow-schedule.json`). Ajuste o
intervalo no nó **Schedule Trigger** e clique em **Execute Workflow** para testar
agora (não precisa esperar o agendamento). O app Next precisa estar rodando. Para
reproduzir exatamente a validação por CLI, importe o arquivo e execute:

```bash
npx --yes n8n@2.33.3 execute --id=growth-ai-scheduled-enrichment --rawOutput
```

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

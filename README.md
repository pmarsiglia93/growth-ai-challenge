# Growth AI Challenge — Widget de Enriquecimento de Produto com IA

App standalone em Next.js (App Router) que, dado um produto (título, categoria,
descrição), chama um LLM da Anthropic e gera **2–3 bullets de benefícios** e
**3 perguntas frequentes com respostas**. 100% local — sem auth, sem banco, sem deploy.

## Visão geral

- **Catálogo** (`/`) lista 4 produtos de `data/products.json`.
- **Página de produto** (`/product/[id]`) mostra os dados crus e o widget de IA.
- **`ProductAIWidget`** (client) faz `POST /api/enrich-product` no mount, com
  estados explícitos (loading / success / error) e botão **Regenerar**.
- **`/api/enrich-product`** valida o body, consulta um cache em memória, chama o
  LLM via `@anthropic-ai/sdk`, faz parse defensivo do JSON e devolve o resultado.

### Stack

- Next.js 14 (App Router) + React 18 + TypeScript em modo estrito (zero `any` no backend).
- Tailwind CSS (visual simples — não é o foco da avaliação).
- LLM: Anthropic via SDK oficial (`anthropic.messages.create`).

## Pré-requisitos

- Node.js 18+ (testado em Node 20) e npm.
- Uma chave de API da Anthropic (`ANTHROPIC_API_KEY`).

## Como rodar local

```bash
# 1. Instalar dependências
npm install

# 2. Criar o .env a partir do exemplo e preencher a chave
cp .env.example .env
#   edite .env e defina ANTHROPIC_API_KEY=sk-ant-...

# 3. Subir em desenvolvimento
npm run dev

# 4. Abrir no navegador
#   http://localhost:3000
```

Variáveis de ambiente (ver `.env.example`):

| Variável            | Default                        | Descrição                                  |
| ------------------- | ------------------------------ | ------------------------------------------ |
| `ANTHROPIC_API_KEY` | —                              | Chave da Anthropic (obrigatória).          |
| `LLM_MODEL`         | `claude-haiku-4-5-20251001`    | Modelo do LLM (trocável por sonnet/opus).  |
| `STREAMING_ENABLED` | `false`                        | Reservado para o modo streaming opcional.  |

### Testes

```bash
npm test
```

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

### Honestidade sobre o schema

O schema interno dos nós do n8n **muda entre versões** (campos, `typeVersion`,
formato de `conditions`). O `flow.json` aqui foi escrito para uma versão recente
do n8n e pode precisar de pequenos ajustes na sua instalação. Trate-o como um
ponto de partida e valide na UI. Se algum nó importar "quebrado", remonte-o pela
interface (a lógica é simples) e reexporte por cima.

### Passo a passo

1. **Suba o app** (noutro terminal): `npm run dev` (ou `npm start` após `npm run build`).
   Garanta que `http://localhost:3000/api/enrich-product` responde.
2. **Suba o n8n**: `npx n8n` e abra `http://localhost:5678`.
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

## Como eu integraria isso em produção (VTEX IO)

Em produção na **VTEX IO**, o widget viraria um app próprio (`vendor.product-ai-widget`):

- **Front (`react/`)**: o `ProductAIWidget` vira um bloco React do app. Declaro o
  bloco em `store/interfaces.json` (`"product-ai-widget": { "component": "ProductAIWidget" }`)
  e plugo em `store.product` via `blocks.json` do tema. >>PAULO REVISA: ajustar nome
  do vendor e ponto exato de injeção no theme/IO conforme sua experiência real<<
- **Contexto de produto**: em vez de receber props da página, o componente lê o
  contexto do tema com `useProduct()` (`vtex.product-context`), pegando `productId`,
  `productName`, `description` e `categories` — sem passar dados manualmente.
- **Backend de enrich**: a lógica de `lib/enrich.ts` roda num **serviço Node do
  próprio app** (`node/`, service VTEX IO) exposto como rota; o front chama via
  `vtex.io` runtime. Alternativa: um **middleware/serviço externo** que o app
  consome. >>PAULO REVISA: escolher serviço node/ do app vs. middleware externo
  conforme o cenário de latência/escala que você já enfrentou<<
- **Cache**: o `Map` em memória vira VBase ou um cache do próprio IO por `productId`.
- **Chave do LLM**: nunca no front. Fica como **secret/app settings da VTEX**
  (`manifest.json` → `settingsSchema`, lida no service via `ctx.vtex` /
  `process.env`), nunca exposta no bundle do navegador. >>PAULO REVISA<<

## Decisões técnicas e por quê

- **App Router (Next 14).** A rota de API (`app/api/.../route.ts`) e as páginas
  Server/Client convivem no mesmo projeto; o widget é o único client component.
- **Cache em memória + invalidação no regenerate.** Um `Map` em escopo de módulo
  guarda o resultado por `productId`. Sem `regenerate`, serve do cache (rápido);
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

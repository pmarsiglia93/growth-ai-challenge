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

> _A ser detalhado na etapa do fluxo n8n._

## Como eu integraria isso em produção (VTEX IO)

> _A ser detalhado na etapa de produção._

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

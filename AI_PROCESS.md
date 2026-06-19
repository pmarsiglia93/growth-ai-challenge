# Processo de uso de IA

> Este documento foi rascunhado a partir do que de fato aconteceu durante a
> construção do projeto. As seções de experiência pessoal (especialmente
> "Aprendizados") estão marcadas com `>>PAULO REVISA<<` para você confirmar,
> cortar ou reescrever na sua própria voz — a avaliação valoriza honestidade.

## Ferramentas de IA usadas

_Pergunta-guia: quais ferramentas, para quê, e em que parte do fluxo?_

- **Claude Code** (CLI da Anthropic, modelo Claude) como par de programação,
  conduzindo o projeto de forma incremental, etapa a etapa.
- Uso principal: scaffold do Next.js, geração dos componentes/rotas, escrita dos
  testes e da documentação, sempre com revisão e aprovação a cada commit.
- >>PAULO REVISA: cite aqui outras ferramentas que você realmente usou (ex.: Copilot,
  ChatGPT, etc.) e remova esta linha se não houver<<

## Técnicas de prompt utilizadas

_Pergunta-guia: como você guiou a IA para obter bom resultado?_

- **Especificação detalhada antecipada**: um prompt inicial extenso definindo
  stack, estrutura de arquivos, contratos de tipos, comportamento esperado e o
  plano de execução em commits pequenos.
- **Trabalho incremental com checkpoint humano**: "mostre o plano antes de gerar
  muito código" e aprovação explícita a cada etapa antes de seguir.
- **Pedido de sinalização de decisões técnicas** e de perguntar em vez de adivinhar
  quando algo estivesse ambíguo.
- **Priorizar entrega** sobre perfeição (soluções simples e corretas).
- >>PAULO REVISA: ajuste conforme as técnicas que VOCÊ considera que aplicou<<

## Gerado pela IA vs. escrito/revisado à mão

_Pergunta-guia: o que veio pronto da IA e o que você escreveu/ajustou?_

- **Gerado pela IA**: a maior parte do código (scaffold, `lib/`, rota da API,
  `ProductAIWidget`, testes) e a documentação (README, este arquivo).
- **Revisado/dirigido por mim**: o escopo de cada etapa, as decisões técnicas
  aprovadas, e a verificação de que cada commit fazia sentido antes de prosseguir.
- >>PAULO REVISA: seja específico sobre os trechos que você releu/editou à mão<<

## O que corrigi ou rejeitei

_Pergunta-guia: onde a IA errou ou onde você discordou e mudou de rumo?_

- Ajustes reais que surgiram durante a construção:
  - `jest.config.ts` exigia `ts-node`; trocado por `jest.config.js` (CommonJS)
    para não adicionar dependência extra.
  - Os testes precisaram de guards por causa do `noUncheckedIndexedAccess` do
    TypeScript estrito (acesso indexado a `fetch.mock.calls`).
- >>PAULO REVISA: acrescente decisões/correções suas (ex.: prompt do LLM, modelo
  escolhido, algo que você pediu para refazer)<<

## Aprendizados

_Pergunta-guia: o que você tira dessa experiência sobre construir com IA?_

- >>PAULO REVISA: esta seção é a sua voz. Possíveis ganchos do que vivemos aqui:
  o valor de commits pequenos para revisar a IA; a importância de tipos
  compartilhados e parse defensivo ao integrar um LLM; e o cuidado com schema de
  ferramentas (n8n) e segredos (chave do LLM). Reescreva com o que foi real para você.<<

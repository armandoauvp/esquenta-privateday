# Operação do evento

Roteiro para o dia do esquenta. Endereços e comandos em [deploy.md](deploy.md); o que ainda falta em [plano.md](plano.md).

**Data e horário:** _a definir (ver plano, item 2.4)._ A cota diária da Cloudflare zera às **21:00 de Brasília** (00:00 UTC).

## Uma semana antes

- [ ] Importar a planilha mais recente do Guru com `--substituir` (reembolsos saem) e conferir o total: `python tools/importar-ingressos.py <planilha> --substituir --chave-admin <ADMIN_CHAVE>`.
- [ ] Cortesias, convidados e equipe com `--adicionar`.
- [ ] Ensaio na sala `teste` com a equipe (`?sala=teste`): entrar, chat, ingresso, música na fila, sincronia em 2 aparelhos, papo privado, organização.
- [ ] Os três e-mails da organização entram com Google e ganham o selo (depende do `GOOGLE_CLIENT_ID`).

## No dia, antes de abrir

- [ ] **Congelar deploys do servidor** (com a automação 5.2: `EVENTO_AO_VIVO=1`). Deploy reinicia a sala.
- [ ] Reimportar a planilha (vendas de última hora).
- [ ] `GET /saude` responde `ok`; `GET /admin/estado?sala=principal` mostra a lista de ingressos.
- [ ] Abrir a pista em um computador e um celular; conferir o carimbo `build` no rodapé do modal do avatar.
- [ ] Deixar aberta a página de métricas: Cloudflare → Workers & Pages → `esquenta-pista` → Métricas.

## Durante

- **Moderação** pela própria pista, com o selo de Organização: "Pular agora" no player, ✕ na fila, lixeira no chat, "Remover" em **Na pista agora** (30 min).
- **Regras automáticas** (não precisa intervir): música da fila toca no máximo 10 min; pausa do DJ por mais de 10 s passa a vez; DJ fora da tela por 45 s perde a mesa; música de quem saiu some da fila; vídeo indisponível é pulado.
- **Acompanhar** `GET /admin/estado?sala=principal` (com `Authorization: Bearer <ADMIN_CHAVE>`): conexões, pessoas, fila, música atual.
- **Cota**: 500 pessoas por 3 h usam ~25–40% das 100 mil requisições do dia. Se as métricas passarem de 80%, a cota zera às 21:00; até lá, pedir à equipe que evite rajadas de reações.

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Faixa "Conectando à pista…" para todo mundo | Abrir `/saude`. Se não responder: status da Cloudflare; se a cota estourou, ela volta às 21:00. A pista continua tocando a playlist da casa para quem já está dentro |
| Música travada para todos | Organização usa "Pular agora" |
| Alguém atrapalhando | Organização remove em "Na pista agora" (sai por 30 min, mensagens e músicas junto) |
| Comprador diz que o e-mail não é aceito | Conferir se é o e-mail da compra; se for cortesia, `--adicionar` e a pessoa tenta de novo |
| Uma pessoa sem som | Botão "Ativar som" (autoplay com som é bloqueado pelo navegador) |

## Depois

- [ ] Exportar a curadoria "Essa vai pra festa!" e o histórico: `GET /admin/exportar?sala=principal` com `Authorization: Bearer <ADMIN_CHAVE>` (JSON com votos por vídeo e todas as músicas tocadas).
- [ ] Anotar no [historico.md](historico.md): público máximo, consumo de cota, incidentes.
- [ ] Liberar os deploys de novo (`EVENTO_AO_VIVO=0`).

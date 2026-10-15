# Servidor da pista (Cloudflare)

Worker + Durable Object `Pista` com WebSocket com hibernação, no plano gratuito da Cloudflare. Uma sala guarda tudo do evento: presença, chat, fila, player, votos, contagem, papos privados, reações, ranking, ingressos e organização. O servidor é o dono da música; o app só pede e desenha. Visão completa em [docs/arquitetura.md](../docs/arquitetura.md).

```
src/index.ts   Worker: roteia /pista (WebSocket), /onde, /saude e /admin/* para a sala
src/pista.ts   Durable Object: a sala (estado, regras do evento, alarmes, difusão agrupada)
src/regras.ts  validação de tudo que vem do navegador + censura
src/google.ts  conferência do ID token do "Entrar com Google"
teste/fluxo.mjs  protocolo de ponta a ponta com robôs (46 conferências; --lento testa ausência)
teste/carga.mjs  N robôs andando, conversando e reagindo
```

## Rodar local

```bash
npm install
# .dev.vars (não versionado):
#   SEGREDO=<texto aleatório>
#   ADMIN_CHAVE=<texto aleatório>
#   ADMINS=email1@auvp.com.br,email2@auvp.com.br
npm run dev                          # http://127.0.0.1:8787
node teste/fluxo.mjs                 # protocolo inteiro, sala nova a cada rodada
node teste/carga.mjs --n 500         # carga
```

App contra o servidor local: sirva a raiz do repositório (`python -m http.server 5173`) e abra `http://localhost:5173/?servidor=local&sala=teste`.

## Publicar

Ver [docs/deploy.md](../docs/deploy.md): `npx wrangler login`, `npx wrangler deploy` e os secrets `SEGREDO`, `ADMIN_CHAVE` e `ADMINS`. Endereço atual: `https://esquenta-pista.esquenta-pista-servidor.workers.dev`.

## Rotas

| Rota | O quê |
|---|---|
| `GET /pista?sala=principal` (WebSocket) | a sala; `teste` e `carga-*` para ensaios |
| `GET /saude` | `ok` |
| `GET /onde?sala=` | data center onde a sala roda |
| `POST /admin/ingressos?sala=` | importa hashes `{hashes, manuais, remover, substituir}` (usado por `tools/importar-ingressos.py`) |
| `GET /admin/estado?sala=` | conexões, pessoas, fila, música atual, ingressos na lista |
| `POST /admin/org?sala=` | dá o selo de organização a um `{id}` (reserva do login com Google) |

`/admin/*` exige `Authorization: Bearer <ADMIN_CHAVE>`.

## Protocolo (JSON por WebSocket)

Mensagens com `req` recebem `{t:'ok', req, ...}` ou `{t:'erro', req, motivo, texto}`.

| Navegador → sala | Campos | Observação |
|---|---|---|
| `ola` | `id?, token?, perfil, x, y, away, ingresso?` | primeira mensagem; id+token mantêm a identidade |
| `hora` | `c` | relógio estilo NTP; resposta `{t:'hora', c, s}` |
| `mover` | `x, y` | % da pista; Área VIP só com ingresso |
| `perfil` | `perfil: {name, color, avatarConfig, dance}` | validado |
| `ausente` | `v` | aba escondida |
| `chat` | `text` | até 300 caracteres; censurado no servidor |
| `fila` / `sairFila` | `videoId, title` / `id` | só com ingresso; 3 por pessoa; resposta `{posicao, entraAgora}` |
| `pular`, `passarVez`, `cancelar` | | votação; DJ passa a vez (cancelável por ele) |
| `festa` | | "Essa vai pra festa!" na música atual |
| `playback` | `state, time` | só do DJ (ou organização) |
| `fim`, `erroVideo` | `chave` | fim do vídeo / vídeo que não toca |
| `reacao` | `emoji` | sai da posição do avatar |
| `papo`, `aceitar`, `recusar` | `com` | pedido de papo privado |
| `dm` | `para, text` | só com papo aceito; até 500 caracteres |
| `ingresso` | `hash` | SHA-256 do e-mail com sal |
| `ranking` | | `{djs, musicas}`, cache de 1 min |
| `org` / `orgSair` | `credential` | ID token do Google |
| `admPular`, `admRemoverFila`, `admApagarChat`, `admExpulsar` | `id` / `uid` | só organização |

| Sala → navegador | Quando |
|---|---|
| `bemvindo` | na entrada: `id, token, agora, eu, users, chat, fila, player, festa, dms, papos` |
| `tick` | até 4×/s com o que mudou: `pos, tudo, saiu, reset, chat, chatApagado, fila, player, festa, rx` |
| `eu` | ingresso ou selo mudou |
| `dm`, `papo` | só para os dois participantes |
| `outraAba` / `removido` | antes de fechar com 4000 (mesma identidade em outra aba) / 4003 (organização removeu) |

O texto `ping` é respondido `pong` pelo runtime, sem acordar a sala e sem custo. Outros fechamentos: `4001` sem sinal por 90 s, `4008` mensagens demais.

## Resultado dos testes (15/10/2026)

Sala em Miami (MIA). Não existe Durable Object na América do Sul; `locationHint: 'sam'` mandou a sala para Nova Jersey, então a sala nasce onde a Cloudflare escolher a partir do primeiro acesso.

| 500 robôs | local | Cloudflare (2 processos × 250) |
|---|---|---|
| conectados / quedas | 500 / 0 | 500 / 0 |
| todos veem todos | sim | sim |
| propagação de um passo p50 / p95 / p99 | 165 / 308 / 329 ms | 303 / 421 / 449 ms |
| ping p50 | 2 ms | 148 ms |
| mensagens recebidas pela sala | 76/s | 77/s |

Os robôs andam a cada ~10 s, reagem a cada ~20 s e escrevem a cada ~60 s — bem mais que gente de verdade. A propagação inclui a janela proposital de até 250 ms do agrupamento. O fluxo completo (`teste/fluxo.mjs`, 46 conferências + 5 de ausência) passou local e na Cloudflare.

## Custo no plano gratuito

Mensagens recebidas contam 20:1 contra 100 mil requisições/dia; enviadas e pings são grátis. No ritmo dos robôs, 3 h de evento com 500 pessoas dão ≈ 41 mil requisições e ≈ 1.400 GB-s (limite 13.000). Gente real manda bem menos.

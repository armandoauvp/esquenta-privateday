# Servidor da pista (Cloudflare)

Worker + Durable Object `Pista` com WebSocket com hibernação. Substitui o Firestore na
presença e nas posições (etapa 1 da migração). Plano gratuito da Cloudflare.

## Rodar local

```bash
npm install
echo SEGREDO=qualquer-coisa-longa > .dev.vars
npm run dev                  # http://127.0.0.1:8787
npm run carga                # 500 robôs contra o servidor local
```

## Publicar

```bash
npx wrangler login           # uma vez, abre o navegador
npx wrangler deploy
npx wrangler secret put SEGREDO
node teste/carga.mjs --url wss://esquenta-pista.<conta>.workers.dev/pista?sala=carga
```

## Protocolo (JSON por WebSocket em `/pista?sala=principal|teste|carga`)

Cliente → servidor:
- `{t:'ola', cid?, token?, perfil?, x?, y?}`: primeira mensagem. `cid`+`token` de uma visita anterior mantêm a identidade; token inválido gera `cid` novo.
- `{t:'mover', x, y}`: posição em % (0–100).
- `{t:'perfil', perfil:{nome, cor, avatar, dance}}`: validado no servidor (nome até 24, cor `#rrggbb`, avatar só chaves/valores curtos, passinho da lista).
- `{t:'ausente', v}`: aba escondida.
- `{t:'hora', c}`: troca de relógio estilo NTP.
- texto `ping`: respondido `pong` pelo runtime, sem acordar o objeto.

Servidor → cliente:
- `{t:'bemvindo', cid, token, agora, pista:[pessoa]}`
- `{t:'pista', agora, pos:[[cid,x,y]], tudo:[pessoa], saiu:[cid]}`: diferenças agrupadas, no máximo 4×/s.
- `{t:'hora', c, s}`

Fechamentos: `4000` aberto em outra aba, `4001` sem sinal (90 s), `4008` mensagens demais.

## Resultado do teste de carga (15/10/2026)

Sala em Miami (MIA). Não existe Durable Object na América do Sul; `locationHint: 'sam'` mandou
a sala para Nova Jersey, então a sala nasce onde a Cloudflare escolher a partir do primeiro
acesso (`/onde?sala=` mostra o data center).

| | local | Cloudflare (2 processos × 250) |
|---|---|---|
| conectados | 500/500 | 500/500 |
| quedas | 0 | 0 |
| todos veem todos | sim | sim (500) |
| propagação de um passo p50 / p95 / p99 | 163 / 298 / 321 ms | 300 / 420 / 440 ms |
| ping p50 | 1 ms | 148 ms |

A propagação inclui a janela proposital de até 250 ms do agrupamento.

## Custo no plano gratuito

Mensagens recebidas contam 20:1 contra 100 mil requisições/dia; enviadas e pings são grátis.
No teste local, 500 pessoas andando a cada ~10 s geraram ~56 mensagens/s: 3 h de evento ≈
30 mil requisições e ≈ 1.400 GB-s (limite 13.000).

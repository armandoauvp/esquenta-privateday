# Arquitetura

## Visão geral

O app (`index.html`) conversa por **WebSocket** com uma sala no servidor (`servidor/`, Cloudflare Workers + Durable Objects). A sala é **uma só instância**, com estado em memória e no SQLite do próprio Durable Object: presença, chat, fila, player, votos, papos privados, ingressos e organização. Ela recebe as ações de cada navegador, decide e espalha o resultado.

```
┌─────────────┐   WebSocket (JSON)   ┌──────────────┐   ┌───────────────────────────┐
│  Navegador  │◄────────────────────►│ Worker       │──►│ Durable Object "Pista"    │
│ (index.html)│   ping/pong grátis   │ (roteia sala)│   │ sala principal · SQLite   │
└─────────────┘                      └──────────────┘   │ alarmes · hibernação      │
      ▲                                                 └───────────────────────────┘
      │ postMessage (IFrame API)
      ▼
┌───────────┐
│  YouTube  │ (player embed + playlist da casa)
└───────────┘
```

**Por que não mais Firebase:** no Firestore cada escrita é lida por todos, então o custo cresce com o quadrado do público. No plano gratuito, a cota de leituras aguentava ~14 pessoas por 1 h. Na sala, o servidor junta as mudanças e manda um pacote por vez; mensagens enviadas pelo servidor não contam na cota. O teste com 500 robôs passou sem quedas (ver [`servidor/README.md`](../servidor/README.md)).

**O servidor é o dono da música.** Contagem regressiva, limite de 10 min, fim de vídeo, DJ ausente, faxina da fila e votação acontecem na sala. Não existe mais "líder" entre navegadores, nem transações, nem medo de um aparelho com o relógio errado apagar a fila de todo mundo.

## Identidade

No primeiro `ola`, o servidor cria um `id` (16 hex) e devolve um `token` (HMAC-SHA256 do id com o secret `SEGREDO`). O app guarda os dois (`store`: localStorage + cookie) e se reapresenta com eles a cada conexão. Token inválido gera um id novo. Recarregar a página, cair a rede ou trocar de aba não muda a identidade.

## Protocolo

Mensagens JSON; as que levam `req` recebem `{t:'ok', req, ...}` ou `{t:'erro', req, motivo, texto}`. No app, `pedir(msg)` devolve uma Promise que rejeita com o texto do servidor (ex.: "Calma! Espere um instante") ou, sem resposta, em 8 s; `enviar(msg)` é fire-and-forget (posição, reação, playback).

Navegador → sala: `ola`, `hora` (relógio), `mover`, `perfil`, `ausente`, `chat`, `fila`, `sairFila`, `pular`, `passarVez`, `cancelar`, `festa`, `playback`, `fim`, `erroVideo`, `reacao`, `papo`, `aceitar`, `recusar`, `dm`, `ingresso`, `ranking`, `org`, `orgSair`, `admPular`, `admRemoverFila`, `admApagarChat`, `admExpulsar`.

Sala → navegador:
- `bemvindo`: o estado inteiro na entrada (pessoas, chat, fila, player, festa, papos e mensagens privadas da pessoa, `eu: {isVIP, isOrg}`);
- `tick`: o que mudou, agrupado no máximo 4×/s (`pos`, `tudo`, `saiu`, `reset`, `chat`, `chatApagado`, `fila`, `player`, `festa`, `rx`);
- direto, só para quem interessa: `ok`/`erro`, `hora`, `eu`, `dm`, `papo`, `outraAba`, `removido`.

O texto `ping` é respondido `pong` pelo próprio runtime da Cloudflare, sem acordar a sala nem gastar cota. O app pinga a cada 25 s; sem pong até o ping seguinte, derruba a conexão e reconecta.

## Estado da sala

### Pessoas (`tick.pos/tudo/saiu`)
```js
{ id, name, color, avatarConfig, dance, isVIP, isOrg, x, y, away, awaySince }
```
Vivem no anexo de cada WebSocket (`serializeAttachment`), que sobrevive à hibernação. Quem fecha a aba fica **20 s** na pista (`GRACE_SAIDA_MS`): recarregar não tira ninguém da mesa nem da fila. `isVIP` e `isOrg` vêm do servidor, nunca do navegador.

**Online ≠ presente.** Estar na lista mantém o avatar na pista; para DJ e fila vale `presente`: conectado (ou recarregando) **e** sem `away` há mais de `AWAY_GRACE_MS` (45 s). `away` sai na hora pelo `visibilitychange`. A mesma regra existe no app (`isPresent`), só para desenhar ("fora da tela", limiar de pular).

### Chat
```js
{ id, uid, name, isVIP, isOrg, color, text, timestamp }
```
Últimas 50 em memória, 300 no SQLite. A censura de palavrões acontece no servidor (`censurar`).

### Fila
```js
{ id, videoId, title, addedByName, addedByUid, addedByVIP: true, timestamp, duracao }
```
Só quem tem ingresso entra, no máximo 3 músicas por pessoa, sem repetir a que toca ou já está na fila. O dono tira a própria; a organização tira qualquer uma.

### Player
```js
{
  state:     { videoId, startedAt, addedByUid, addedByName, title },  // videoId null = playlist da casa
  skipVotes: { videoId, votes: { id: true } },
  countdown: { endsAt, reason, por, cancelavel } | null,
  playback:  { videoId, state: 'playing'|'paused', time, at } | null
}
```
Todos os horários são do relógio do servidor; o app compara com `agora()`.

### SQLite da sala
`estado` (fila e player), `chat`, `dm`, `papos`, `historico` (ranking), `festa` (curadoria "Essa vai pra festa!", **não apagar**), `ingressos` (hashes, com marca `manual`), `vip` (id → hash do ingresso), `org` (id → e-mail), `banidos`.

## Música

### Troca (`avancar`)
Só avança se a sala ainda estiver na música que motivou a troca (chave `videoId_startedAt`); avisos atrasados viram no-op. Pega a primeira música da fila cujo dono está presente (quem acabou de enviar tem prioridade), descarta as de quem saiu, grava o histórico e zera votos e contagem.

### Contagem regressiva
`contagem(reason)` grava `countdown` com `endsAt = agora + 5 s` e marca um **alarme** do Durable Object para esse instante; ao disparar, a sala executa a troca. Só uma contagem por vez. Disparos: música entrando com a pista no vídeo da casa, votação, DJ passando a vez (cancelável por ele), DJ ausente, vídeo indisponível e organização.

### Ronda (`verificar`)
Roda em cada alarme (a cada 15 s enquanto há gente ou música, e nos instantes exatos de contagem, corte e saída) e depois de eventos relevantes:
- contagem vencida → troca;
- 10 min de música → troca direta (a mesa mostra "corte em m:ss" no último minuto). A duração que o app mede ao entrar na fila (`duracao`) só serve para avisar quem colocou um vídeo mais longo; o corte vale para todos;
- música do DJ pausada: aos 5 s de pausa abre a contagem (`tipo: 'pausa'`), aos 10 s troca (`PAUSA_MAX_MS`). Republicar "pausado" não reinicia o prazo (`pausadoDesde`); voltar a tocar cancela a contagem;
- DJ fora da pista depois de 30 s de música → contagem "Fulano saiu da pista";
- fim de vídeo informado → o do DJ troca na hora; o de outros, se em 8 s o DJ não confirmar e houver 2 avisos ou o DJ estiver fora;
- vídeo com erro (`onError` da IFrame API) → contagem "Vídeo indisponível" (DJ na hora; outros com 2 avisos ou DJ fora, em 6 s);
- votos de pular no limiar → contagem;
- pista no vídeo da casa e alguém presente na fila → contagem "Música de Fulano entrando";
- faxina: música de quem está fora há mais de 45 s sai da fila;
- pessoas que fecharam a aba há mais de 20 s saem da pista.

Alarmes sobrevivem à hibernação; os `setTimeout` (só o agrupamento de 250 ms) não precisam.

### Votação de pular
Limiar `max(2, min(10, floor(ouvintes/2)+1))`, onde ouvintes são os presentes menos o DJ. Um voto por pessoa por música; qualquer pessoa vota, com ou sem ingresso. O mínimo de 2 existe porque, com pouca gente, um voto sozinho tirava a música de qualquer DJ na hora; o próprio DJ passa a vez com `passarVez`.

### Sincronia: todo mundo no mesmo segundo
- **Relógio**: o app mede o desvio contra a sala (troca `hora`, estilo NTP: desvio ≈ `s − (c + chegada)/2`, fica a amostra de menor ida e volta; 3 amostras ao conectar e 1 a cada 5 min). Tudo que é compartilhado usa `agora()`.
- **Vídeo da casa**: relógio comum, `posicaoFallback() = ((agora() − FALLBACK_EPOCA)/1000) % duracaoFallback`, sem mensagem nenhuma. A duração é **fixa** no código: o YouTube informa primeiro o valor arredondado e depois o fracionado, e com ~200 voltas desde a época 0,5 s vira ~100 s de diferença.
- **Música do DJ**: o DJ publica `playback` a cada 5 s e na hora em que pausa, retoma ou arrasta a barra (só estados reais, com posição fresca). Os demais comparam a cada 3 s e saltam (`seekTo`) acima de `SINCRONIA_TOLERANCIA_S` (2 s), com 8 s entre saltos e mira 0,4 s à frente. Sem publicação recente, a referência é o `startedAt`. A pausa do DJ vale até ele retomar.
- **Só o DJ mexe no player**: `controls=1` só no iframe dele; os demais e o vídeo da casa têm `controls=0&disablekb=1&fs=0` e a camada de bloqueio do overlay.

### Iframe estável + overlay
`renderPlayer()` recria o `<iframe id="ytFrame">` **apenas** quando a chave da música muda (`lastPlayerKey`). Votos, contagem e avisos ficam em `#playerOverlay` (`updatePlayerOverlay()`), então o vídeo nunca reinicia por causa de um voto. Um watchdog local recria só o próprio iframe se o player ficar 45 s sem dar sinal (ou 20 s sem responder ao handshake).

### Playlist da casa (fallback)
Sem música do DJ, cada app monta o `FALLBACK_VIDEO` em loop (`loop=1&playlist=<id>`), **mutado** (autoplay com som é barrado sem interação) e com botão "Ativar som", já no trecho comum. Trocou o vídeo? Atualize `FALLBACK_VIDEO` e `duracaoFallback` juntos.

## Papos privados
`papo` cria o pedido (`{id: idA_idB ordenados, a, b, participants, requestedBy, status: 'pending'}`); `aceitar`/`recusar` mudam o status. `dm` só passa com o papo aceito. A sala manda pedidos e mensagens **só** aos dois participantes, e o `bemvindo` traz os da própria pessoa. Ninguém mais lê, nem a organização.

## Reações
Uma por pessoa a cada 1,5 s, saindo da posição do avatar (a sala usa a posição dela, não a enviada). No máximo 12 por pacote; no auge, o excesso aparece só para quem tocou. Reações VIP exigem ingresso **e** estar na Área VIP.

## Ingresso
O app manda o SHA-256 do e-mail (`INGRESSO_SAL` + e-mail normalizado). Se o hash estiver na lista, a sala grava o vínculo `vip(id, hash)`. O vínculo só vale enquanto o hash continuar na lista: reembolso importado com `--substituir` tira o VIP na próxima conexão. O hash também fica no navegador (`localProfile.ingresso`) e vai no `ola`, refazendo o vínculo noutra identidade. Nunca vai para o perfil público.

## Organização
"Entrar com Google" (Google Identity Services, carregado só ao abrir o diálogo) devolve um ID token. A sala confere assinatura (chaves públicas do Google), emissor, `aud = GOOGLE_CLIENT_ID`, validade e `email_verified`, e só aceita e-mails do secret `ADMINS`. O selo fica gravado na identidade (`org`). Poderes: `admPular`, `admRemoverFila`, `admApagarChat`, `admExpulsar` (fecha a conexão, bloqueia a identidade por 30 min, apaga as mensagens e tira as músicas da pessoa).

## Desempenho
- **Na sala**: as mudanças são agrupadas num `tick` a cada 250 ms, serializado uma vez e mandado a todos. Movimento vai só como `[id, x, y]`; o perfil inteiro só quando muda. Ranking em cache por 1 min.
- **No app**: o `tick` só atualiza o estado e chama `agendar(...)`; um único quadro (`requestAnimationFrame`, no máximo a cada 250 ms) desenha. Cada render compara uma assinatura e não mexe no DOM se nada visível mudou. Pista e chat por diferença (`avataresNaPista`, `nosDoChat`).
- **Cota**: cada mensagem recebida conta 1/20 de requisição. Posição sai agrupada (clique e teclado), perfil e ausência só quando mudam, reação no máximo a cada 1,5 s.

## Pista WebGL
**Tamanho do canvas**: o canvas recebe o tamanho por CSS (`width/height: 100%`) e a resolução por `setSize(w, h, false)`. Deixar o Three escrever o estilo com o `pixelRatio` embutido fazia o canvas ficar com o **dobro** do container em tela retina/celular — a cena era desenhada fora da área visível.

**Enquadramento**: a cada resize a câmera recua o suficiente para a cena caber na proporção atual e mira mais alto quanto mais baixa e larga for a pista.

**Feixes**: o ápice de cada cone nasce no centro do globo, então o feixe fica preso à esfera em qualquer ângulo; a cor apaga ao longo do comprimento e, com blending aditivo, a ponta se dissolve.

O Three.js entra por **import dinâmico** dentro de `try/catch` — sem CDN ou sem WebGL, o globo 2D (`#cssDiscoBall`) permanece. A cena roda a 30 fps, só depois da cortina, pausa fora da tela e com modal aberto, e pulsa numa batida de 118 BPM quando há música audível.

## Pré-carregamento dos bonecos
A cortina (`#loadingScreen`) só sobe quando `assetsProntos` resolve: imagens da marca, o avatar de quem chegou, **todas** as miniaturas das opções e as fontes. Cada imagem resolve no `onload` e no `onerror`, com teto de 20 s. Isso só funciona porque as miniaturas usam **`CARD_BASE`**, uma config fixa: o conjunto de URLs é finito e constante. As opções são montadas **uma vez** (`montarOpcoes`) e a escolha só alterna classes (`marcarSelecao`). Toda imagem do DiceBear passa pela fila `carregarImagem` (6 downloads simultâneos, até 3 tentativas), porque a API devolve 429 com ~80 pedidos de uma vez.

## Títulos via oEmbed
`fetchTitle(videoId)` consulta `noembed.com` e guarda em `titleCache`. O título vai junto no pedido da fila e é propagado para o player e o histórico.

## Segurança
- **Validação no servidor** (`servidor/src/regras.ts`): nome até 24 caracteres sem `<>`, cor `#rrggbb`, avatar só com chaves e valores curtos, passinho e emoji de listas fixas, posição limitada a 0–100, textos com teto, Área VIP só com ingresso. Limite de ritmo por pessoa e por tipo de ação; mais de 90 mensagens em 5 s derruba a conexão.
- **Escape no app**: `esc()` antes de qualquer `innerHTML`; `safeId()`, `safeColor()` e `safeVideoId()` para o que vai em `onclick`, `style` e `src`.
- **Ingresso**: prova "conhece o e-mail de um comprador", não "é dono do e-mail" (decisão de produto: sem link de confirmação). A lista não vaza: só hashes, conferidos um por vez.
- **Admin**: `/admin/*` exige `Authorization: Bearer <ADMIN_CHAVE>`. O selo de Organização exige um ID token do Google válido para um e-mail de `ADMINS`.
- **Silenciar** é local (localStorage `esquentaMuted`).

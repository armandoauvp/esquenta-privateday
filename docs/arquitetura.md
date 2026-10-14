# Arquitetura

## Visão geral

O app é um **cliente Firebase puro**: não existe backend próprio. Cada navegador aberto é um "peer" que lê e escreve no Firestore; a UI de todos converge pelos listeners `onSnapshot`. A autenticação é **anônima** (cada visitante ganha um `uid` efêmero).

```
┌───────────┐   onSnapshot    ┌────────────────────┐
│ Navegador │◄───────────────►│ Firestore          │
│ (index.html)│  setDoc/addDoc │ artifacts/{appId}/ │
└───────────┘                 │   public/data/…    │
      ▲                       └────────────────────┘
      │ postMessage (IFrame API)
      ▼
┌───────────┐
│  YouTube  │ (player embed + playlist da casa)
└───────────┘
```

## Modelo de dados (Firestore)

Caminho base: `artifacts/{appId}/public/data/…` — `appId = auvp-privateday`.

### `users/{uid}` — presença e perfil
```js
{
  name, color, isVIP,
  avatarConfig: { top, accessories, facialHair, clothing, eyes,
                  eyebrows, mouth, skinColor, hairColor, clothesColor },
  x, y,          // posição na pista (0–100 %)
  lastUpdate,    // heartbeat; considerado online se < 120 s
  away,          // true = aba escondida/minimizada (visibilitychange)
  awaySince      // Date.now() de quando saiu da tela (0 se está na tela)
}
```
Heartbeat a cada 30 s (`startHeartbeat`). Usuários sem update há 2 min somem da pista.

**Online ≠ presente.** Continuar na lista da pista (`activeUsers`, < 120 s) mantém o avatar visível; para as regras de DJ e fila vale o conceito mais estrito de `isPresent(u)`: heartbeat com menos de `PRESENCE_STALE_MS` (75 s) **e** não estar `away` há mais de `AWAY_GRACE_MS` (45 s). `away` é publicado na hora pelo `visibilitychange` (e por `pagehide`, em melhor esforço) — quem fecha a aba sem conseguir escrever cai pelo heartbeat velho.

### `chat/{autoId}` — chat público
```js
{ uid, name, isVIP, color, text, timestamp }
```
O cliente exibe as últimas 50, ordenadas por `timestamp`. Mensagens de dias anteriores mostram `dd/mm · hh:mm`.

### `dm/{autoId}` — chat privado
```js
{ convId, from, fromName, fromColor, to, participants: [from, to], text, timestamp }
```
`convId` = os dois uids ordenados e unidos por `_` (ex.: `abc_xyz`). O cliente assina só as próprias conversas (`where('participants', 'array-contains', meuUid)`) e as regras do Firestore recusam a leitura de conversa alheia. Mensagens antigas, sem `participants`, ficam ilegíveis para todos. Não-lidas: badge no avatar, contadas a partir do início da sessão (`dmSessionStart`) ou da última leitura (`dmReadAt`).

### `dmThreads/{convId}` — solicitações de chat privado
```js
{ a, b, participants: [a, b], requestedBy, requestedByName, status, timestamp } // status: 'pending' | 'accepted' | 'declined'
```
Mesma regra do `dm`: só os dois participantes leem; aceitar/recusar altera apenas `status`.
O papo só é liberado (envio de mensagens e abertura do painel) com `status === 'accepted'`. O destinatário vê um card Aceitar/Recusar; quem pediu recebe aviso na transição `pending → accepted`. Recusar permite novo pedido depois (o doc é sobrescrito).

### `queue/{autoId}` — fila do DJ
```js
{ videoId, title, addedByName, addedByUid, addedByVIP, timestamp }
```
`addedByVIP` viaja no próprio doc para que a checagem na hora de subir para a mesa não dependa de a pessoa estar online. Docs antigos sem o campo continuam valendo; `addedByVIP === false` é descartado pela faxina da fila e na promoção.

### `player/state` — vídeo atual (documento único)
```js
{ videoId, startedAt, addedByName, addedByUid }   // videoId null = playlist da casa
```

### `player/skipVotes` — votação de pular (documento único)
```js
{ videoId, votes: { uid: true, ... } }
```
Só vale se `videoId` bater com o vídeo atual. Resetado (`votes:{}`) a cada troca de música.

### `player/countdown` — contagem regressiva (documento único)
```js
{ endsAt, reason }   // endsAt null = sem contagem
```

### `player/playback` — sincronia de reprodução (documento único)
```js
{ videoId, state, time, at }   // state: 'playing' | 'paused'; time em segundos; at = Date.now() do DJ
```
Publicado **pelo cliente do DJ** a cada 5 s e imediatamente ao pausar/retomar — mas **só com info fresca** (< 8 s): aba em segundo plano congela o player do DJ, e publicar posição congelada com carimbo novo prendia os seguidores num loop de seek. Os demais clientes comparam a posição esperada (`time + (agora - at)`) com o próprio player a cada 3 s e corrigem com `seekTo` quando o drift passa de 6 s, com **cooldown de 12 s entre seeks** (a posição local fica defasada logo após um seek e dispararia outro em sequência). Pausa/retomada são replicadas. Quem entra no meio da música já monta o iframe com `start=<segundos decorridos>`. **Ninguém tem a barra de progresso — nem o DJ** (`controls=0&disablekb=1` para todos): avançar/retroceder é proibido; o DJ pausa/retoma tocando no vídeo (sem camada de bloqueio para ele), os demais têm a camada bloqueando cliques. Se o doc fica >15 s sem atualização (DJ saiu), ninguém força nada.

### `ingressos/{hash}` — lista de compradores
```js
{ importadoEm } // id = SHA-256("auvp-privateday:" + email.trim().toLowerCase())
```
Importada do CSV da plataforma de vendas por `tools/importar-ingressos.py` (conta de serviço; o e-mail em texto nunca sai do computador de quem importa). As regras só permitem `get`, ou seja, conferir um hash por vez, nunca listar a coleção.

### `vip/{uid}` — ingresso confirmado
```js
{ ingresso, em } // ingresso = o hash conferido
```
Criado pelo app quando o e-mail digitado confere com a lista; as regras só aceitam a criação se `ingressos/{ingresso}` existir. Só o dono lê. É o que as regras exigem para `isVIP` em `users` e `chat` e para criar item na `queue`. O hash não vai para o perfil público: se fosse, bastaria copiá-lo para virar VIP sem saber o e-mail.

### `partyVotes/{videoId_uid}` — curadoria "Essa vai pra festa!"
```js
{ videoId, uid, name, addedByName, timestamp }
```
ID composto garante 1 voto por usuário por vídeo. **Esta coleção é o produto da curadoria — não apagar.** Para exportar: leia a coleção e agrupe por `videoId` (título recuperável via oEmbed).

### `history/{autoId}` — músicas que já tocaram
```js
{ videoId, byUid, byName, title, timestamp }
```
Gravado por `setNowPlaying()` toda vez que um vídeo assume a mesa. Base do placar "DJs da noite" no ranking.

### `reactions/{autoId}` — reações flutuantes
```js
{ uid, emoji, x, y, timestamp }
```
Cada cliente anima apenas reações recentes (< 6 s) ainda não vistas (`docChanges` + `Set` local). O cliente líder apaga docs com mais de 2 min para a coleção não crescer.

## Mecanismos de sincronização

### Iframe estável + overlay
`renderPlayer()` recria o `<iframe id="ytFrame">` **apenas** quando `videoId`/`startedAt` mudam (chave `lastPlayerKey`). Tudo que muda com frequência (votos, contagem, avisos) é HTML dentro de `#playerOverlay`, atualizado por `updatePlayerOverlay()` — assim o vídeo nunca reinicia por causa de um voto.

### Eleição de líder
Ações automáticas que só podem acontecer **uma vez** (pular aos 10 min, avançar ao fim do vídeo, faxina da fila) são executadas apenas pelo cliente cujo `uid` é o **menor** entre os **presentes** (`isLeader()`). Os demais ignoram o gatilho. Se o líder cair, o próximo menor uid assume naturalmente no snapshot seguinte de `users`. A eleição prioriza quem está com a aba na frente porque o navegador estrangula os timers de abas escondidas — um líder minimizado não rodaria as verificações a tempo; se ninguém estiver presente, cai de volta na lista completa de online.

### Presença ativa (o DJ precisa ficar na pista)
A pista depende de quem está de fato olhando: o evento de fim de vídeo só chega a quem tem o player vivo, então um DJ que fecha o app deixaria a música presa até o limite de 10 min. Três mecanismos, todos apoiados em `isPresent()`:

1. **DJ ausente** — timer de 5 s no líder: se o dono de `player/state` não está presente (respeitando 30 s de respiro após o início da música, para o doc de presença chegar), dispara a contagem "🎧 Fulano saiu da pista — próxima música!". Quem perdeu a vez com a aba escondida recebe um toast ao voltar (`perdiAVezAusente`).
2. **Faxina da fila** — timer de 10 s no líder: apaga itens de `queue` cujo dono não está presente, com respiro de 45 s a partir do `timestamp` do item (protege quem acabou de entrar na fila e ainda não bateu heartbeat). `playNextVideo()` repete a checagem antes de promover a próxima música, caso a faxina ainda não tenha rodado.
3. **Vídeo que não toca** — `onError` da IFrame API (removido, privado, embed bloqueado, região) dispara a troca: o DJ resolve na hora, o líder assume em 6 s. Sem isso o vídeo nunca "termina" e a pista fica na tela preta.

Complementarmente, um watchdog **local** (10 s) recria só o próprio iframe quando o player para de reportar `infoDelivery` por 45 s sem estar pausado nem terminado — travamento costuma atingir um cliente só, e `renderPlayer()` recalcula o `start` pelo `startedAt`, devolvendo a pessoa ao ponto certo. Cooldown de 90 s entre resgates.

### Contagem regressiva
`startCountdown(reason, action)`:
1. Grava `player/countdown = {endsAt: agora+5s, reason}` → todos os clientes exibem o overlay (ticker local de 200 ms atualiza o número).
2. O cliente **que iniciou** agenda `setTimeout(5s)` → executa `action()` (trocar música) e limpa o doc.

Disparada em dois casos: música adicionada enquanto a playlist da casa toca, e votação de pular atingindo o limiar.

### Votação de pular
- Limiar: `max(1, min(10, floor(onlines/2)+1))` — 50%+1 dos presentes, com teto de 10 votos.
- Voto: merge no mapa `votes` de `player/skipVotes`; 1 voto por uid, sem retirar voto.
- Quem registra o voto que cruza o limiar inicia a contagem.

### Limite de 10 minutos
Timer local de 5 s em cada cliente compara `Date.now() - startedAt` com `MAX_PLAY_MS`. Ao estourar, o líder chama `playNextVideo()`.

### Fim de vídeo
No `load` do iframe o app envia `{event:'listening'}` (handshake da IFrame API) — repetido algumas vezes, pois uma tentativa única pode se perder. O fim chega como `onStateChange` (`info === 0`) **ou** `infoDelivery` (`info.playerState === 0`), dependendo do player; ambos são tratados, com guarda de disparo único por `(videoId, startedAt)`. O avanço tem três camadas: o **DJ** avança na hora (é quem certamente recebeu o próprio evento); se em 4 s nada mudou, o **líder** assume; após 9 s, **qualquer cliente** resolve. A sincronia de reprodução ignora o estado "terminou" (o DJ não publica e os seguidores não corrigem drift) para não brigar com o avanço. `playNextVideo` também descarta docs "fantasma" (a música que acabou de tocar ainda presente na fila por um delete atrasado) e apaga o doc da fila **antes** de escrever o novo estado — assim a música nunca recomeça ao terminar. O vídeo da casa repete sozinho (`loop=1&playlist=<id>`).

### Playlist da casa (fallback)
Sem `videoId` no `player/state`, cada cliente monta o embed do `FALLBACK_VIDEO` (um vídeo só, com as músicas emendadas) em loop (`loop=1&playlist=<id>`), **mutado** (autoplay com som é bloqueado pelos navegadores sem interação) com botão "Ativar som". **Todo mundo ouve o mesmo trecho**, sem nenhuma escrita no Firestore: a posição sai de um relógio comum, `posicaoFallback() = ((Date.now() − FALLBACK_EPOCA) / 1000) % duracaoFallback`. O iframe já nasce com `start=` nesse ponto, e a sincronia (abaixo) corrige o atraso do carregamento. A duração é **fixa** no código: o YouTube informa primeiro o valor arredondado e depois o fracionado, e com ~200 voltas desde a época uma diferença de 0,5 s vira ~100 s entre clientes. Trocou o vídeo? Atualize `FALLBACK_VIDEO` e `duracaoFallback` juntos.

### Sincronia: todo mundo no mesmo segundo
A cada 3 s, cada cliente (menos o DJ) compara a posição do próprio player com a referência e salta (`seekTo`) quando a diferença passa de `SINCRONIA_TOLERANCIA_S` (2 s). A referência é:
- **vídeo da casa**: o relógio comum (considerando a volta do loop);
- **música do DJ**: a posição que o DJ publica em `player/playback`; se a publicação tiver mais de 15 s, o tempo desde `startedAt`.

Entre dois saltos há um intervalo de 8 s, porque logo depois de um `seekTo` a posição local vem defasada e dispararia outro. Um iframe novo zera esse intervalo, então o atraso do carregamento é corrigido assim que o vídeo começa a tocar. O salto mira 0,4 s à frente, que é o tempo que o próprio salto leva. A pausa do DJ continua replicada.

### "Filtro" de áudio com o modal aberto
O YouTube não expõe o áudio do embed ao Web Audio (cross-origin), então o efeito de frequências cortadas é **simulado**: `setVolume(10)` via postMessage + `blur/saturate` no iframe. Reaplicado a cada 1,5 s enquanto o modal está aberto (o player pode não estar pronto na primeira tentativa).

### Pista WebGL
**Tamanho do canvas**: o canvas recebe o tamanho por CSS (`width/height: 100%`) e a resolução por `setSize(w, h, false)`. Deixar o Three escrever o estilo com o `pixelRatio` embutido fazia o canvas ficar com o **dobro** do container em tela retina/celular — a cena era desenhada fora da área visível, o globo aparecia encostado na borda direita e os feixes ficavam cortados. Bug invisível em telas com `devicePixelRatio: 1`, presente em praticamente todo celular.

**Enquadramento**: a cada resize a câmera recua o suficiente para a cena caber na proporção atual (`max` entre a distância que satisfaz a altura e a que satisfaz a largura) e mira mais alto quanto mais baixa e larga for a pista, para o globo não encostar no topo.

**Feixes**: o ápice de cada cone nasce no centro do globo (`cone.position.y = -comprimento/2`), então o feixe fica preso à esfera em qualquer ângulo; a cor vai apagando ao longo do comprimento por gradiente de vértice, e com blending aditivo o preto não soma nada — a ponta se dissolve em vez de terminar num corte reto. Os cones ficam em grupos aninhados (azimute → inclinação) para evitar ambiguidade de ordem de Euler.

O Three.js entra por **import dinâmico** dentro de `try/catch` — se o CDN estiver bloqueado ou não houver WebGL, o globo 2D em CSS (`#cssDiscoBall`) permanece e nada mais é afetado. A cena (globo facetado espelhado, 4 point lights neon orbitando, 4 feixes cônicos aditivos e ~220 partículas) roda em `setAnimationLoop` e pulsa numa batida estimada de 118 BPM quando `glPlaying` é verdadeiro (vídeo tocando ou fallback com som ativado). O canvas fica em `#webglLayer`, atrás dos ladrilhos e dos avatares, com `ResizeObserver` para redimensionar.

### Pré-carregamento dos bonecos
A cortina (`#loadingScreen`) só sobe quando a promessa `assetsProntos` resolve: imagens da marca, o avatar de quem chegou, **todas** as miniaturas das opções e `document.fonts.ready`. Cada imagem resolve tanto no `onload` quanto no `onerror` (uma falha não pode prender ninguém) e há um teto de `ASSETS_TIMEOUT_MS` (20 s) via `Promise.race`. O progresso alimenta a barra da tela de carregamento. `iniciarUI()` monta a UI e é guardada por `uiIniciada` — auth e timeout de segurança podem chamá-la, mas ela roda uma vez só.

Isso só é possível porque as miniaturas usam **`CARD_BASE`**, uma config fixa: cada card mostra a opção desenhada sobre esse boneco neutro, então o conjunto de URLs é finito (uma por opção do catálogo) e constante. Antes, o card era desenhado sobre a config **atual** do usuário — qualquer clique mudava a URL de todos os ~78 cards e recarregava tudo. O custo é que o card não reflete as cores da pessoa; o preview grande (esse sim, com a config real) continua ao lado.

Complementarmente, as opções são montadas **uma vez** (`montarOpcoes`) e a escolha só alterna classes (`marcarSelecao`). Reconstruir o `innerHTML` a cada clique repedia as imagens e zerava o `scrollLeft` das faixas. Por isso o estado de seleção das bolinhas de cor virou a classe `.cfg-dot-on` (antes eram utilitários do Tailwind alternados no template).

### Títulos via oEmbed
`fetchTitle(videoId)` consulta `noembed.com` (proxy oEmbed com CORS liberado) e guarda em `titleCache` (memória). O título é persistido no doc da fila no momento do add e propagado para `player/state` e `history`; consumidores fazem fetch preguiçoso quando falta.

## Segurança

- **Escape de HTML**: `esc()` é aplicado a nomes e mensagens antes de qualquer `innerHTML`.
- **Whitelists**: `dance` e `emoji` vindos de outros usuários são validados contra listas fixas antes de virarem classe CSS ou conteúdo DOM.
- **Moderação**: censura de palavrões no envio (`censor()`); silenciamento por usuário é local (localStorage), sem papel de admin.
- **Formatos validados**: `uid`, cor e `videoId` vindos do Firestore entram em `onclick`, `style` e `src`, onde o `esc()` não protege. Passam por `safeId()`, `safeColor()` e `safeVideoId()`; o `player/state` com `videoId` inválido vira "sem música".
- **Ingresso**: o modelo prova "conhece o e-mail de um comprador", não "é dono do e-mail" (decisão de produto: sem link de confirmação). Quem souber o e-mail de alguém consegue virar VIP. A lista em si não vaza: só hashes, sem listagem.
- **Regras do Firestore** ([`firestore.rules`](../firestore.rules)): auth anônima, cada um escreve só em nome próprio e o chat privado só é legível pelos participantes. Os demais dados continuam públicos para quem está logado, então não guarde nada sensível neles.
- **Consultas enxutas**: chat limitado às 50 últimas (`orderBy + limit`), usuários só os ativos nos últimos 2 min.
- A chave de API do Firebase no HTML **não é segredo** (é um identificador de projeto); a proteção real são as regras do Firestore.

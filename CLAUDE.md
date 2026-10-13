# CLAUDE.md

Guia para trabalhar neste repositório com Claude Code (ou qualquer agente/dev).

## Visão geral

App de página única (**`index.html`**) — pista de dança virtual do esquenta AUVP Private Day. Sem build, sem `package.json`, sem framework: HTML + Tailwind via CDN + um único `<script type="module">` com todo o JavaScript. Documentação em `README.md` e `docs/`.

## Regras do projeto

- **Tudo em um arquivo.** Não crie arquivos JS/CSS separados; mantenha o padrão de arquivo único do `index.html`.
- **`elementor/esquenta-privateday.html` é gerado** por `tools/build-elementor.py` (embute os PNGs em base64 para o app virar um arquivo autossuficiente). Nunca edite esse arquivo à mão — altere o `index.html` e regenere. O script falha alto se os trechos que ele troca mudarem de forma.
- **Idioma:** todo texto visível ao usuário, comentários e commits em **português (pt-BR)**.
- **Estilo visual:** dark (`#050505`), paleta AUVP — laranja `#DB7944`, azul `#0B2A47`, vermelho `#932621`, creme `#FFF7EB` — com neons 80s (rosa `#ff00cc`, ciano `#00ffff`) apenas em detalhes da pista.
- **Identidade:** sempre que usar o globo da marca, use `GLOBO.png`; para o nome "PRIVATE DAY" (ex.: header), use o lettering `LETTERING.png` — ambos na raiz do repo, por caminho relativo.
- **Tailwind para layout, CSS custom só para animações** (bloco `<style>` no `<head>`).
- **Deploy na Vercel** (`vercel.json` + `.vercelignore`): site estático, sem build. Só `index.html` e os PNGs vão para o ar — `docs/`, `tools/`, `elementor/`, `video/` e os `.md` ficam fora.
- **`video/` é um projeto Remotion à parte** (vídeo de fundo do fallback do YouTube, com `package.json` próprio). Não é dependência do app; veja `video/README.md`.
- **Sem dependências novas** sem necessidade real. CDNs atuais: Tailwind, Google Fonts, Firebase 11.x (gstatic), DiceBear v8, YouTube.

## Arquitetura do JS (ordem dentro do `<script type="module">`)

1. Ícones SVG (`Icons`) e injeção nos `<span id="icon-*">`
2. Config do Firebase (`FIREBASE_CONFIG_FALLBACK` — preencher para hospedar fora do ambiente Claude)
3. Catálogos do avatar (`TOPS`, `EYES`, `AURA_COLORS`, …) e `getAvatarUrl()`
4. Constantes da pista (`FALLBACK_PLAYLIST`, `MAX_PLAY_MS`, `COUNTDOWN_MS`, `TICKETS_URL`) e estado global (`currentVideo`, `queue`, `skipVotes`, `countdownState`, `partyVotes`, `dmMessages`, …)
5. Pista (ladrilhos, mesa de DJ), `iniciarUI()`, auth
6. Helpers `pdoc()`/`pcol()` + listeners `onSnapshot` (users, chat, queue, player, partyVotes, dm)
7. Presença (`updatePresence`, heartbeat de 30 s)
8. Renders: `renderUsers`, `renderChat`, `renderQueue`, `renderPlayer`/`updatePlayerOverlay`, `renderDM`, `renderSettingsModal`
9. Lógica de votos/contagem/limite de 10 min/fim de vídeo/duck de áudio
10. Handlers de formulários e do modal

## Padrões importantes (não quebrar)

- **Pista e chat por diferença, nunca `innerHTML` da lista inteira**: `renderUsers` mantém `avataresNaPista` (uid → elemento) e só atualiza `left/top` (é isso que faz o avatar deslizar). O conteúdo só é refeito quando a `assinatura` muda, porque refazer reinicia os passinhos. `renderChat` mantém `nosDoChat` (id → nó), insere só o que é novo e não puxa pro fim quem rolou pra cima (aparece a pílula "↓ Novas mensagens"). Listeners do avatar ficam na casca, que nunca é trocada.
- **Iframe estável**: `renderPlayer()` recria o iframe **só quando o vídeo muda** (`lastPlayerKey`); votos/contagem/avisos são desenhados em `#playerOverlay` por `updatePlayerOverlay()`. Nunca redesenhe o iframe em snapshots de votos/usuários, senão o vídeo reinicia para todo mundo.
- **Líder**: ações automáticas (limite de 10 min, avanço ao fim do vídeo) são executadas apenas pelo cliente com **menor uid** entre os online (`isLeader()`), para evitar escrita duplicada.
- **Contagem regressiva sincronizada**: doc `player/countdown` (`{endsAt, reason}`). Quem inicia a contagem executa a ação no `setTimeout`; os demais apenas exibem o overlay (ticker de 200 ms).
- **Escape de HTML**: todo conteúdo vindo de usuário (nomes, mensagens) passa por `esc()` antes de entrar em `innerHTML`. Valores que vão para `onclick`, `style` ou `src` (uid, cor, videoId) passam por `safeId()`, `safeColor()` e `safeVideoId()`, porque o `esc()` não protege atributo de evento nem CSS.
- **Regras do Firestore versionadas** em `firestore.rules`: mudou o formato de um documento? Ajuste as regras junto e avise no PR que é preciso republicá-las no console.
- **Modo offline**: o app precisa abrir mesmo sem Firebase (`configValida === false` ou falha de auth) — mantenha os guards `if (!currentUser || !db) return;`.
- **Timestamps**: `Date.now()` do cliente (sem serverTimestamp) — comparações toleram pequenos desvios de relógio.
- **Mesa de DJ é só de quem tem ingresso** (`podeSerDJ()`): trava no envio da fila, no formulário e na promoção da música. O ingresso é declarado pela própria pessoa — a trava é de experiência, não de segurança.
- **Canvas do WebGL: tamanho por CSS, resolução por `setSize(w, h, false)`.** Deixar o Three escrever o estilo dobra o canvas em tela retina e joga a cena para fora da área visível.
- **WebGL é progressivo**: o Three.js entra por `import()` dinâmico dentro de try/catch; se falhar (CDN bloqueado, sem GPU), o globo 2D `#cssDiscoBall` permanece. Nunca torne o Three.js um import estático — derrubaria o app inteiro.
- **Coroa VIP é selo de avatar** (`.vip-crown`), nunca ícone ao lado do nome — vale para header, chat e pista.
- **Dados de usuário em animações/classes**: valores como `dance` e `emoji` são validados contra whitelists antes de virarem classe CSS/DOM.
- **Silenciamento é local** (localStorage `esquentaMuted`) e a censura de palavrões acontece **no envio** (`censor()`); não há papel de admin.
- **Perfil persistido no navegador** (`esquentaProfile`): carregado com merge defensivo na inicialização; `saveProfile()` deve ser chamado em toda mutação de `localProfile`. A chave `esquentaPerfilPronto` marca quem já concluiu a personalização — essa pessoa entra direto na pista (`enterParty()` no fim do script), sem o modal.
- **Nunca use `localStorage` direto** — sempre o helper `store.get/set`, que grava em localStorage **e** em cookie. Em navegação privada do iOS e em iframe particionado o localStorage falha, e sem a reserva o visitante refaz o boneco a cada visita.
- **Miniaturas do avatar usam `CARD_BASE` (config fixa), nunca a config atual** — é o que mantém o conjunto de URLs finito e permite pré-carregar tudo antes da entrada. Voltar a desenhar o card sobre `localProfile.avatarConfig` recarrega ~78 imagens a cada clique.
- **Monte as opções uma vez** (`montarOpcoes`) e alterne só a classe de seleção (`marcarSelecao`). Reconstruir `innerHTML` a cada escolha repede imagens e zera o `scrollLeft` das faixas `.cfg-row`.
- **Toda imagem do DiceBear passa pela fila** (`carregarImagem`, no máximo `FILA_LIMITE` = 6 downloads simultâneos, com até 3 tentativas): a API devolve HTTP 429 quando recebe ~80 pedidos de uma vez. Em templates use `imgAvatar(url, attrs)` + `hidratarAvatares(container)` (o card nasce como esqueleto e ganha o `src` quando a fila entrega); em `<img>` fixos use `trocarAvatar(el, url)`. Nunca escreva `<img src="${getAvatarUrl(...)}">` direto.
- **A cortina só sobe com `assetsProntos`** (imagens + fontes), com teto de 20 s. Toda imagem do pré-carregamento resolve no `onerror` também — CDN fora do ar não pode prender ninguém no loading.
- **CSS do modal precisa de `!important` em propriedades de layout** (`.cfg-row`, `.cfg-nav`, `.cfg-sec`): o Tailwind CDN injeta os estilos depois do bloco `<style>` e empata em especificidade, vencendo pela ordem.
- **Carimbo de build**: `<meta name="app-build">` alimenta o rodapé do modal e o console. Atualize-o quando publicar algo que precise ser confirmado em produção (confira o rodapé após o deploy na Vercel para saber se o navegador pegou a versão nova).
- **Layout em colunas a partir do `md`** (768 px): empilhado, o player 16:9 mais a lateral zeravam a altura da pista no tablet. No celular a lateral vira abas Chat/Fila (`#ladoDireito[data-aba]`, `setAbaLateral()`), o player tem teto de `30dvh` e a pista tem `min-h-[140px]`. Mexeu no layout? Confira a altura do `#danceFloor` em 360×640, 390×844, 768×1024, 855×897 e 1440×900.
- **Avisos**: `showToast(msg, link, {acao, erro, ms})`. `msg` é HTML, então escape o que vier de usuário antes de passar. Falha de escrita no Firestore vira `avisoErro('fazer tal coisa')`; nunca use `alert()` nem engula o erro calado.
- **Conexão**: `conectar()` liga listeners e heartbeat uma vez só, inclusive quando a auth chega depois do timeout; `atualizarConexao()` cuida da faixa `#semConexao` e trava chat e fila com o motivo.
- **Online ≠ presente**: `activeUsers` (heartbeat < 120 s) mantém o avatar na pista; as regras de DJ/fila usam `isPresent(u)` — heartbeat < `PRESENCE_STALE_MS` (75 s) **e** sem `away` além de `AWAY_GRACE_MS` (45 s). Quem sai da tela perde a mesa e o lugar na fila; recarregar a página não custa nada.
- **Ações do líder** (faxina da fila, DJ ausente, limite de 10 min, avanço no fim) rodam só no `isLeader()`, que agora elege entre os **presentes** — aba escondida tem timer estrangulado e não serve como líder.

## Firestore (caminho base `artifacts/{appId}/public/data/…`)

| Coleção/Doc | Uso |
|---|---|
| `users/{uid}` | presença + perfil (x, y, avatarConfig, color, isVIP, lastUpdate, away, awaySince) |
| `chat/{auto}` | chat público |
| `dm/{auto}` | chat privado (`convId` = uids ordenados unidos por `_`; `participants: [from, to]` — só os dois leem) |
| `dmThreads/{convId}` | solicitação de papo (`{a, b, participants, requestedBy, status}`) — DM só abre com `status='accepted'` |
| `queue/{auto}` | fila do DJ (`addedByVIP` marca quem tinha ingresso ao entrar na fila) |
| `player/state` | vídeo atual (`videoId`, `startedAt`, `addedByUid`, `addedByName`, `title`) |
| `player/skipVotes` | votos de pular (`{videoId, votes:{uid:true}}`) — resetado a cada troca |
| `player/countdown` | contagem regressiva (`{endsAt, reason}`) |
| `player/playback` | sincronia de reprodução (`{videoId, state, time, at}`) — publicado pelo DJ; os demais seguem |
| `partyVotes/{videoId_uid}` | votos "Essa vai pra festa!" (curadoria — nunca apagar) |
| `history/{auto}` | músicas já tocadas (`videoId`, `byUid`, `byName`, `title`) — base do ranking |
| `reactions/{auto}` | reações flutuantes (`uid`, `emoji`, `x`, `y`, `timestamp`) — o líder apaga as com >2 min |

Campos extras no perfil (`users/{uid}`): `dance` (passinho: `''|spin|jump|shake|moonwalk`).

Detalhes em [docs/arquitetura.md](docs/arquitetura.md).

## Testes / verificação

- Sem suíte de testes. Validação mínima após alterações no JS:
  ```bash
  python3 -c "import re;open('/tmp/app.mjs','w').write(re.search(r'<script type=\"module\">(.*?)</script>', open('index.html').read(), re.S).group(1))" && node --check /tmp/app.mjs
  ```
- Teste visual com Playwright/Chromium quando possível. **Atenção:** no sandbox os CDNs (Tailwind/gstatic) podem estar bloqueados pelo proxy — a página abre sem estilo e sem Firebase; isso não é um bug do app.
- Sempre teste os dois viewports: desktop (~1440px) e mobile (~390px). O layout usa `dvh` e breakpoints `md`/`lg`.

## Git

- Branch de trabalho: a informada na tarefa (atual: `claude/private-day-improvements-0vyiga`).
- Commits em português, no padrão `tipo: descrição` (`feat:`, `fix:`, `docs:`, `config:`).

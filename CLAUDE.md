# CLAUDE.md

Guia para trabalhar neste repositório com Claude Code (ou qualquer agente/dev).

## Visão geral

Pista de dança virtual do esquenta AUVP Private Day, em duas partes:

- **App de página única (`index.html`)**: sem build, sem `package.json`, sem framework. HTML + Tailwind via CDN + um único `<script type="module">` com todo o JavaScript.
- **Servidor da pista (`servidor/`)**: Cloudflare Worker + Durable Object (`Pista`), em TypeScript, com `wrangler`. Uma sala por evento guarda presença, chat, fila, player, votos, papos, ingressos e organização, e conversa com o app por WebSocket.

Documentação em `README.md`, `docs/` e `servidor/README.md`. **Numa sessão nova, comece por [docs/plano.md](docs/plano.md)** (o que falta e o que automatizar); contexto e decisões em [docs/historico.md](docs/historico.md); roteiro do evento em [docs/operacao-evento.md](docs/operacao-evento.md).

## Regras do projeto

- **App em um arquivo.** Não crie arquivos JS/CSS separados para o app; mantenha o padrão de arquivo único do `index.html`. O servidor é à parte (`servidor/src/`: `index.ts` roteia, `pista.ts` é a sala, `regras.ts` valida, `google.ts` confere o login).
- **`elementor/esquenta-privateday.html` é gerado** por `tools/build-elementor.py` (embute os PNGs em base64 para o app virar um arquivo autossuficiente). Nunca edite esse arquivo à mão — altere o `index.html` e regenere. O script falha alto se os trechos que ele troca mudarem de forma.
- **Idioma:** todo texto visível ao usuário, comentários e commits em **português (pt-BR)**.
- **Estilo visual:** dark (`#050505`), paleta AUVP — laranja `#DB7944`, azul `#0B2A47`, vermelho `#932621`, creme `#FFF7EB` — com neons 80s (rosa `#ff00cc`, ciano `#00ffff`) apenas em detalhes da pista.
- **Identidade:** sempre que usar o globo da marca, use `GLOBO.png`; para o nome "PRIVATE DAY" (ex.: header), use o lettering `LETTERING.png` — ambos na raiz do repo, por caminho relativo.
- **Tailwind para layout, CSS custom só para animações** (bloco `<style>` no `<head>`).
- **Deploy**: o app vai para a Vercel (`vercel.json` + `.vercelignore`, site estático, sem build; só `index.html` e os PNGs — `docs/`, `tools/`, `elementor/`, `video/`, `servidor/` e os `.md` ficam fora). O servidor vai para a Cloudflare com `npx wrangler deploy` dentro de `servidor/` (ver `docs/deploy.md`). **Nunca publique o servidor durante o evento**: o deploy reinicia a sala.
- **`video/` é um projeto Remotion à parte** (vídeo de fundo do fallback do YouTube, com `package.json` próprio). Não é dependência do app; veja `video/README.md`.
- **Ícones: Hugeicons, nunca emoji na interface.** Ficam embutidos como SVG no objeto `Icons` (pacote gratuito `@hugeicons/core-free-icons` 4.3.5, MIT; `1em`/`currentColor`). Use `<span data-icone="nome">` no HTML e `${Icons.nome}` nos templates. Precisa de um ícone novo? Copie o SVG do mesmo pacote. Emoji só onde ele **é** o conteúdo (reações da pista). Textos que vêm do servidor (ex.: motivo da contagem) ficam sem ícone; o ícone entra na hora de desenhar.
- **Sem dependências novas** sem necessidade real. CDNs do app: Tailwind, Google Fonts, DiceBear v8, YouTube, Three.js (jsDelivr, opcional) e Google Identity Services (só ao abrir "Sou da organização"). O servidor não tem dependências de runtime.

## Arquitetura do JS (ordem dentro do `<script type="module">`)

1. Ícones SVG (`Icons`) e injeção nos `<span id="icon-*">`
2. Servidor da pista (`SALA_SERVIDOR`, `SALA`, `GOOGLE_CLIENT_ID`) e relógio corrigido (`agora()`)
3. Catálogos do avatar (`TOPS`, `EYES`, `AURA_COLORS`, …) e `getAvatarUrl()`
4. Constantes da pista (`FALLBACK_VIDEO`, `MAX_PLAY_MS`, `TICKETS_URL_BASE`) e estado global (`currentVideo`, `queue`, `skipVotes`, `countdownState`, `festa`, `souOrg`, `dmMessages`, …)
5. Pista (ladrilhos, mesa de DJ), `iniciarUI()`
6. Sala: `abrirSala()`/`caiuSala()` (WebSocket e reconexão), `enviar`/`pedir`, `medirRelogio`, `receber` → `entrouNaSala`, `aplicarTick`, `aplicarPlayer`, `aplicarEu`
7. Agendador de renders (`agendar`), presença (`usuarios`, `isPresent`, `updatePresence`)
8. Renders: `renderUsers`, `renderChat`, `renderQueue`, `renderPlayer`/`updatePlayerOverlay`, `renderDM`, `renderSettingsModal`
9. Votos, contagem (só desenho), fim de vídeo/erro (só aviso ao servidor), sincronia, duck de áudio
10. Handlers de formulários, papos, reações, ranking, organização e do modal; `iniciarUI()` no fim do script

## Padrões importantes (não quebrar)

- **O servidor é o dono da música.** Troca, contagem regressiva, limite de 10 min, fim de vídeo, DJ ausente, votação e faxina da fila acontecem na sala (`avancar`, `contagem`, `verificar` em `pista.ts`), com **alarmes** do Durable Object (sobrevivem à hibernação). O app só pede (`fila`, `pular`, `passarVez`, `cancelar`) e informa (`fim`, `erroVideo`, `playback`). Não reintroduza "líder" nem decisões de troca no navegador. Agendamento longo no servidor é por alarme, nunca por `setTimeout` (a sala hiberna).
- **Tudo que vai para todos sai num `tick`**, agrupado no máximo 4×/s (`FLUSH_MS`), serializado uma vez. Mensagem nova para a pista inteira entra no tick; resposta e coisa privada vão direto ao socket certo.
- **Ticks não desenham: agendam.** `aplicarTick` só atualiza o estado e chama `agendar('users'|'mesa'|'fila'|'overlay'|'chat')`; um quadro único (rAF, no máximo a cada `RENDER_MIN_MS` = 250 ms) desenha. Cada render compara uma assinatura (`assinaturaFila`, `assinaturaMesa`, `assinaturaOverlay`) e não toca no DOM se nada visível mudou. Nunca chame um render pesado direto ao receber mensagem.
- **Cota do servidor (plano gratuito):** cada mensagem **recebida** pela sala conta 1/20 de requisição (100 mil/dia); as enviadas e o ping/pong não contam. Antes de criar uma mensagem nova do app, pense na frequência × público: posição sai agrupada (clique e teclado), perfil e ausência só quando mudam (`perfilEnviado`, `ausenciaEnviada`), reação no máximo a cada 1,5 s, nada de heartbeat (o ping de 25 s é grátis). O servidor tem limite de ritmo por tipo (`ESPERA`) e derruba quem abusa.
- **Pista leve**: animação só de `transform`/`opacity` (ladrilhos: brilho fixo num `::after`, anima só a opacidade); nada de `blur`/`backdrop-filter`/`mix-blend` em elementos que se repetem por avatar; modal aberto pausa a pista (`body.modal-aberto`). WebGL: build minificado, só depois da cortina, 30 fps, `pixelRatio` 1 no celular e 1,5 no resto, pausa fora da tela e com modal; aparelho fraco fica no globo 2D.
- **Pista e chat por diferença, nunca `innerHTML` da lista inteira**: `renderUsers` mantém `avataresNaPista` (uid → elemento) e só atualiza `left/top` (é isso que faz o avatar deslizar). O conteúdo só é refeito quando a `assinatura` muda, porque refazer reinicia os passinhos. `renderChat` mantém `nosDoChat` (id → nó), insere só o que é novo e não puxa pro fim quem rolou pra cima (aparece a pílula "↓ Novas mensagens"). Listeners do avatar ficam na casca, que nunca é trocada.
- **Todo mundo no mesmo segundo**: o vídeo da casa segue um relógio comum (`posicaoFallback()`, sem mensagem) e a música do DJ segue o `player.playback` (ou o `startedAt`). Acima de `SINCRONIA_TOLERANCIA_S`, o player salta. `duracaoFallback` é **fixa**: nunca a substitua pela duração que o player informa, porque o YouTube muda o valor (arredondado → fracionado) e a diferença multiplica pelo número de voltas desde a época.
- **Só o DJ mexe no player**: `controls=1` só no iframe do DJ; os demais e o vídeo da casa têm `controls=0&disablekb=1&fs=0` mais a camada de bloqueio do overlay. O DJ publica `playback` na hora em que pausa, retoma ou salta; a sala só aceita `playback` do DJ (ou da organização).
- **Iframe estável**: `renderPlayer()` recria o iframe **só quando a música muda** (`lastPlayerKey` = `chaveAtual()`); votos/contagem/avisos são desenhados em `#playerOverlay` por `updatePlayerOverlay()`. Nunca redesenhe o iframe em ticks de votos/usuários, senão o vídeo reinicia para todo mundo.
- **Limites da mesa**: música da fila toca no máximo 10 min (`MAX_PLAY_MS`, a playlist da casa não conta); vídeo mais longo ganha aviso antes de entrar (`medirDuracao` usa um iframe invisível e o handler principal de `message` ignora tudo que não vem do `#ytFrame`). Pausa do DJ por mais de 10 s passa a vez (`PAUSA_MAX_MS`, contagem `tipo: 'pausa'` aos 5 s, cancelada quando o DJ volta a tocar; o DJ vê "Voltar a tocar").
- **Votação de pular**: todos votam (com ou sem ingresso), limiar `max(2, …)` igual no app (`skipThreshold`) e no servidor (`limiarPular`): um voto sozinho nunca tira a música de outro DJ. Só o próprio DJ passa a vez sozinho.
- **UTM**: links de saída para os sites da AUVP passam por `comUtm()` (usa as UTMs da visita, guardadas em `esquentaUtm`, ou `UTM_PADRAO`). Link novo para a AUVP no HTML com `href` fixo é reescrito na carga; em template, use `TICKETS_URL`/`comUtm()`.
- **Convite pro ingresso (`#bannerIngresso`)**: banner em forma de ingresso no topo da área do chat, por cima das mensagens mais antigas (nunca sobre a pista, o player ou o campo). Só pra quem não tem ingresso nem é da organização; regras em `BANNER_INGRESSO` (aparece 40 s depois de entrar, fica 30 s, volta a cada 12 min, no máximo 3 vezes; ✕ esconde 24 h em `esquentaBannerFechadoAte`; some depois do evento). Espera a aba estar à vista e nenhum diálogo aberto. Usa `GLOBO.png` e `LETTERING.png` (o `build-elementor.py` conta essas imagens: mexeu, ajuste o `esperado`).
- **Papo no celular confirma antes**: tocar num avatar (`toqueNaTela`) abre o cartão `#papoConfirma` ("Puxar papo" / "Andar pra cá") em vez de pedir na hora; mouse e teclado vão direto. Tocar fora fecha sem andar.
- **Troca condicionada à chave**: `avancar(chave)` na sala só troca se a música ainda for a da chave (`videoId_startedAt`); `fim` e `erroVideo` vão com a chave. Aviso atrasado de uma música anterior vira no-op.
- **Identidade**: id + token (HMAC com o secret `SEGREDO`) guardados no navegador (`esquentaId`, `esquentaToken`, via `store`) e reapresentados no `ola`. Quem fecha a aba fica 20 s na pista (`GRACE_SAIDA_MS`): recarregar não tira ninguém da mesa nem da fila. A mesma identidade em outra aba derruba a conexão antiga (código 4000, aviso "Usar esta").
- **Conexão**: `abrirSala()` uma vez; caiu (`caiuSala`), reconecta com espera crescente. Ping de 25 s sem pong derruba e reconecta. `salaOnline()` vale só depois do `bemvindo`; use-o como guarda de toda ação (`if (!salaOnline()) …`). `atualizarConexao()` cuida da faixa `#semConexao` e trava chat e fila com o motivo. O app precisa abrir mesmo sem servidor: só assiste.
- **Pedidos com resposta**: ação que pode ser recusada usa `pedir(msg)` (Promise; rejeita com `err.texto` do servidor ou por falta de resposta em 8 s) e avisa com `avisoFalha(err, 'fazer tal coisa')`. Fire-and-forget (`enviar`) só para posição, reação, playback, fim e erro de vídeo. Nunca engula o erro calado nem use `alert()`.
- **Protocolo é contrato**: mudou o formato de uma mensagem? Ajuste `servidor/src/pista.ts` **e** o `index.html` juntos, rode `servidor/teste/fluxo.mjs`, publique o servidor antes do app e avise no PR.
- **Validação no servidor** (`regras.ts`): tudo que vem do navegador é limpo lá (nome, cor, avatar, passinho, emoji, posição, textos, Área VIP). A censura de palavrões acontece no servidor (`censurar`). No app, conteúdo de usuário continua passando por `esc()` antes de `innerHTML`, e o que vai para `onclick`, `style` ou `src` (id, cor, videoId) passa por `safeId()`, `safeColor()` e `safeVideoId()`, porque o `esc()` não protege atributo de evento nem CSS.
- **Hora compartilhada = `agora()`**, nunca `Date.now()`: `agora()` é a hora do aparelho mais o desvio medido contra a sala (`medirRelogio`, troca `hora` estilo NTP, 3 amostras ao conectar e 1 a cada 5 min). Vale para tudo que é comparado com dado do servidor (`startedAt`, `endsAt`, `playback.at`, `awaySince`, relógio da playlist da casa). Durações locais (intervalos, throttles, posição do próprio player) seguem `Date.now()`.
- **Ingresso confirmado pelo e-mail da compra.** "Já tenho meu ingresso!" pede o e-mail, calcula `hashEmail()` (SHA-256 com `INGRESSO_SAL`) e manda `{t:'ingresso', hash}`; a sala confere na lista e grava o vínculo. `isVIP` vem **sempre** do servidor (`aplicarEu`). O hash fica só no navegador (`localProfile.ingresso`), vai no `ola` para refazer o vínculo e nunca vai para o perfil público. O vínculo só vale com o hash ainda na lista (reembolso tira o VIP). A lista sobe com `tools/importar-ingressos.py`; sal e normalização precisam ser iguais nos dois lados.
- **Mesa de DJ é só de quem tem ingresso** (`podeSerDJ()`): trava no formulário e na promoção da música; a sala recusa a fila sem vínculo.
- **Organização**: "Sou da organização" → Google Identity Services → a sala confere o ID token (`google.ts`) e o e-mail contra o secret `ADMINS`, e grava o selo (`isOrg`) na identidade. Poderes: `admPular`, `admRemoverFila`, `admApagarChat`, `admExpulsar` (30 min). Botões de organização só aparecem com `souOrg`, mas quem garante é a sala. A organização **não** lê papos privados: DM e pedidos de papo só vão aos dois participantes.
- **Avatares passam por trás do globo**: camadas da pista, de baixo para cima: Área VIP (z 6) → mesa de DJ e avatares (z 7; a mesa vem antes no HTML, então o DJ fica por cima dela) → globo WebGL/2D (z 8) → dica (10) → barra de reações (20). Elemento novo na pista: escolha a camada pensando nessa profundidade.
- **Canvas do WebGL: tamanho por CSS, resolução por `setSize(w, h, false)`.** Deixar o Three escrever o estilo dobra o canvas em tela retina e joga a cena para fora da área visível.
- **WebGL é progressivo**: o Three.js entra por `import()` dinâmico dentro de try/catch; se falhar (CDN bloqueado, sem GPU), o globo 2D `#cssDiscoBall` permanece. Nunca torne o Three.js um import estático — derrubaria o app inteiro.
- **Mesa de DJ = HTML fixo + `renderDJBooth()` por diferença**: a estrutura (`#djBooth`, `.mesa-*`) está no HTML; o render compara uma assinatura e só troca texto, atributo (`data-estado="casa|dj|eu"`, `data-pausado`, `data-ausente`, `data-corte`) e a variável `--p` da barra (`atualizarProgressoMesa`, 1×/s). O avatar do DJ não vai para coordenadas fixas: a casca dele na pista ganha `.na-mesa` (some) e ele aparece atrás do tampo. A área da mesa (`naMesa`/`foraDaMesa`) é calculada do retângulo real e vale para nascer, clicar e andar.
- **Coroa VIP é selo de avatar** (`.vip-crown`), nunca ícone ao lado do nome — vale para header, chat e pista. O selo de Organização (`Icons.org`) vai junto ao nome.
- **Dados de usuário em animações/classes**: valores como `dance` e `emoji` são validados contra whitelists (no servidor e de novo no app) antes de virarem classe CSS/DOM.
- **Silenciamento é local** (localStorage `esquentaMuted`).
- **Perfil persistido no navegador** (`esquentaProfile`): carregado com merge defensivo na inicialização; `saveProfile()` deve ser chamado em toda mutação de `localProfile`. A chave `esquentaPerfilPronto` marca quem já concluiu a personalização — essa pessoa entra direto na pista (`enterParty()` no fim do script), sem o modal.
- **Nunca use `localStorage` direto** — sempre o helper `store.get/set`, que grava em localStorage **e** em cookie. Em navegação privada do iOS e em iframe particionado o localStorage falha, e sem a reserva o visitante refaz o boneco (e perde a identidade) a cada visita.
- **Miniaturas do avatar usam `CARD_BASE` (config fixa), nunca a config atual** — é o que mantém o conjunto de URLs finito e permite pré-carregar tudo antes da entrada. Voltar a desenhar o card sobre `localProfile.avatarConfig` recarrega ~78 imagens a cada clique.
- **Monte as opções uma vez** (`montarOpcoes`) e alterne só a classe de seleção (`marcarSelecao`). Reconstruir `innerHTML` a cada escolha repede as imagens e faz piscar.
- **Criador de avatar = abas → chips → um painel por vez** (`setAbaAvatar(aba, sub)`, painéis `.cfg-painel[data-painel]`, opções em `.cfg-grade`, cores em `.cfg-cores`). Rosto vem primeiro. Peça nova: crie o painel, o chip na aba certa e a entrada em `CATEGORIAS` (na ordem da tela, que é a ordem do pré-carregamento). Cor que depende da peça fica num bloco que `mostrarCoresRelevantes()` esconde.
- **Toda imagem do DiceBear passa pela fila** (`carregarImagem`, no máximo `FILA_LIMITE` = 6 downloads simultâneos, com até 3 tentativas): a API devolve HTTP 429 quando recebe ~80 pedidos de uma vez. Em templates use `imgAvatar(url, attrs)` + `hidratarAvatares(container)` (o card nasce como esqueleto e ganha o `src` quando a fila entrega); em `<img>` fixos use `trocarAvatar(el, url)`. Nunca escreva `<img src="${getAvatarUrl(...)}">` direto.
- **A cortina só sobe com `assetsProntos`** (imagens + fontes), com teto de 20 s. Toda imagem do pré-carregamento resolve no `onerror` também — CDN fora do ar não pode prender ninguém no loading.
- **CSS do modal precisa de `!important` em propriedades de layout** (`.cfg-abas`, `.cfg-subs`, `.cfg-painel`, `.cfg-grade`, `.cfg-cores`): o Tailwind CDN injeta os estilos depois do bloco `<style>` e empata em especificidade, vencendo pela ordem.
- **Carimbo de build**: `<meta name="app-build">` alimenta o rodapé do modal e o console. Atualize-o quando publicar algo que precise ser confirmado em produção (confira o rodapé após o deploy na Vercel para saber se o navegador pegou a versão nova).
- **Layout em colunas a partir do `md`** (768 px): empilhado, o player 16:9 mais a lateral zeravam a altura da pista no tablet. No celular a lateral vira abas Chat/Fila (`#ladoDireito[data-aba]`, `setAbaLateral()`), o player tem teto de `30dvh` e a pista tem `min-h-[140px]`. Mexeu no layout? Confira a altura do `#danceFloor` em 360×640, 390×844, 768×1024, 855×897 e 1440×900.
- **Acessibilidade**: diálogos novos entram em `DIALOGOS` (ganham Esc, clique fora, foco preso e devolvido) e usam `abrirDialogo`/`fecharDialogo`, com `role="dialog"` e um botão `data-fechar`. Botão só de ícone/emoji precisa de `aria-label`. Texto informativo: no mínimo 10 px e opacidade ≥ 55%. Animação nova entra no bloco `prefers-reduced-motion`.
- **Avisos em fila**: `showToast(msg, link, {acao, erro, ms})` enfileira; aparece um por vez, com no máximo 3 esperando, sem repetir texto, e erros furam a fila. Cada aviso tem ✕. `msg` é HTML, então escape o que vier de usuário (inclusive `err.texto`) antes de passar.
- **Online ≠ presente**: estar na sala mantém o avatar na pista; as regras de DJ e fila usam `presente` (no servidor) / `isPresent(u)` (no app, só para desenhar): conectado **e** sem `away` além de `AWAY_GRACE_MS` (45 s). Quem sai da tela perde a mesa e o lugar na fila; recarregar a página não custa nada.

## Sala (estado no Durable Object `Pista`)

| Parte | Onde | Uso |
|---|---|---|
| pessoas | anexo de cada WebSocket | presença + perfil (`id, name, color, avatarConfig, dance, isVIP, isOrg, x, y, away, awaySince`) |
| `chat` | memória (50) + SQLite (300) | chat público (`id, uid, name, isVIP, isOrg, color, text, timestamp`) |
| `fila` | memória + SQLite `estado` | fila do DJ (`id, videoId, title, addedByName, addedByUid, addedByVIP, timestamp`) |
| `player` | memória + SQLite `estado` | `state` (vídeo atual), `skipVotes`, `countdown` (`endsAt, reason, por, cancelavel`), `playback` (`videoId, state, time, at`, só em memória) |
| `papos` / `dm` | SQLite | pedidos de papo (`status: pending/accepted/declined`) e mensagens privadas — só os dois participantes recebem |
| `festa` | SQLite | votos "Essa vai pra festa!" (curadoria — nunca apagar) |
| `historico` | SQLite | músicas que tocaram — base do ranking |
| `envios` | SQLite | toda música enviada à fila (tocando ou não) — histórico do ranking, onde dá pra votar "vai pra festa" em qualquer uma que já passou pela fila |
| `ingressos` | SQLite | SHA-256 dos e-mails com sal (`manual` = cortesia, imune ao `--substituir`) |
| `vip` / `org` / `banidos` | SQLite | vínculo id → ingresso, id → e-mail da organização, bloqueios de 30 min |

Salas: `principal` (evento), `teste` (`?sala=teste` no app) e `carga-*` (testes automáticos). Detalhes em [docs/arquitetura.md](docs/arquitetura.md) e [servidor/README.md](servidor/README.md).

## Testes / verificação

- Sem suíte de testes no app. Validação mínima após alterações no JS do app:
  ```bash
  python3 -c "import re;open('/tmp/app.mjs','w').write(re.search(r'<script type=\"module\">(.*?)</script>', open('index.html').read(), re.S).group(1))" && node --check /tmp/app.mjs
  ```
- Servidor (dentro de `servidor/`): `npx tsc --noEmit -p .`, depois `npm run dev` e, em outro terminal, `node teste/fluxo.mjs` (protocolo de ponta a ponta, sala nova a cada rodada; `--lento` testa ausência) e `node teste/carga.mjs --n 500` (carga). Contra a Cloudflare: `--base https://…workers.dev --chave <ADMIN_CHAVE>`; acima de ~250 robôs, divida em processos (`--total`).
- App contra o servidor local: sirva a raiz (`python -m http.server 5173`) e abra `http://localhost:5173/?servidor=local&sala=teste`.
- Teste visual com Playwright/Chromium quando possível. **Atenção:** no sandbox os CDNs (Tailwind) podem estar bloqueados pelo proxy — a página abre sem estilo; isso não é um bug do app.
- Sempre teste os dois viewports: desktop (~1440px) e mobile (~390px). O layout usa `dvh` e breakpoints `md`/`lg`.

## Git

- Branch de trabalho: a informada na tarefa.
- Commits em português, no padrão `tipo: descrição` (`feat:`, `fix:`, `docs:`, `config:`).

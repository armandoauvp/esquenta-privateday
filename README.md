# 🪩 Esquenta AUVP Private Day

Pista de dança virtual em tempo real para o esquenta do **AUVP Private Day 2026**. Os usuários criam um avatar, dançam numa pista 80s, conversam no chat ao vivo (e no privado), colocam músicas do YouTube na fila do DJ e votam no que toca — tudo sincronizado entre todos os participantes via Firebase.

**App de arquivo único:** todo o HTML, CSS e JavaScript vivem em [`index.html`](index.html). Não há build, bundler nem dependências locais — basta servir o arquivo (publicado na Vercel).

## ✨ Funcionalidades

### Pista & Avatar
- **Avatar personalizável** (DiceBear Avataaars): cabelo, acessórios, barba, roupas, olhos, sobrancelhas, boca, tom de pele e cores — organizado em seções (**Estilo / Rosto / Cores**), com abas no mobile e painel largo no desktop.
- **Aura colorida** na pista, coroa e brilho VIP para quem já tem ingresso.
- **Pista WebGL (Three.js)**: globo de espelhos 3D facetado, feixes de luz volumétricos coloridos e partículas — tudo pulsando no ritmo quando há música. Se o WebGL não estiver disponível, um globo 2D em CSS assume o lugar.
- Pista 80s com ladrilhos animados e mesa de DJ com vinis girando e equalizador.
- Clique na pista para mover seu avatar; presença sincronizada em tempo real.
- **Reações rápidas**: 🔥 ❤️ 👏 🕺 💃 😂 sobem flutuando do seu avatar para todo mundo ver.
- **Passinhos de dança**: escolha um preset (giro, pulinho, quebradinha, moonwalk) e seu avatar dança para todos.
- **👑 Área VIP** na pista: visível para todos, mas só quem tem ingresso entra — não-VIPs ganham um convite para garantir o seu.

### Música (Fila do DJ)
- Qualquer pessoa cola um link do YouTube e entra na fila.
- **Votação para pular**: o botão "Pular" registra votos; quando a maioria dos online vota, rola uma **contagem regressiva de 5s** e a música troca.
- **Limite de 10 minutos**: todo vídeo é pulado automaticamente ao completar 10 min de reprodução.
- **Playlist da casa (fallback)**: se ninguém está tocando nada, o player toca em loop o [vídeo da casa](https://youtu.be/5D_Of9Zpsgs), com as músicas do esquenta emendadas e começando num trecho sorteado. Quando alguém adiciona uma música, uma contagem regressiva aparece e a música do usuário assume a mesa.
- **🔥 "Essa vai pra festa!"**: botão de voto por música, gravado no Firestore (`partyVotes`) para curadoria do gosto musical da galera para a festa real.
- Avanço automático ao fim de cada vídeo (YouTube IFrame API).
- **A pista não fica refém de quem sumiu**: quem está na mesa precisa ficar na tela — fechar o app, minimizar ou trocar de aba por mais de ~45 s passa a vez para a próxima música e tira a pessoa da fila (recarregar a página não custa o lugar). Vídeo indisponível também é pulado na hora, e um player travado se recarrega sozinho.
- **Títulos das músicas** resolvidos automaticamente via oEmbed (sem chave de API) — aparecem na fila, sobre o player e no ranking.
- **🏆 Ranking da noite** (botão no header): DJs que mais emplacaram músicas e as mais votadas para a festa.

### Chat
- **Chat ao vivo** para todos, com destaque VIP. Mensagens de dias anteriores exibem a data.
- **Chat privado (DM)**: clique no avatar de alguém na pista para abrir uma conversa 1:1, com badge de mensagens não lidas.
- **Moderação leve**: palavrões são censurados automaticamente no envio e qualquer pessoa pode silenciar (🔇) outro usuário localmente — mensagens, DMs e reações do silenciado somem para quem silenciou.

### Entrada
- **Avatar sorteado no primeiro acesso** (com botão 🎲 para sortear de novo) e catálogos de personalização em **uma linha por categoria**, com scroll lateral.
- **Quem já criou o boneco vai direto para a pista** nas próximas visitas — o modal só volta pelo botão do avatar no header.
- Dois botões no final da personalização:
  - **"Já tenho meu ingresso!"** → entra como VIP (coroa + brilho).
  - **"Já tenho meu ingresso!"** → confirma pelo e-mail da compra, conferido contra a lista importada (`tools/importar-ingressos.py`).
  - **"Entrar sem ingresso"** → entra como convidado; um aviso oferece o link da [página de ingressos](https://privateday.auvp.com.br/#ingressos) (nenhuma aba abre sozinha).
- Enquanto o painel de personalização está aberto, o áudio da música fica **abafado** (volume reduzido + desfoque no vídeo — simulação de filtro, já que o YouTube não expõe o áudio do embed ao Web Audio).

## 🧩 Embutir no site (Elementor)

`elementor/esquenta-privateday.html` é o app inteiro num arquivo só, com as imagens da marca embutidas — um upload, sem arquivo companheiro. Gere com `python3 tools/build-elementor.py` e embuta por iframe. Passo a passo em [docs/elementor.md](docs/elementor.md).

## 🚀 Como rodar

1. Sirva o `index.html` em qualquer host estático — em produção, a Vercel (ver [docs/deploy.md](docs/deploy.md)) — ou abra localmente.
2. O app precisa de internet para: Tailwind CDN, Google Fonts, Firebase, DiceBear e YouTube.
3. As credenciais do Firebase já estão em `FIREBASE_CONFIG_FALLBACK` dentro do `index.html` (projeto `auvp-privateday`). Para usar outro projeto, veja [docs/deploy.md](docs/deploy.md).

## 📚 Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Estrutura do código, modelo de dados no Firestore, sincronização (líder, contagem, votos) |
| [docs/funcionalidades.md](docs/funcionalidades.md) | Guia detalhado de cada funcionalidade e como ela funciona por dentro |
| [docs/deploy.md](docs/deploy.md) | Publicação, configuração do Firebase e solução de problemas |
| [CLAUDE.md](CLAUDE.md) | Guia para desenvolvimento com Claude Code neste repositório |

## 🛠 Stack

- **UI**: HTML + [Tailwind CSS (CDN)](https://tailwindcss.com) + CSS custom (animações da pista)
- **3D**: [Three.js](https://threejs.org) via jsDelivr (import dinâmico com fallback 2D)
- **Tempo real**: [Firebase](https://firebase.google.com) — Auth anônimo + Firestore (`onSnapshot`)
- **Avatares**: [DiceBear v8 – Avataaars](https://www.dicebear.com)
- **Player**: YouTube IFrame Embed + postMessage API
- **Títulos**: oEmbed via [noembed.com](https://noembed.com) (CORS liberado, sem chave)
- **Fontes**: Poppins, Anek Latin e DiscoDiva (display)

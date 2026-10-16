# Histórico e decisões

Registro do que foi feito, por quê e o que se aprendeu. Para o estado atual do código, veja [arquitetura.md](arquitetura.md); para o que falta, [plano.md](plano.md).

## Linha do tempo

| Quando | PR | O quê |
|---|---|---|
| ago/2026 | #16–#21 | Base da pista: presença ativa (DJ precisa ficar na tela), perfil que não se perde, pré-carregamento dos bonecos, versão para Elementor, coroa VIP ancorada no avatar |
| 13/10 | #22 | Deploy na Vercel (`vercel.json`, `.vercelignore`) |
| 13/10 | #23 | Fila de imagens do DiceBear (`carregarImagem`): a API devolvia 429 e os cards do criador ficavam vazios |
| 13/10 | #24 | Auditoria de UI/UX: ingresso confirmado por e-mail (hash com sal), criador de avatar em abas (Rosto antes de Estilo), Hugeicons no lugar de emoji, dado animado no "Aleatório", segurança (escape, regras) |
| 13/10 | #25 | Importador de ingressos lê o XLSX do Guru e filtra por status |
| 13/10 | #26 | Avisos em fila, pista pelo teclado, player mais fácil no celular |
| 14/10 | #27 | Playlist da casa = um vídeo em loop (`5D_Of9Zpsgs`, gerado pelo projeto `video/`) |
| 14/10 | #28 | Música sincronizada para todos (inclusive a da casa), só o DJ controla o player, avatares passam atrás do globo |
| 14/10 | #29 | Performance (renders agendados por assinatura), robustez da sincronia (relógio corrigido, transações) e nova mesa de DJ |
| 15/10 | #30 | **Migração do Firebase para servidor próprio na Cloudflare**, organização com Google, 500 pessoas testadas (mergeado no mesmo dia) |
| 15/10 | `feat/pausa-e-contexto` | Pausa do DJ por mais de 10 s passa a vez; aviso ao colocar vídeo com mais de 10 min; exportação da curadoria (`/admin/exportar`); cabeçalho alinhado à esquerda; documentos de contexto (`plano.md`, `historico.md`, `operacao-evento.md`) |

## Decisões importantes

### Firebase → Cloudflare (15/10/2026)

**Problema.** No Firestore, cada escrita é lida por todos os conectados: com N pessoas, o custo cresce com N². No plano gratuito (50 mil leituras/dia), a conta dava ~14 pessoas por 1 h, ~10 por 2 h e ~7 por 3 h. O evento espera centenas.

**Opções avaliadas.**
- Firebase Blaze (pago): resolve, mas tem custo variável e continua sem servidor (decisões no navegador, "líder").
- Backend na Vercel: plano Hobby não permite uso comercial, e WebSocket lá é beta, com duração máxima de 300 s.
- Supabase Realtime e Ably (gratuitos): limite de 200 conexões. Firebase Realtime Database (gratuito): limite de 100.
- **Cloudflare Workers + Durable Objects (gratuito)**: WebSocket com hibernação, mensagens enviadas pelo servidor não contam na cota, recebidas contam 1/20 de requisição (100 mil/dia), SQLite na própria sala. **Escolhida.**

**Como foi feito.**
1. Etapa 1: sala mínima (presença e posições) e carga com 500 robôs, local e na Cloudflare. Era o ponto de decisão: se falhasse, ficaríamos no Firebase com Blaze. Passou.
2. Servidor completo: a sala virou dona da música (contagem, 10 min, fim de vídeo, DJ ausente, votação, faxina), com chat, papos, reações, ranking, ingressos e organização.
3. App: troca da camada Firebase por WebSocket, mantendo os renders e o visual.
4. Testes: `servidor/teste/fluxo.mjs` (46 conferências + 5 de ausência) e carga de 500 robôs, local e na Cloudflare, sem quedas.

**Achados no caminho.**
- Não há Durable Object na América do Sul. Pedir `locationHint: 'sam'` levou a sala para Nova Jersey; sem pedido, nasceu em Miami (~150 ms de ping a partir de SP). A sala `principal` está em Miami.
- Um processo Node só não segura 500 conexões TLS: no primeiro teste na nuvem apareceram atrasos de até 80 s e 22 quedas, todos do lado do cliente de teste. Divididos em 2 processos de 250, zero problema.
- O limite de ritmo do servidor recusa a segunda tentativa de ingresso em menos de 2 s (correto; o teste é que precisou esperar).

### Votação, UTM e toque no celular (16/10/2026)

- **Pular**: o primeiro pedido ("quem tem ingresso não consegue pular qualquer música, só a sua") foi lido como "acabar com a votação" e corrigido pelo Armando: todos podem votar; o problema era pular **a qualquer hora**. Com pouca gente na pista o limiar caía para 1, e um voto sozinho trocava a música de qualquer DJ. Agora o limiar é `max(2, …)`; o DJ continua passando a própria vez sozinho.
- **UTM**: as UTMs da visita (do endereço do app ou da página que o embute) vão em todo link para os sites da AUVP e ficam guardadas no navegador; sem campanha, vai uma UTM padrão da pista.
- **Celular**: o toque em outro avatar pedia papo na hora e gerava pedidos sem querer. Agora abre um cartão com "Puxar papo" e "Andar pra cá".
- **Histórico no ranking**: o ranking ganhou "Todas as músicas da noite" (tabela nova `envios`, porque o `historico` só tinha o que tocou) e o voto "vai pra festa" em qualquer música que já passou pela fila. O cache do ranking caiu para 15 s e não é mais invalidado a cada voto: com centenas votando, cada voto refaria a varredura para todo mundo.
- **Convite pro ingresso**: banner baseado no banner do LearnWorlds (ingresso creme com canhoto vermelho destacável), compacto (61 px no celular, 69 px no desktop). Começou temporário (40 s, 30 s, a cada 12 min); no mesmo dia virou **fixo** para quem não tem ingresso, com o chat abrindo espaço para ele. Fica no topo do chat porque, no celular, qualquer canto da pista cobriria o globo ou os avatares, e uma faixa no layout encolheria a pista.

### Limites da mesa (15/10/2026)

Pedidos do Armando: "somente o DJ pode controlar a música, mas se ela ficar pausada por mais de 10 segundos, passa pra próxima" e "com exceção do fallback, qualquer vídeo só pode tocar até 10 minutos; vídeo maior deve ter um disclaimer".

- **Pausa**: regra no servidor (`PAUSA_MAX_MS`). Aos 5 s de pausa abre a contagem; aos 10 s troca. O DJ republica "pausado" a cada 5 s, então o prazo conta de quando a pausa começou (`pausadoDesde`), não da última mensagem. A contagem cobre o player, então o DJ ganhou um botão "Voltar a tocar". Na retomada depois de pausa longa, o app publica a posição da pausa (exata) mesmo com a última informação do player antiga.
- **10 minutos**: o corte já existia no servidor. O aviso precisa da duração antes de tocar, e o oEmbed não informa: o app abre um player do YouTube invisível só para ler a duração pela IFrame API (sem chave de API, até 7 s) e o remove. O handler principal de mensagens do YouTube passou a ignorar qualquer iframe que não seja o `#ytFrame`, senão o medidor bagunçaria a sincronia.

### Organização (admin)

Pedido: `armando.custodio@auvp.com.br`, `daniel.machado@auvp.com.br` e `daniela.oliveira@auvp.com.br` com poderes de controlar a música, moderar o chat, remover pessoas e selo de Organização, entrando com Google. Em 16/10 entrou `ariadne.carneiro@auvp.com.br` (só o secret `ADMINS` muda: o público do Google é Interno, então qualquer conta `@auvp.com.br` já consegue entrar). `jeniffer.nascimento@auvp.com.br` chegou a entrar na lista por engano e saiu minutos depois: é da equipe, mas vai circular na pista como participante ("infiltrada"), então entrou como **cortesia** na lista de ingressos (379 no total); para isso valer de verdade, o servidor passou a reconferir o selo a cada conexão: e-mail fora de `ADMINS` perde o selo (o selo dado pela rota `/admin/org` fica marcado como manual e não depende da lista). Ficou para a arquitetura nova e foi entregue no #30: pular a música, tirar da fila, apagar mensagem e remover por 30 min. Pausar/arrastar a música continua só com o DJ (duas pessoas publicando a posição brigariam). A organização **não** lê papos privados. O login depende do ID do cliente OAuth no Google, criado em 15/10/2026 no projeto `auvp-privateday`: a Plataforma de autenticação ainda não existia, foi criada com o app `Esquenta AUVP Private Day` e Público **Interno** — o projeto está na organização da AUVP no Workspace, então só contas `@auvp.com.br` entram, sem lista de usuários de teste e sem verificação. O cliente é um **Aplicativo da Web** chamado `Pista do esquenta`, com as origens `https://esquenta-privateday.vercel.app`, `https://privateday.auvp.com.br` e `http://localhost:5173` e nenhuma URI de redirecionamento (o Google Identity Services usa pop-up). A chave secreta do cliente não é usada e não foi guardada em lugar nenhum. O ID não é segredo e está no `index.html` e no `servidor/wrangler.jsonc`; vale só depois do `wrangler deploy`, e mudança de origem pode levar alguns minutos para valer.

### Ingresso por e-mail

Decisão de produto: "só digitar o e-mail", sem link de confirmação. O modelo prova "conhece o e-mail de um comprador", não "é dono do e-mail". Só o SHA-256 com sal (`auvp-privateday:`) sai do computador de quem importa. Importações:
- 13/10: 441 vendas aprovadas → 373 e-mails (Firestore).
- 15/10: planilha de 14/10 → 377 e-mails + 1 cortesia (`armandocustodio0@gmail.com`) = 378 no servidor novo.

Planilhas do Guru ficam em `C:\Users\armando.neto\Downloads\Editáveis\` (fora do repositório; `*.xlsx` e `*.csv` estão no `.gitignore`).

### Sincronia da música

- Duração do vídeo da casa é **fixa** (`duracaoFallback = 5751`): o YouTube informa primeiro a duração arredondada e depois a fracionada; com ~200 voltas desde a época, 0,5 s viraram 157 s de diferença entre clientes.
- O DJ só publica estados reais (tocando/pausado) com posição fresca; buffering e anúncio puxavam a pista para trás.
- Relógio corrigido (`agora()`): um PC com o relógio 80 s adiantado se achava o único presente, virava "líder" e apagava a fila. Com o servidor dono da música, esse risco acabou; o relógio continua sendo medido para a sincronia.

## Lições de processo

- Teste de carga com robôs antes de qualquer promessa de capacidade.
- PRs foram mergeados antes do último commit subir duas vezes (#25, #27): commitar e subir tudo antes de pedir merge.
- Comandos com heredoc no Bash do Windows quebram com aspas; para trocas grandes em arquivos, scripts Python com pares "de → para" que falham se o trecho não for encontrado exatamente uma vez.
- O painel do navegador escondido pausa o `requestAnimationFrame`: em testes, o desenho atrasa sem ser bug.

## Fora deste repositório

- Pedido para o repositório `mural-de-recados`: no card expandido, mostrar as "métricas" do verso logo abaixo do recado, sem precisar virar o card. Não foi feito porque outra sessão estava editando aquele repositório.

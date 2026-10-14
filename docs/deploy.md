# Deploy e configuração

## Publicação

O app é um único arquivo estático (`index.html`). Qualquer host serve:

### Vercel (em uso)

O repositório já vem pronto: `vercel.json` (site estático, sem build) e `.vercelignore` (publica só `index.html`, `GLOBO.png` e `LETTERING.png`).

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório do GitHub.
2. **Framework Preset: Other**. Deixe Build Command, Output Directory e Install Command vazios — não há build.
3. Deploy. A partir daí:
   - cada push na `main` publica em produção;
   - cada PR ganha uma URL de preview própria (bom para testar antes do merge).
4. Domínio próprio: **Project → Settings → Domains**. Para embutir no site por iframe, prefira um subdomínio do próprio site (ver [elementor.md](elementor.md)).

O que o `vercel.json` define:

| Regra | Efeito |
|---|---|
| `/` → `Cache-Control: max-age=0, must-revalidate` | Todo acesso revalida o HTML; deploy novo aparece na hora |
| `GLOBO.png`/`LETTERING.png` → `max-age=86400` | Imagens da marca ficam 1 dia em cache |
| `X-Content-Type-Options`, `Referrer-Policy` | Cabeçalhos básicos de segurança (sem CSP, para não barrar CDNs, Firebase e YouTube) |
| `cleanUrls` | `/index.html` redireciona para `/` |

O Firebase usa só auth anônimo, que não exige cadastrar o domínio da Vercel em *Authorized domains*.

### Outros hosts

Qualquer host estático serve (Netlify, Cloudflare Pages…): publique os três arquivos juntos.

Requisitos do ambiente do visitante: internet liberada para `cdn.tailwindcss.com`, `fonts.googleapis.com`, `www.gstatic.com` (Firebase), `api.dicebear.com`, `raw.githubusercontent.com` (fonte DiscoDiva), `img.youtube.com`, `www.youtube.com`, `cdn.jsdelivr.net` (Three.js — opcional, com fallback 2D) e `noembed.com` (títulos — opcional).

**Identidade visual**: o globo da marca é o arquivo local `GLOBO.png` e o nome "PRIVATE DAY" usa o lettering `LETTERING.png` (ambos na raiz do repositório, referenciados por caminho relativo — sirva os três arquivos juntos).

## Firebase

O projeto usa **Auth anônimo** + **Firestore**. As credenciais ficam no bloco `FIREBASE_CONFIG_FALLBACK` do `index.html` (hoje apontando para o projeto `auvp-privateday`). A chave de API do Firebase não é secreta — a segurança vem das regras do Firestore.

### Usar outro projeto Firebase

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com).
2. Ative **Authentication → Sign-in method → Anonymous**.
3. Crie um banco **Firestore** (modo produção).
4. Publique as regras do arquivo [`firestore.rules`](../firestore.rules) (ver "Regras do Firestore" abaixo).
5. Copie o config (Configurações do projeto → Seus apps → Web) para `FIREBASE_CONFIG_FALLBACK` e ajuste `APP_ID_FALLBACK` para o `projectId`.

### Lista de ingressos

Quem tem ingresso confirma pelo e-mail da compra. A lista vai para o Firestore com o script [`tools/importar-ingressos.py`](../tools/importar-ingressos.py):

1. Uma vez só: `pip install firebase-admin openpyxl` e, no console do Firebase, **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Guarde o JSON **fora do repositório**: ele dá acesso total ao projeto.
2. Exporte as vendas da plataforma (no Guru: **Vendas → Exportar**, em `.xlsx`). CSV também funciona.
3. Confira primeiro, sem gravar nada: `python3 tools/importar-ingressos.py Guru-Vendas.xlsx --simular`
4. Importe: `python3 tools/importar-ingressos.py Guru-Vendas.xlsx --chave caminho/da-chave.json`
5. Repita sempre que houver vendas novas. Com reembolsos, use `--substituir` para apagar quem saiu da planilha.
6. Cortesias, convidados e equipe (fora da planilha): `python3 tools/importar-ingressos.py --adicionar fulano@exemplo.com --chave caminho/da-chave.json` (pode repetir `--adicionar`). Esses e-mails ficam marcados como **manuais** e o `--substituir` nunca os apaga.

O script lê a primeira aba do `.xlsx` (ou o CSV, detectando separador e codificação) e acha a coluna de e-mail pelo cabeçalho. No Guru é `email contato`; para outra, use `--coluna "Nome da coluna"`. Se houver coluna `status`, só entram vendas **Aprovada/Completa** (`--todos-status` desliga o filtro). Linhas sem e-mail válido são ignoradas, e cada e-mail entra uma vez só, mesmo com várias compras (upgrades). Só o hash de cada e-mail é gravado.

> **Primeira importação:** 13/10/2026, planilha do Guru com 441 vendas aprovadas, que deram **373 e-mails únicos**.

### Regras do Firestore

As regras ficam versionadas em [`firestore.rules`](../firestore.rules), na raiz do repositório. Elas garantem do lado do servidor o que o app só faria de boa-fé:

- **Chat privado de verdade**: `dm` e `dmThreads` só podem ser lidos pelos dois participantes (campo `participants`). O app consulta só as próprias conversas (`where('participants', 'array-contains', uid)`).
- **Ninguém escreve em nome de outro**: perfil (`users/{uid}`), chat, fila, reações e votos exigem que o uid do documento seja o de quem escreve.
- **Chat e votos não são apagáveis pelo app** (a limpeza é pelo console); fila e reações podem ser apagadas, porque o líder faz a faxina.

Para publicar: console do Firebase → **Firestore Database → Regras** → apague o conteúdo atual, cole o `firestore.rules` inteiro → **Publicar**. Antes de publicar, dá para testar no **Playground de regras** da mesma tela.

> **Ordem importa:** publique primeiro o app novo (Vercel) e só depois as regras. Um navegador com o HTML antigo em cache faz a consulta sem filtro e passa a ser recusado. Basta recarregar a página.

Nenhuma consulta do app precisa de índice composto: `array-contains`, `orderBy('timestamp')` e o filtro de `lastUpdate` usam os índices automáticos de campo único.

### Moderação / manutenção dos dados

Operações úteis direto no console do Firestore (`artifacts/{appId}/public/data/…`):

- **Limpar o chat**: apague os documentos da coleção `chat` (e `dm`, se quiser zerar os privados).
- **Destravar o player**: apague ou edite `player/state` (defina `videoId: null`).
- **Zerar votação de pular**: apague `player/skipVotes`.
- **Zerar ranking**: apague os documentos da coleção `history` (as reações em `reactions` se limpam sozinhas — o cliente líder apaga as antigas).
- **Exportar curadoria**: exporte a coleção `partyVotes`; agrupe por `videoId`. O título de cada vídeo pode ser resolvido via `https://www.youtube.com/oembed?url=https://youtu.be/{videoId}&format=json`.

Também dá para automatizar via REST (auth anônima + Firestore REST API) — foi assim que o chat foi limpo em 05/08/2026.

## Parâmetros ajustáveis (constantes no `index.html`)

| Constante | Padrão | Efeito |
|---|---|---|
| `FALLBACK_VIDEO` + `duracaoFallback` | `5D_Of9Zpsgs`, `5751` | Vídeo da casa (músicas emendadas) em loop quando ninguém está na mesa, com todo mundo no mesmo trecho. Trocou o vídeo? Atualize a duração (em segundos) junto |
| `SINCRONIA_TOLERANCIA_S` | `2` | Diferença máxima (s) entre o player de cada visitante e a referência antes de realinhar |
| `MAX_PLAY_MS` | `600000` (10 min) | Tempo máximo de reprodução por vídeo |
| `COUNTDOWN_MS` | `5000` | Duração da contagem regressiva de troca |
| `TICKETS_URL` | `https://privateday.auvp.com.br/#ingressos` | Link do aviso de boas-vindas de quem entra sem ingresso e do toast da Área VIP |
| `DJ_X` / `DJ_Y` | `89` / `78` | Posição (%) do DJ na pista |
| `VIP_ZONE` | `{x1:72, y1:5, x2:98, y2:32}` | Retângulo (%) da Área VIP na pista |
| `BANNED_WORDS` | lista em pt-BR | Palavras censuradas no chat/DM |
| `BPM` (bloco WebGL) | `118` | Batida estimada do pulso visual da pista 3D |

## Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| Tela "Firebase não configurado" | `FIREBASE_CONFIG_FALLBACK` vazio | Preencher config (acima) |
| Loading trava e abre sem conexão após 10 s | Sem rede até o Firebase / auth falhou | Verificar regras, Auth anônimo ativado e rede |
| Playlist da casa muda mas sem som | Política de autoplay do navegador | Comportamento esperado — o visitante clica em "🔊 Ativar som" |
| Vídeo reinicia para todos ao votar | Regressão: iframe sendo recriado no overlay | Manter o padrão `renderPlayer`/`updatePlayerOverlay` (ver CLAUDE.md) |
| Música não pula aos 10 min com a aba fechada | Só clientes abertos executam ações (não há backend) | Esperado — precisa de ao menos 1 participante online |
| Deploy na Vercel falha procurando build/`package.json` | Preset de framework detectado errado | Project → Settings → Build and Deployment → Framework Preset: **Other**, com os comandos vazios |
| O site não reflete o último merge | Deploy ainda em andamento, ou o navegador reaproveitou a cópia antiga | Conferir o deploy no painel da Vercel, dar hard refresh (`Ctrl/Cmd+Shift+R`) e checar o carimbo `build` no rodapé do modal de personalização (`<meta name="app-build">`) |

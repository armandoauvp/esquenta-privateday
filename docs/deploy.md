# Deploy e configuração

São duas partes:

- **App** (`index.html` + PNGs): site estático na Vercel.
- **Servidor da pista** (`servidor/`): Cloudflare Workers + Durable Objects, plano gratuito. Guarda presença, chat, fila, player, votos, papos, ingressos e organização.

## App na Vercel

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
| `X-Content-Type-Options`, `Referrer-Policy` | Cabeçalhos básicos de segurança (sem CSP, para não barrar CDNs, o servidor da pista e o YouTube) |
| `cleanUrls` | `/index.html` redireciona para `/` |

O endereço do servidor fica em `SALA_SERVIDOR` no `index.html`. Para testar sem mexer na pista do evento:

- `?sala=teste` usa a sala de testes;
- `?servidor=local` usa o `wrangler dev` da sua máquina (`ws://127.0.0.1:8787`).

Requisitos do ambiente do visitante: internet liberada para `cdn.tailwindcss.com`, `fonts.googleapis.com`, `*.workers.dev` (servidor da pista, WebSocket), `api.dicebear.com`, `raw.githubusercontent.com` (fonte DiscoDiva), `img.youtube.com`, `www.youtube.com`, `cdn.jsdelivr.net` (Three.js — opcional, com fallback 2D), `noembed.com` (títulos — opcional) e `accounts.google.com` (só para quem entra como organização).

## Servidor da pista (Cloudflare)

Detalhes do protocolo e dos testes em [`servidor/README.md`](../servidor/README.md).

### Publicar

Dentro de `servidor/`:

```bash
npm install
npx wrangler login             # uma vez; abre o navegador para autorizar a conta
npx wrangler deploy
```

Secrets (cada um pede o valor no terminal):

| Secret | Para quê |
|---|---|
| `SEGREDO` | Assina a identidade de cada visitante (texto aleatório longo) |
| `ADMIN_CHAVE` | Libera a importação de ingressos (`/admin/*`). Guarde: o importador pede |
| `ADMINS` | E-mails da organização, separados por vírgula |

```bash
npx wrangler secret put SEGREDO
npx wrangler secret put ADMIN_CHAVE
npx wrangler secret put ADMINS
```

Variáveis (em `wrangler.jsonc`, `vars`): `GOOGLE_CLIENT_ID` (ver abaixo) e, opcional, `ORIGENS` (domínios aceitos, separados por vírgula; vazio aceita qualquer um).

> **Não publique o servidor durante o evento.** Um deploy reinicia a sala: a música, a fila e o chat voltam do armazenamento, mas todo mundo reconecta ao mesmo tempo.

### Onde a sala roda

A Cloudflare não tem Durable Objects na América do Sul. A sala nasce no data center escolhido no primeiro acesso e fica lá: a `principal` está em Miami (ping de ~150 ms a partir de São Paulo). Para conferir: `https://esquenta-pista.esquenta-pista-servidor.workers.dev/onde?sala=principal`.

### Cota do plano gratuito

| Recurso | Limite/dia | Evento de 3 h com 500 pessoas |
|---|---|---|
| Requisições (mensagens recebidas contam 20:1) | 100 mil | ~25–40 mil |
| Duração (GB-s) | 13 mil | ~1,4 mil |
| Linhas gravadas no SQLite | 100 mil | chat, votos, papos, histórico: poucos milhares |

Mensagens enviadas pelo servidor e o ping/pong (respondido pelo runtime) não contam. A cota zera às 00:00 UTC (21:00 em Brasília). Acompanhe em **Workers & Pages → esquenta-pista → Métricas**.

## Organização (Entrar com Google)

Os e-mails do secret `ADMINS` ganham o selo de **Organização** ao entrar com Google. Para ligar o botão (roteiro para o agente executar no navegador em [plano.md → Roteiro 1.3](plano.md#roteiro-13-id-do-cliente-oauth-do-google)):

1. Em [console.cloud.google.com](https://console.cloud.google.com), escolha o projeto `auvp-privateday` (é o mesmo do Firebase) ou crie um.
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Interno** (só contas `@auvp.com.br`) ou Externo; preencha nome do app e e-mail de suporte.
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione cada endereço onde o app abre: `https://esquenta-privateday.vercel.app` (produção), o domínio próprio, o site do Elementor (`https://privateday.auvp.com.br`, se embutir) e `http://localhost:5173` (testes). Não precisa de URI de redirecionamento. Os previews de PR da Vercel ficam atrás do login da Vercel e não precisam entrar.
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e coloque em dois lugares:
   - `GOOGLE_CLIENT_ID` no `index.html`;
   - `vars.GOOGLE_CLIENT_ID` no `servidor/wrangler.jsonc`, e depois `npx wrangler deploy`.

O selo fica gravado na identidade daquele navegador: não precisa entrar de novo a cada visita. "Sair da organização neste aparelho" remove. Poderes: pular a música, tirar músicas da fila, apagar mensagens do chat e remover alguém da pista por 30 min. A organização **não** lê papos privados.

Reserva sem Google (ou para testes): `POST /admin/org?sala=principal` com `Authorization: Bearer <ADMIN_CHAVE>` e corpo `{"id": "<esquentaId do navegador>"}` dá o selo a uma identidade. O `esquentaId` aparece no `localStorage` do navegador.

## Lista de ingressos

Quem tem ingresso confirma pelo e-mail da compra. A lista vai para o servidor com o script [`tools/importar-ingressos.py`](../tools/importar-ingressos.py), que manda só o SHA-256 de cada e-mail:

1. Uma vez só: `pip install openpyxl` (só para `.xlsx`).
2. Exporte as vendas da plataforma (no Guru: **Vendas → Exportar**, em `.xlsx`). CSV também funciona.
3. Confira primeiro, sem enviar nada: `python tools/importar-ingressos.py Guru-Vendas.xlsx --simular`
4. Importe: `python tools/importar-ingressos.py Guru-Vendas.xlsx --chave-admin <ADMIN_CHAVE>` (ou defina a variável `ESQUENTA_ADMIN_CHAVE` e omita a opção).
5. Repita sempre que houver vendas novas. Com reembolsos, use `--substituir`: quem saiu da planilha sai da lista e perde a coroa e a mesa de DJ na próxima conexão.
6. Cortesias, convidados e equipe (fora da planilha): `--adicionar fulano@exemplo.com` (pode repetir). Esses ficam marcados como **manuais** e o `--substituir` nunca os apaga. Para tirar um: `--remover fulano@exemplo.com`.

O script lê a primeira aba do `.xlsx` (ou o CSV, detectando separador e codificação) e acha a coluna de e-mail pelo cabeçalho. No Guru é `email contato`; para outra, use `--coluna "Nome da coluna"`. Se houver coluna `status`, só entram vendas **Aprovada/Completa** (`--todos-status` desliga o filtro). Cada e-mail entra uma vez só, mesmo com várias compras.

> **Importação no servidor novo:** 15/10/2026, planilha do Guru de 14/10 com 377 e-mails únicos, mais 1 cortesia manual: **378 ingressos**.

## Manutenção durante o evento

- **Estado da sala**: `GET /admin/estado?sala=principal` com `Authorization: Bearer <ADMIN_CHAVE>` mostra conexões, pessoas, fila, música atual e quantos ingressos há na lista.
- **Curadoria e histórico**: `GET /admin/exportar?sala=principal` (mesma autorização) devolve os votos "Essa vai pra festa!" por vídeo e todas as músicas tocadas.
- **Moderação**: pela própria pista, com o selo de Organização.
- **Limpar tudo** (chat, histórico, votos): só apagando a sala, um passo destrutivo que exige uma migração no `wrangler.jsonc` (`deleted_classes`). Prefira a sala `teste` para ensaios.

## Parâmetros ajustáveis

No `index.html`:

| Constante | Padrão | Efeito |
|---|---|---|
| `FALLBACK_VIDEO` + `duracaoFallback` | `5D_Of9Zpsgs`, `5751` | Vídeo da casa (músicas emendadas) em loop quando ninguém está na mesa, com todo mundo no mesmo trecho. Trocou o vídeo? Atualize a duração (em segundos) junto |
| `SINCRONIA_TOLERANCIA_S` | `2` | Diferença máxima (s) entre o player de cada visitante e a referência antes de realinhar |
| `TICKETS_URL_BASE` | `https://privateday.auvp.com.br/#ingressos` | Link de ingressos (aviso de boas-vindas, Área VIP, fila). Sai com as UTMs da visita (`TICKETS_URL`) |
| `UTM_PADRAO` | `utm_source=esquenta`, `utm_medium=pista_virtual`, `utm_campaign=privateday2026` | UTMs dos links para a AUVP quando a visita chegou sem campanha |
| `VIP_ZONE` | `{x1:72, y1:5, x2:98, y2:32}` | Retângulo (%) da Área VIP na pista (igual em `servidor/src/regras.ts`) |
| `BPM` (bloco WebGL) | `118` | Batida estimada do pulso visual da pista 3D |

No servidor (`servidor/src/pista.ts`): `MAX_PLAY_MS` (10 min por música), `PAUSA_MAX_MS` (10 s de pausa passa a vez), `COUNTDOWN_MS` (5 s), `AWAY_GRACE_MS` (45 s fora da tela), `GRACE_SAIDA_MS` (20 s para quem recarrega), `FILA_POR_PESSOA` (3), `BAN_MS` (30 min) e a lista de palavrões em `regras.ts`.

## Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| Faixa "Conectando à pista…" não some | Servidor fora, rede bloqueando `*.workers.dev` ou cota do dia esgotada | Abrir `/saude` do servidor; conferir as métricas na Cloudflare |
| Playlist da casa muda mas sem som | Política de autoplay do navegador | Comportamento esperado — o visitante clica em "Ativar som" |
| Vídeo reinicia para todos ao votar | Regressão: iframe sendo recriado no overlay | Manter o padrão `renderPlayer`/`updatePlayerOverlay` (ver CLAUDE.md) |
| "Sou da organização" diz "não configurado" | `GOOGLE_CLIENT_ID` vazio no `index.html` | Seguir "Organização" acima |
| Botão do Google some ou dá erro de origem | Domínio não está nas origens autorizadas do cliente OAuth | Adicionar o domínio no Google Cloud |
| "Esse e-mail não faz parte da organização" | E-mail fora do secret `ADMINS` | `npx wrangler secret put ADMINS` com a lista completa |
| Deploy na Vercel falha procurando build/`package.json` | Preset de framework detectado errado | Project → Settings → Build and Deployment → Framework Preset: **Other**, com os comandos vazios |
| O site não reflete o último merge | Deploy ainda em andamento, ou o navegador reaproveitou a cópia antiga | Conferir o deploy no painel da Vercel, dar hard refresh (`Ctrl/Cmd+Shift+R`) e checar o carimbo `build` no rodapé do modal de personalização (`<meta name="app-build">`) |

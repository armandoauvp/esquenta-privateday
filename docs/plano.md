# Plano: o que falta e o que automatizar

Documento vivo. Ao concluir um item, marque `[x]` com data e PR, e passe o que for relevante para [historico.md](historico.md). Contexto: [historico.md](historico.md), [arquitetura.md](arquitetura.md), [deploy.md](deploy.md), [operacao-evento.md](operacao-evento.md) e o [CLAUDE.md](../CLAUDE.md).

**Responsável:** **Você** = precisa de login, decisão ou dado pessoal (consoles do Google e da Cloudflare, merge, planilhas). **Agente** = Claude/Cowork faz no repositório.

## Estado em 15/10/2026

- **No ar**: app na Vercel (PR #30 mergeado) falando com o servidor da Cloudflare `https://esquenta-pista.esquenta-pista-servidor.workers.dev`, sala `principal` em Miami. O Firebase não é mais usado pelo app.
- **Servidor publicado** com as regras de pausa longa (10 s passa a vez) e duração na fila. O app com o aviso de vídeo longo, o botão "Voltar a tocar" e o cabeçalho alinhado à esquerda está no PR da branch `feat/pausa-e-contexto`.
- 378 ingressos na sala `principal` (planilha do Guru de 14/10 + 1 cortesia).
- Secrets do servidor: `SEGREDO`, `ADMIN_CHAVE`, `ADMINS` (os três e-mails da organização). `GOOGLE_CLIENT_ID` ainda vazio.
- Chave de admin de produção só no arquivo local `servidor/.chave-admin-producao` (fora do git).

## 1. Colocar no ar o que falta

- [x] **1.1 Migração para a Cloudflare** — PR #30, mergeado em 15/10/2026.
- [ ] **1.2 Mergear o PR de `feat/pausa-e-contexto`** — Você. Aviso de vídeo longo, "Voltar a tocar", cabeçalho alinhado, documentação de contexto. O servidor já está publicado.
- [ ] **1.3 Criar o ID do cliente OAuth do Google** — Você. Passo a passo em [deploy.md → Organização](deploy.md#organização-entrar-com-google). Origens: domínio da Vercel, domínio próprio, site do Elementor e `http://localhost:5173`.
- [ ] **1.4 Preencher `GOOGLE_CLIENT_ID`** — Agente, depois do 1.3: `index.html` e `servidor/wrangler.jsonc` (`vars`), `npx wrangler deploy`, regenerar o Elementor, novo carimbo `app-build`. Aceite: "Sou da organização" mostra o botão do Google e os três e-mails ganham o selo.
- [ ] **1.5 Ensaio com gente de verdade** — Você + Agente. 10–30 pessoas na sala `teste` (`?sala=teste`) por 15 min; o agente acompanha `/admin/estado` e as métricas da Cloudflare e anota o consumo real de cota no [historico.md](historico.md).

## 2. Decisões pendentes

- [ ] **2.1 Compradores de "apenas palestra"** — Você decide. O importador aceita qualquer venda aprovada; havia 4 compradores só da palestra. Ficam com VIP (coroa + mesa de DJ)? Se não: Agente cria `--produto` no `tools/importar-ingressos.py` e reimporta com `--substituir`.
- [ ] **2.2 Desligar o Firebase** — Você decide, depois de alguns dias estável. A coleção `partyVotes` tem votos de antes da migração: exportar se quiser a curadoria antiga. Depois: Agente remove o `firestore.rules` e as menções restantes; Você desativa o projeto (ou só a chave de serviço).
- [ ] **2.3 Restringir origens** — Você informa os domínios finais; Agente preenche `ORIGENS` no `wrangler.jsonc` (vazio = qualquer site pode abrir a sala).
- [ ] **2.4 Data e horário do evento** — Você informa; entram no [operacao-evento.md](operacao-evento.md). A cota da Cloudflare zera às 21:00 de Brasília.

## 3. Higiene e segurança

- [ ] **3.1 Arquivos sensíveis fora de Downloads** — Você. A chave da conta de serviço do Firebase (`auvp-privateday-firebase-adminsdk-*.json`) não é mais usada: apague ou revogue depois do 2.2. As planilhas do Guru (`Downloads\Editáveis\`) têm e-mails de compradores: guarde num lugar com acesso restrito.
- [ ] **3.2 Cofre para a `ADMIN_CHAVE`** — Você. Copiar `servidor/.chave-admin-producao` para o gerenciador de senhas da equipe (sem ela não dá para importar ingressos).

## 4. Melhorias (não bloqueiam o evento)

- [ ] **4.1 Limitar avatares desenhados no celular** — Agente. Com centenas na pista, desenhar no celular só ~60 (o DJ, você, quem fala no chat, os mais próximos), mantendo a contagem total.
- [ ] **4.2 Hospedar a fonte DiscoDiva** junto do app (hoje vem de `raw.githubusercontent.com`) — Agente.
- [ ] **4.3 Reduzir o `GLOBO.png`** (~360 KB) — Agente.
- [ ] **4.4 CSS do Tailwind gerado** em vez do CDN (some o aviso de produção e a página pinta antes) — Agente, junto com o 5.1 (precisa de um passo de build).
- [ ] **4.5 Pedido do `mural-de-recados`** (outro repositório): mostrar as métricas do verso logo abaixo do recado, sem virar o card — Agente, numa sessão daquele repositório.

## 5. Automação

Cada item vira um PR próprio.

- [ ] **5.1 CI de verificação (GitHub Actions)** — Agente. Em todo PR:
  - `node --check` no JS extraído do `index.html`;
  - `npx tsc --noEmit -p servidor`;
  - `wrangler dev` + `node servidor/teste/fluxo.mjs`, com `SEGREDO`/`ADMIN_CHAVE` de teste gerados no job;
  - Elementor em dia: `python tools/build-elementor.py` e `git diff --exit-code`.
- [ ] **5.2 Deploy automático do servidor** — Agente monta; Você cria o token (Cloudflare → API Tokens → "Edit Cloudflare Workers") e salva como secret `CLOUDFLARE_API_TOKEN` no GitHub. Ao mergear na `main` com mudança em `servidor/`, roda `wrangler deploy`. **Trava de evento**: não publica se a variável do repositório `EVENTO_AO_VIVO` for `1`.
- [ ] **5.3 Importação de ingressos automática** — depende do Guru. Com API/webhook de vendas: job agendado (GitHub Actions ou Worker com Cron Trigger) busca as vendas aprovadas, calcula os hashes e envia ao `/admin/ingressos` com `substituir`. Sem API: continua manual com o `tools/importar-ingressos.py`.
- [ ] **5.4 Monitor do evento** — Agente. `servidor/teste/monitor.mjs` consulta `/admin/estado` a cada 30 s e alerta (Slack/e-mail) se a sala cair, se o público despencar ou se a cota do dia passar de 70%.
- [ ] **5.5 Carimbo de build automático** — Agente. O CI preenche `app-build` com data + hash curto do commit.

## Como retomar numa sessão nova

1. Ler o [CLAUDE.md](../CLAUDE.md) e este plano.
2. `git pull` na `main` e criar uma branch nova para o item.
3. Servidor: `cd servidor && npm install`; criar `servidor/.dev.vars` com `SEGREDO`, `ADMIN_CHAVE` e `ADMINS` (valores de teste); `npm run dev`; `node teste/fluxo.mjs`.
4. App: `python -m http.server 5173` na raiz e abrir `http://localhost:5173/?servidor=local&sala=teste`. No Claude Code há configurações prontas em `.claude/launch.json` (`esquenta-estatico` e `servidor-local`).
5. Publicar o servidor exige `npx wrangler login` na conta da Cloudflare (uma vez por máquina) e **nunca durante o evento**.

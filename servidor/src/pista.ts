// A sala inteira num Durable Object: presença, chat, fila, player, votos, contagem,
// papos privados, reações, ranking, ingressos e organização.
//
// O servidor é o dono da música: contagem, limite de 10 min, fim do vídeo, DJ ausente e
// faxina da fila acontecem aqui (alarmes sobrevivem à hibernação). Não existe mais
// "líder" entre os navegadores.
//
// Tudo que vai para todos sai agrupado num `tick` a cada FLUSH_MS no máximo; respostas
// e mensagens privadas saem na hora, só para quem interessa.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import {
    type Avatar, censurar, hashValido, idValido, limparPerfil, naAreaVip, novoId, pct,
    REACOES, REACOES_VIP, texto, videoIdValido,
} from './regras';
import { verificarGoogle } from './google';

const FLUSH_MS = 250;
const MAX_PESSOAS = 1500;
const MAX_MSG = 4096;
const JANELA_MS = 5000, LIMITE_JANELA = 30, LIMITE_DERRUBA = 90;
const SILENCIO_MAX_MS = 90_000;     // sem mensagem nem ping nesse tempo = conexão morta
const GRACE_SAIDA_MS = 20_000;      // recarregar a página não tira ninguém da mesa nem da fila
const AWAY_GRACE_MS = 45_000;       // fora da tela além disso = fora da pista
const VERIFICAR_MS = 15_000;        // ronda enquanto há gente ou música
const MAX_PLAY_MS = 10 * 60 * 1000; // todo vídeo sai ao completar 10 min
const COUNTDOWN_MS = 5000;
const DJ_RESPIRO_MS = 30_000;       // começo da música: dá tempo do DJ carregar
const FIM_ESPERA_MS = 8000;         // fim informado por quem não é o DJ: espera o DJ confirmar
const ERRO_ESPERA_MS = 6000;
// música do DJ pausada por mais de PAUSA_MAX_MS passa a vez: a contagem abre na metade
// do caminho (aviso de 5 s) e some se o DJ voltar a tocar
const PAUSA_MAX_MS = 10_000;
const PAUSA_AVISO_MS = PAUSA_MAX_MS - COUNTDOWN_MS;
const CHAT_MAX = 50, CHAT_GUARDADO = 300;
const FILA_POR_PESSOA = 3;
const RX_POR_TICK = 12;
const BAN_MS = 30 * 60 * 1000;
const RANKING_CACHE_MS = 60_000;
// intervalo mínimo entre ações da mesma pessoa
const ESPERA: Record<string, number> = {
    chat: 1000, dm: 500, reacao: 1200, fila: 3000, festa: 1000, pular: 1000,
    papo: 2000, ingresso: 2000, org: 3000, ranking: 2000, playback: 400,
};

interface Pessoa {
    id: string; name: string; color: string; avatarConfig: Avatar; dance: string;
    isVIP: boolean; isOrg: boolean; x: number; y: number; away: boolean; awaySince: number;
}
interface Anexo { id: string; p: Pessoa }
interface Conexao { ws: WebSocket | null; p: Pessoa; saiuEm: number }
interface Cota { ini: number; n: number; visto: number }
interface ItemFila {
    id: string; videoId: string; title: string | null; addedByName: string;
    addedByUid: string; addedByVIP: true; timestamp: number;
    duracao: number | null; // segundos, medida pelo app (quem passa de 10 min ganha aviso)
}
interface EstadoVideo {
    videoId: string | null; startedAt: number | null; addedByUid: string | null;
    addedByName: string | null; title: string | null;
}
interface Contagem {
    endsAt: number; reason: string; por: string | null; cancelavel: boolean;
    acao: { chave: string; preferido: string | null };
    tipo?: 'pausa';
}
interface Player {
    state: EstadoVideo;
    skipVotes: { videoId: string | null; votes: Record<string, true> };
    countdown: Contagem | null;
    playback: { videoId: string; state: 'playing' | 'paused'; time: number; at: number } | null;
}
interface MsgChat {
    id: string; uid: string; name: string; isVIP: boolean; isOrg: boolean;
    color: string; text: string; timestamp: number;
}
interface Papo {
    id: string; a: string; b: string; participants: [string, string]; requestedBy: string;
    requestedByName: string; status: 'pending' | 'accepted' | 'declined'; timestamp: number;
}

const VIDEO_VAZIO: EstadoVideo = { videoId: null, startedAt: null, addedByUid: null, addedByName: null, title: null };
const conv = (a: string, b: string) => [a, b].sort().join('_');

export class Pista extends DurableObject<Env> {
    private sql: SqlStorage;
    private conexoes = new Map<string, Conexao>();
    private cotas = new WeakMap<WebSocket, Cota>();
    private ultimaAcao = new Map<string, number>();
    private chave: CryptoKey | null = null;

    // estado da sala (guardado no SQLite, menos a presença, que vive nos anexos dos sockets)
    private fila: ItemFila[] = [];
    private player: Player = { state: { ...VIDEO_VAZIO }, skipVotes: { videoId: null, votes: {} }, countdown: null, playback: null };
    private chat: MsgChat[] = [];
    private festaN = 0;
    private fimInformado = { desde: 0, quem: new Set<string>() };
    private erroInformado = { desde: 0, quem: new Set<string>() };
    private pausadoDesde = 0; // quando a música do DJ parou (republicar "pausado" não reinicia)
    private ranking: { em: number; dados: unknown } | null = null;

    // o que mudou desde o último tick
    private mudouPos = new Set<string>();
    private mudouTudo = new Set<string>();
    private saiu = new Set<string>();
    private chatNovo: MsgChat[] = [];
    private chatApagado: string[] = [];
    private rx: [string, number, number, string][] = [];
    private filaSuja = false;
    private playerSujo = false;
    private festaSuja = false;
    private reset = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private alarmeEm = 0;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.sql.exec(`
            CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT);
            CREATE TABLE IF NOT EXISTS chat (id TEXT PRIMARY KEY, uid TEXT, ts INTEGER, dados TEXT);
            CREATE TABLE IF NOT EXISTS dm (id TEXT PRIMARY KEY, conv TEXT, de TEXT, para TEXT, ts INTEGER, dados TEXT);
            CREATE INDEX IF NOT EXISTS dm_de ON dm(de);
            CREATE INDEX IF NOT EXISTS dm_para ON dm(para);
            CREATE TABLE IF NOT EXISTS papos (id TEXT PRIMARY KEY, a TEXT, b TEXT, dados TEXT);
            CREATE INDEX IF NOT EXISTS papos_a ON papos(a);
            CREATE INDEX IF NOT EXISTS papos_b ON papos(b);
            CREATE TABLE IF NOT EXISTS historico (ts INTEGER, video TEXT, uid TEXT, nome TEXT, titulo TEXT);
            CREATE TABLE IF NOT EXISTS festa (video TEXT, uid TEXT, ts INTEGER, PRIMARY KEY (video, uid));
            CREATE TABLE IF NOT EXISTS ingressos (hash TEXT PRIMARY KEY, manual INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS vip (id TEXT PRIMARY KEY, hash TEXT);
            CREATE TABLE IF NOT EXISTS org (id TEXT PRIMARY KEY, email TEXT);
            CREATE TABLE IF NOT EXISTS banidos (id TEXT PRIMARY KEY, ate INTEGER);
        `);
        // salas criadas antes da marca de "manual" (cortesia): a coluna entra depois
        try { this.sql.exec('ALTER TABLE ingressos ADD COLUMN manual INTEGER DEFAULT 0'); } catch { /* já existe */ }
        for (const r of this.sql.exec<{ chave: string; valor: string }>('SELECT chave, valor FROM estado')) {
            if (r.chave === 'fila') this.fila = JSON.parse(r.valor);
            if (r.chave === 'player') this.player = JSON.parse(r.valor);
        }
        this.chat = this.sql.exec<{ dados: string }>('SELECT dados FROM chat ORDER BY ts DESC LIMIT ?', CHAT_MAX)
            .toArray().map(r => JSON.parse(r.dados)).reverse();
        this.festaN = this.contarFesta();

        // ping/pong respondido pelo runtime, sem acordar o objeto nem contar requisição
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        // voltando da hibernação: a pista é remontada dos anexos; quem saiu enquanto o
        // objeto dormia não está mais aqui, então o próximo tick manda a pista inteira
        for (const ws of ctx.getWebSockets()) {
            const a = ws.deserializeAttachment() as Anexo | null;
            if (a?.id) this.conexoes.set(a.id, { ws, p: a.p, saiuEm: 0 });
        }
        if (this.conexoes.size) this.reset = true;
    }

    // ── HTTP: conexão, diagnóstico e importação de ingressos ──
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === '/onde') {
            let colo = '?';
            try {
                const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
                colo = trace.match(/^colo=.*$/m)?.[0] ?? '?';
            } catch (e) { colo = 'erro: ' + String(e); }
            return new Response(colo, { headers: { 'access-control-allow-origin': '*' } });
        }
        if (url.pathname === '/admin/ingressos') return this.importarIngressos(req);
        // reserva do "Entrar com Google" (e usado pelos testes): dá o selo a uma identidade
        if (url.pathname === '/admin/org' && req.method === 'POST') {
            const { id, email } = await req.json<{ id?: unknown; email?: unknown }>();
            if (!idValido(id)) return new Response('id inválido', { status: 400 });
            this.sql.exec('INSERT OR REPLACE INTO org (id, email) VALUES (?, ?)', id, texto(email, 120) || 'manual');
            const c = this.conexoes.get(id);
            if (c) { c.p.isOrg = true; this.atualizarEu(c); }
            return Response.json({ ok: true });
        }
        // curadoria "Essa vai pra festa!" e histórico completos, para guardar depois do evento
        if (url.pathname === '/admin/exportar') {
            return Response.json({
                festa: this.sql.exec('SELECT video, COUNT(*) AS votos FROM festa GROUP BY video ORDER BY votos DESC').toArray(),
                historico: this.sql.exec('SELECT ts, video, uid, nome, titulo FROM historico ORDER BY ts').toArray(),
            });
        }
        if (url.pathname === '/admin/estado') {
            return Response.json({
                conexoes: this.ctx.getWebSockets().length, pessoas: this.conexoes.size,
                fila: this.fila.length, player: this.player.state, chat: this.chat.length,
                ingressos: this.sql.exec('SELECT COUNT(*) AS n FROM ingressos').one().n,
            });
        }
        if (this.ctx.getWebSockets().length >= MAX_PESSOAS) return new Response('sala cheia', { status: 503 });
        const par = new WebSocketPair();
        this.ctx.acceptWebSocket(par[1]);
        this.agendarAlarme();
        return new Response(null, { status: 101, webSocket: par[0] });
    }

    private async importarIngressos(req: Request): Promise<Response> {
        if (req.method === 'GET') return Response.json({ ingressos: this.sql.exec('SELECT COUNT(*) AS n FROM ingressos').one().n });
        // `manuais` (cortesia, convidado, equipe) nunca saem com `substituir`; `substituir` tira
        // da lista quem não está mais na planilha (reembolso) — e essa pessoa perde o VIP na
        // próxima conexão, porque o vínculo só vale com o ingresso ainda na lista
        const corpo = await req.json<{ hashes?: unknown[]; manuais?: unknown[]; substituir?: boolean; remover?: unknown[] }>();
        const hashes = (corpo.hashes || []).filter(hashValido);
        const manuais = (corpo.manuais || []).filter(hashValido);
        const remover = (corpo.remover || []).filter(hashValido);
        const antes = Number(this.sql.exec('SELECT COUNT(*) AS n FROM ingressos').one().n);
        let removidos = 0;
        this.ctx.storage.transactionSync(() => {
            if (corpo.substituir) {
                removidos = this.sql.exec('DELETE FROM ingressos WHERE manual = 0 AND hash NOT IN (SELECT value FROM json_each(?))',
                    JSON.stringify(hashes)).rowsWritten;
            }
            for (const h of hashes) this.sql.exec('INSERT INTO ingressos (hash, manual) VALUES (?, 0) ON CONFLICT(hash) DO NOTHING', h);
            for (const h of manuais) this.sql.exec('INSERT INTO ingressos (hash, manual) VALUES (?, 1) ON CONFLICT(hash) DO UPDATE SET manual = 1', h);
            for (const h of remover) removidos += this.sql.exec('DELETE FROM ingressos WHERE hash = ?', h).rowsWritten;
        });
        const total = Number(this.sql.exec('SELECT COUNT(*) AS n FROM ingressos').one().n);
        return Response.json({ ok: true, ingressos: total, novos: total - antes + removidos, removidos });
    }

    // ── WEBSOCKET ──
    async webSocketMessage(ws: WebSocket, dado: string | ArrayBuffer) {
        if (typeof dado !== 'string' || dado.length > MAX_MSG) return this.derrubar(ws, 1009, 'mensagem inválida');
        const t = Date.now();
        const cota = this.cotas.get(ws) ?? { ini: t, n: 0, visto: 0 };
        this.cotas.set(ws, cota);
        cota.visto = t;
        if (t - cota.ini > JANELA_MS) { cota.ini = t; cota.n = 0; }
        if (++cota.n > LIMITE_DERRUBA) return this.derrubar(ws, 4008, 'mensagens demais');
        if (cota.n > LIMITE_JANELA) return;

        let m: any;
        try { m = JSON.parse(dado); } catch { return; }
        if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;

        if (m.t === 'hora') return this.enviar(ws, { t: 'hora', c: Number(m.c) || 0, s: Date.now() });
        if (m.t === 'ola') return this.ola(ws, m);

        const a = ws.deserializeAttachment() as Anexo | null;
        const c = a?.id ? this.conexoes.get(a.id) : undefined;
        if (!c || c.ws !== ws) return; // ainda não se apresentou (ou foi substituído)
        const p = c.p;
        if (ESPERA[m.t] && !this.liberado(p.id, m.t)) return this.recusar(ws, m, 'devagar', 'Calma! Espere um instante e tente de novo.');

        switch (m.t) {
            case 'mover': {
                const x = pct(m.x), y = pct(m.y);
                if (x === null || y === null || (x === p.x && y === p.y)) return;
                if (naAreaVip(x, y) && !p.isVIP) return;
                p.x = x; p.y = y;
                this.mudouPos.add(p.id);
                break;
            }
            case 'perfil': {
                const novo = limparPerfil(m.perfil);
                Object.assign(p, novo);
                this.mudouTudo.add(p.id);
                break;
            }
            case 'ausente': {
                const v = !!m.v;
                if (p.away === v) return;
                p.away = v;
                p.awaySince = v ? Date.now() : 0;
                this.mudouTudo.add(p.id);
                this.verificar();
                break;
            }
            case 'chat': return this.msgChat(ws, p, m);
            case 'fila': return this.entrarNaFila(ws, p, m);
            case 'sairFila': return this.sairDaFila(ws, p, m);
            case 'pular': return this.votarPular(ws, p, m);
            case 'passarVez': return this.passarVez(ws, p, m);
            case 'cancelar': return this.cancelarContagem(ws, p, m);
            case 'festa': return this.votarFesta(ws, p, m);
            case 'playback': return this.receberPlayback(p, m);
            case 'fim': return this.fimDoVideo(p, m);
            case 'erroVideo': return this.erroDoVideo(p, m);
            case 'reacao': return this.reagir(p, m);
            case 'papo': return this.pedirPapo(ws, p, m);
            case 'aceitar': return this.responderPapo(ws, p, m, 'accepted');
            case 'recusar': return this.responderPapo(ws, p, m, 'declined');
            case 'dm': return this.msgPrivada(ws, p, m);
            case 'ingresso': return this.confirmarIngresso(ws, c, m);
            case 'ranking': return this.enviarRanking(ws, m);
            case 'org': return this.entrarOrg(ws, c, m);
            case 'orgSair': return this.sairOrg(ws, c, m);
            case 'admPular': return this.admPular(ws, p, m);
            case 'admRemoverFila': return this.admRemoverFila(ws, p, m);
            case 'admApagarChat': return this.admApagarChat(ws, p, m);
            case 'admExpulsar': return this.admExpulsar(ws, p, m);
            default: return;
        }
        ws.serializeAttachment({ id: p.id, p } satisfies Anexo);
        this.agendarFlush();
    }

    async webSocketClose(ws: WebSocket) { this.sair(ws); }
    async webSocketError(ws: WebSocket) { this.sair(ws); }

    async alarm() {
        this.alarmeEm = 0;
        const agora = Date.now();
        for (const ws of this.ctx.getWebSockets()) {
            const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
            const msg = this.cotas.get(ws)?.visto ?? 0;
            // cota some na hibernação: sem registro nenhum, dá o benefício da dúvida
            if (!ping && !msg) continue;
            if (agora - Math.max(ping, msg) > SILENCIO_MAX_MS) this.derrubar(ws, 4001, 'sem sinal');
        }
        this.verificar();
    }

    // ── APRESENTAÇÃO ──
    private async ola(ws: WebSocket, m: any) {
        if ((ws.deserializeAttachment() as Anexo | null)?.id) return; // já se apresentou
        if (!this.env.SEGREDO) return this.derrubar(ws, 1011, 'servidor sem SEGREDO');
        let id = idValido(m.id) ? m.id : '';
        if (!id || typeof m.token !== 'string' || m.token !== await this.assinar(id)) id = novoId();

        const ban = this.sql.exec<{ ate: number }>('SELECT ate FROM banidos WHERE id = ?', id).toArray()[0];
        if (ban && ban.ate > Date.now()) {
            this.enviar(ws, { t: 'removido', ate: ban.ate });
            try { ws.close(4003, 'removido pela organização'); } catch {}
            return;
        }

        // mesma pessoa em outra aba: a conexão antiga sai, a pessoa continua na pista
        const antiga = this.conexoes.get(id);
        if (antiga?.ws && antiga.ws !== ws) {
            const velho = antiga.ws;
            antiga.ws = null;
            this.enviar(velho, { t: 'outraAba' });
            try { velho.close(4000, 'aberto em outra aba'); } catch {}
        }
        const x = pct(m.x), y = pct(m.y);
        const p: Pessoa = antiga?.p ?? {
            id, name: 'Investidor', color: '#DB7944', avatarConfig: {}, dance: '', isVIP: false, isOrg: false,
            x: x ?? 20 + Math.random() * 50, y: y ?? 30 + Math.random() * 50, away: false, awaySince: 0,
        };
        Object.assign(p, limparPerfil(m.perfil));
        p.away = !!m.away;
        p.awaySince = p.away ? Date.now() : 0;
        p.isOrg = this.sql.exec('SELECT 1 FROM org WHERE id = ?', id).toArray().length > 0;
        // vínculo só vale com o ingresso ainda na lista (reembolso tira o VIP)
        p.isVIP = this.sql.exec('SELECT 1 FROM vip JOIN ingressos USING (hash) WHERE vip.id = ?', id).toArray().length > 0;
        // ingresso guardado no navegador refaz o vínculo (outro aparelho, identidade nova)
        if (!p.isVIP && hashValido(m.ingresso) && this.ingressoExiste(m.ingresso)) {
            this.sql.exec('INSERT OR REPLACE INTO vip (id, hash) VALUES (?, ?)', id, m.ingresso);
            p.isVIP = true;
        }
        if (naAreaVip(p.x, p.y) && !p.isVIP) { p.x = 50; p.y = 60; }

        ws.serializeAttachment({ id, p } satisfies Anexo);
        this.conexoes.set(id, { ws, p, saiuEm: 0 });
        this.saiu.delete(id);
        this.mudouTudo.add(id);

        const dms = this.sql.exec<{ dados: string }>(
            'SELECT dados FROM dm WHERE de = ?1 OR para = ?1 ORDER BY ts DESC LIMIT 200', id)
            .toArray().map(r => JSON.parse(r.dados)).reverse();
        const papos = this.sql.exec<{ dados: string }>('SELECT dados FROM papos WHERE a = ?1 OR b = ?1', id)
            .toArray().map(r => JSON.parse(r.dados));
        const vid = this.player.state.videoId;
        this.enviar(ws, {
            t: 'bemvindo', id, token: await this.assinar(id), agora: Date.now(),
            eu: { isVIP: p.isVIP, isOrg: p.isOrg },
            users: [...this.conexoes.values()].map(c => c.p),
            chat: this.chat, fila: this.fila, player: this.playerPublico(),
            festa: {
                videoId: vid, n: this.festaN,
                votei: !!vid && this.sql.exec('SELECT 1 FROM festa WHERE video = ? AND uid = ?', vid, id).toArray().length > 0,
            },
            dms, papos,
        });
        this.verificar(); // o DJ voltou? a fila tem dono de novo?
        this.agendarFlush();
    }

    private sair(ws: WebSocket) {
        const a = ws.deserializeAttachment() as Anexo | null;
        try { ws.close(1000, 'tchau'); } catch {}
        if (!a?.id) return;
        const c = this.conexoes.get(a.id);
        if (!c || c.ws !== ws) return;
        // fica na pista por GRACE_SAIDA_MS: quem só recarregou não perde a mesa
        c.ws = null;
        c.saiuEm = Date.now();
        this.agendarAlarme();
    }

    private remover(id: string) {
        if (!this.conexoes.delete(id)) return;
        this.mudouPos.delete(id);
        this.mudouTudo.delete(id);
        this.saiu.add(id);
        this.agendarFlush();
    }

    // ── PRESENÇA ──
    // presente = conectado (ou recarregando, dentro da tolerância) e com a tela à vista
    private presente(id: string | null): boolean {
        if (!id) return false;
        const c = this.conexoes.get(id);
        if (!c) return false;
        return !(c.p.away && Date.now() - c.p.awaySince > AWAY_GRACE_MS);
    }
    private nome(id: string | null, padrao = 'Investidor') { return (id && this.conexoes.get(id)?.p.name) || padrao; }

    // ── CHAT ──
    private msgChat(ws: WebSocket, p: Pessoa, m: any) {
        const t = texto(m.text, 300);
        if (!t) return this.recusar(ws, m, 'vazio');
        const msg: MsgChat = {
            id: novoId(), uid: p.id, name: p.name, isVIP: p.isVIP, isOrg: p.isOrg,
            color: p.color, text: censurar(t), timestamp: Date.now(),
        };
        this.chat.push(msg);
        if (this.chat.length > CHAT_MAX) this.chat.splice(0, this.chat.length - CHAT_MAX);
        this.chatNovo.push(msg);
        this.sql.exec('INSERT INTO chat (id, uid, ts, dados) VALUES (?, ?, ?, ?)', msg.id, msg.uid, msg.timestamp, JSON.stringify(msg));
        if (Math.random() < 0.05) {
            this.sql.exec('DELETE FROM chat WHERE ts < (SELECT ts FROM chat ORDER BY ts DESC LIMIT 1 OFFSET ?)', CHAT_GUARDADO);
        }
        this.responder(ws, m);
        this.agendarFlush();
    }

    private apagarChat(ids: Set<string>) {
        if (!ids.size) return;
        this.chat = this.chat.filter(c => !ids.has(c.id));
        for (const id of ids) {
            this.sql.exec('DELETE FROM chat WHERE id = ?', id);
            this.chatApagado.push(id);
        }
        this.chatNovo = this.chatNovo.filter(c => !ids.has(c.id));
        this.agendarFlush();
    }

    // ── FILA ──
    private entrarNaFila(ws: WebSocket, p: Pessoa, m: any) {
        if (!p.isVIP) return this.recusar(ws, m, 'sem_ingresso', 'A mesa de DJ é só pra quem tem ingresso do Private Day.');
        if (!videoIdValido(m.videoId)) return this.recusar(ws, m, 'link', 'Link não reconhecido.');
        if (this.player.state.videoId === m.videoId || this.fila.some(i => i.videoId === m.videoId)) {
            return this.recusar(ws, m, 'repetida', 'Essa música já está tocando ou na fila. Que tal outra?');
        }
        if (this.fila.filter(i => i.addedByUid === p.id).length >= FILA_POR_PESSOA) {
            return this.recusar(ws, m, 'limite', `Você já tem ${FILA_POR_PESSOA} músicas na fila. Espere uma tocar!`);
        }
        const item: ItemFila = {
            id: novoId(), videoId: m.videoId, title: texto(m.title, 150) || null,
            addedByName: p.name, addedByUid: p.id, addedByVIP: true, timestamp: Date.now(),
            duracao: Number.isFinite(m.duracao) && m.duracao > 0 && m.duracao <= 86400 ? Math.round(m.duracao) : null,
        };
        this.fila.push(item);
        this.filaMudou();
        const entraAgora = !this.player.state.videoId;
        if (entraAgora) this.contagem(`Música de ${p.name} entrando na pista!`, { preferido: item.id });
        this.responder(ws, m, { id: item.id, posicao: this.fila.indexOf(item) + 1, entraAgora });
    }

    private sairDaFila(ws: WebSocket, p: Pessoa, m: any) {
        const antes = this.fila.length;
        this.fila = this.fila.filter(i => !(i.id === m.id && i.addedByUid === p.id));
        if (this.fila.length !== antes) this.filaMudou();
        this.responder(ws, m);
    }

    private filaMudou() {
        this.filaSuja = true;
        this.salvar('fila');
        this.agendarFlush();
        this.agendarAlarme();
    }

    // ── PLAYER ──
    private chaveAtual() {
        const s = this.player.state;
        return `${s.videoId || 'fallback'}_${s.startedAt || 0}`;
    }

    private playerPublico() {
        const { countdown, ...resto } = this.player;
        return {
            ...resto,
            countdown: countdown && countdown.endsAt > Date.now()
                ? { endsAt: countdown.endsAt, reason: countdown.reason, por: countdown.por, cancelavel: countdown.cancelavel, tipo: countdown.tipo }
                : null,
        };
    }

    private playerMudou() {
        this.playerSujo = true;
        this.salvar('player');
        this.agendarFlush();
        this.agendarAlarme();
    }

    // Troca de música: só avança se a sala ainda estiver na música que motivou a troca.
    // Quem saiu da tela perde a vez (menos o `preferido`, que acabou de enviar).
    private avancar(chave: string, preferido: string | null = null) {
        if (chave !== this.chaveAtual()) return false;
        const agora = Date.now();
        const atual = this.player.state;
        const ordem = preferido
            ? [...this.fila.filter(i => i.id === preferido), ...this.fila.filter(i => i.id !== preferido)]
            : [...this.fila];
        let escolhido: ItemFila | null = null;
        const descartar = new Set<string>();
        for (const i of ordem) {
            if (i.id !== preferido && !this.presente(i.addedByUid)) { descartar.add(i.id); continue; }
            escolhido = i;
            break;
        }
        if (!escolhido && !atual.videoId && !descartar.size) return false; // já na playlist da casa
        this.fila = this.fila.filter(i => !descartar.has(i.id) && i.id !== escolhido?.id);
        if (escolhido) {
            this.player.state = {
                videoId: escolhido.videoId, startedAt: agora, addedByUid: escolhido.addedByUid,
                addedByName: escolhido.addedByName, title: escolhido.title,
            };
            this.player.skipVotes = { videoId: escolhido.videoId, votes: {} };
            this.player.playback = { videoId: escolhido.videoId, state: 'playing', time: 0, at: agora };
            this.sql.exec('INSERT INTO historico (ts, video, uid, nome, titulo) VALUES (?, ?, ?, ?, ?)',
                agora, escolhido.videoId, escolhido.addedByUid, escolhido.addedByName, escolhido.title);
        } else {
            this.player.state = { ...VIDEO_VAZIO };
            this.player.skipVotes = { videoId: null, votes: {} };
            this.player.playback = null;
        }
        this.player.countdown = null;
        this.fimInformado = { desde: 0, quem: new Set() };
        this.erroInformado = { desde: 0, quem: new Set() };
        this.pausadoDesde = 0;
        this.festaN = this.contarFesta();
        this.festaSuja = true;
        this.filaSuja = true;
        this.salvar('fila');
        this.playerMudou();
        return true;
    }

    // contagem regressiva sincronizada: só uma por vez; ao fim, o servidor executa a troca
    private contagem(reason: string, { por = null, cancelavel = false, preferido = null, tipo }:
        { por?: string | null; cancelavel?: boolean; preferido?: string | null; tipo?: 'pausa' } = {}) {
        const cd = this.player.countdown;
        if (cd && cd.endsAt > Date.now()) return false;
        this.player.countdown = {
            endsAt: Date.now() + COUNTDOWN_MS, reason, por, cancelavel,
            acao: { chave: this.chaveAtual(), preferido }, tipo,
        };
        this.playerMudou();
        return true;
    }

    private votarPular(ws: WebSocket, p: Pessoa, m: any) {
        const s = this.player.state;
        if (!s.videoId) return this.recusar(ws, m, 'sem_musica');
        if (this.player.countdown) return this.responder(ws, m);
        if (this.player.skipVotes.videoId !== s.videoId) this.player.skipVotes = { videoId: s.videoId, votes: {} };
        this.player.skipVotes.votes[p.id] = true;
        this.playerMudou();
        this.responder(ws, m);
        this.verificar();
    }

    private limiarPular() {
        const dj = this.player.state.addedByUid;
        let ouvintes = 0;
        for (const [id] of this.conexoes) if (id !== dj && this.presente(id)) ouvintes++;
        // no mínimo 2 votos: com pouca gente, um voto sozinho tirava a música de qualquer DJ
        return Math.max(2, Math.min(10, Math.floor(ouvintes / 2) + 1));
    }

    private votosPular() {
        const sv = this.player.skipVotes;
        return sv.videoId && sv.videoId === this.player.state.videoId ? Object.keys(sv.votes).length : 0;
    }

    private passarVez(ws: WebSocket, p: Pessoa, m: any) {
        if (this.player.state.addedByUid !== p.id) return this.recusar(ws, m, 'nao_dj');
        this.contagem('O DJ passou a vez!', { por: p.id, cancelavel: true });
        this.responder(ws, m);
    }

    private cancelarContagem(ws: WebSocket, p: Pessoa, m: any) {
        const cd = this.player.countdown;
        if (!cd || !cd.cancelavel || cd.por !== p.id) return this.recusar(ws, m, 'nao_pode');
        this.player.countdown = null;
        this.playerMudou();
        this.responder(ws, m);
    }

    private votarFesta(ws: WebSocket, p: Pessoa, m: any) {
        const vid = this.player.state.videoId;
        if (!vid) return this.recusar(ws, m, 'sem_musica');
        const r = this.sql.exec('INSERT OR IGNORE INTO festa (video, uid, ts) VALUES (?, ?, ?)', vid, p.id, Date.now());
        if (r.rowsWritten) { this.festaN++; this.festaSuja = true; this.ranking = null; this.agendarFlush(); }
        this.responder(ws, m, { videoId: vid });
    }

    private contarFesta() {
        const vid = this.player.state.videoId;
        return vid ? Number(this.sql.exec('SELECT COUNT(*) AS n FROM festa WHERE video = ?', vid).one().n) : 0;
    }

    // só o DJ (ou a organização) publica a posição; o resto da pista segue
    private receberPlayback(p: Pessoa, m: any) {
        const s = this.player.state;
        if (!s.videoId || (s.addedByUid !== p.id && !p.isOrg)) return;
        if (m.state !== 'playing' && m.state !== 'paused') return;
        const time = Number(m.time);
        if (!Number.isFinite(time) || time < 0 || time > 6 * 3600) return;
        this.player.playback = { videoId: s.videoId, state: m.state, time, at: Date.now() };
        // posição não precisa sobreviver a um reinício: o DJ republica em 5 s
        this.playerSujo = true;
        if (m.state === 'paused') {
            if (!this.pausadoDesde) { this.pausadoDesde = Date.now(); this.agendarAlarme(); }
        } else {
            this.pausadoDesde = 0;
            // voltou a tocar a tempo: a contagem da pausa some
            if (this.player.countdown?.tipo === 'pausa') { this.player.countdown = null; this.playerMudou(); }
        }
        this.agendarFlush();
    }

    private fimDoVideo(p: Pessoa, m: any) {
        if (m.chave !== this.chaveAtual() || !this.player.state.videoId) return;
        if (p.id === this.player.state.addedByUid && !this.player.countdown) { this.avancar(m.chave); return; }
        if (!this.fimInformado.desde) this.fimInformado.desde = Date.now();
        this.fimInformado.quem.add(p.id);
        this.agendarAlarme();
    }

    private erroDoVideo(p: Pessoa, m: any) {
        if (m.chave !== this.chaveAtual() || !this.player.state.videoId) return;
        if (p.id === this.player.state.addedByUid) { this.contagem('Vídeo indisponível — próxima música!'); return; }
        if (!this.erroInformado.desde) this.erroInformado.desde = Date.now();
        this.erroInformado.quem.add(p.id);
        this.agendarAlarme();
    }

    // Ronda: tudo que antes dependia do "líder". Roda no alarme e depois de eventos.
    private verificar() {
        const agora = Date.now();
        for (const [id, c] of this.conexoes) {
            if (!c.ws && agora - c.saiuEm > GRACE_SAIDA_MS) this.remover(id);
        }

        const cd = this.player.countdown;
        if (cd && cd.endsAt <= agora) {
            this.player.countdown = null;
            if (!this.avancar(cd.acao.chave, cd.acao.preferido)) this.playerMudou();
        }

        const s = this.player.state;
        if (!this.player.countdown) {
            const chave = this.chaveAtual();
            const dj = s.addedByUid;
            if (s.videoId && s.startedAt) {
                const djFora = !this.presente(dj);
                if (agora - s.startedAt >= MAX_PLAY_MS) {
                    this.avancar(chave);
                } else if (agora - s.startedAt > DJ_RESPIRO_MS && djFora) {
                    this.contagem(`${s.addedByName || 'O DJ'} saiu da pista — próxima música!`);
                } else if (this.fimInformado.desde && agora - this.fimInformado.desde >= FIM_ESPERA_MS &&
                    (this.fimInformado.quem.size >= 2 || djFora)) {
                    this.avancar(chave);
                } else if (this.erroInformado.desde && agora - this.erroInformado.desde >= ERRO_ESPERA_MS &&
                    (this.erroInformado.quem.size >= 2 || djFora)) {
                    this.contagem('Vídeo indisponível — próxima música!');
                } else if (this.pausadoDesde && agora - this.pausadoDesde >= PAUSA_AVISO_MS) {
                    this.contagem('A música ficou pausada — próxima da fila!', { tipo: 'pausa' });
                } else if (this.votosPular() >= this.limiarPular()) {
                    this.contagem('A pista votou: próxima música!');
                }
            } else {
                // fila nunca fica órfã: a primeira música de quem está na tela entra
                const prox = this.fila.find(i => this.presente(i.addedByUid));
                if (prox) this.contagem(`Música de ${prox.addedByName} entrando na pista!`, { preferido: prox.id });
            }
        }

        // faxina da fila: quem saiu da pista perde o lugar (com respiro pra quem acabou de enviar)
        const antes = this.fila.length;
        this.fila = this.fila.filter(i => this.presente(i.addedByUid) || agora - i.timestamp < AWAY_GRACE_MS);
        if (this.fila.length !== antes) this.filaMudou();

        this.agendarAlarme();
    }

    private proximoAlarme(): number | null {
        const agora = Date.now();
        const t: number[] = [];
        const cd = this.player.countdown;
        if (cd) t.push(cd.endsAt);
        const s = this.player.state;
        if (s.videoId && s.startedAt) t.push(s.startedAt + MAX_PLAY_MS);
        if (this.fimInformado.desde) t.push(this.fimInformado.desde + FIM_ESPERA_MS);
        if (this.erroInformado.desde) t.push(this.erroInformado.desde + ERRO_ESPERA_MS);
        if (this.pausadoDesde) t.push(this.pausadoDesde + PAUSA_AVISO_MS);
        for (const c of this.conexoes.values()) if (!c.ws) t.push(c.saiuEm + GRACE_SAIDA_MS + 50);
        if (this.conexoes.size || this.ctx.getWebSockets().length || s.videoId || this.fila.length) t.push(agora + VERIFICAR_MS);
        return t.length ? Math.max(agora + 20, Math.min(...t)) : null;
    }

    private agendarAlarme() {
        const alvo = this.proximoAlarme();
        if (alvo === null) return;
        // só regrava se for antes do que já está marcado (ou se o marcado já passou)
        if (this.alarmeEm && this.alarmeEm > Date.now() && this.alarmeEm <= alvo) return;
        this.alarmeEm = alvo;
        void this.ctx.storage.setAlarm(alvo);
    }

    // ── REAÇÕES ──
    private reagir(p: Pessoa, m: any) {
        const vip = REACOES_VIP.has(m.emoji);
        if (!REACOES.has(m.emoji) && !vip) return;
        if (vip && !(p.isVIP && naAreaVip(p.x, p.y))) return;
        if (this.rx.length >= RX_POR_TICK) return; // no auge, o excesso fica só no aparelho de quem mandou
        this.rx.push([m.emoji, p.x, Math.max(0, p.y - 5), p.id]);
        this.agendarFlush();
    }

    // ── PAPO PRIVADO ──
    private pedirPapo(ws: WebSocket, p: Pessoa, m: any) {
        const outro = idValido(m.com) ? this.conexoes.get(m.com) : undefined;
        if (!outro || m.com === p.id) return this.recusar(ws, m, 'ausente', 'Essa pessoa não está mais na pista.');
        const id = conv(p.id, m.com);
        const atual = this.papo(id);
        if (atual?.status === 'accepted') return this.responder(ws, m, { status: 'accepted' });
        if (atual?.status === 'pending' && atual.requestedBy === m.com) return this.responderPapo(ws, p, { ...m, t: 'aceitar' }, 'accepted');
        if (atual?.status === 'pending') return this.responder(ws, m, { status: 'pending' });
        const novo: Papo = {
            id, a: p.id, b: m.com, participants: [p.id, m.com], requestedBy: p.id,
            requestedByName: p.name, status: 'pending', timestamp: Date.now(),
        };
        this.gravarPapo(novo);
        this.responder(ws, m, { status: 'pending' });
    }

    private responderPapo(ws: WebSocket, p: Pessoa, m: any, status: 'accepted' | 'declined') {
        const atual = idValido(m.com) ? this.papo(conv(p.id, m.com)) : null;
        if (!atual || atual.requestedBy === p.id) return this.recusar(ws, m, 'sem_pedido');
        atual.status = status;
        this.gravarPapo(atual);
        this.responder(ws, m, { status });
    }

    private papo(id: string): Papo | null {
        const r = this.sql.exec<{ dados: string }>('SELECT dados FROM papos WHERE id = ?', id).toArray()[0];
        return r ? JSON.parse(r.dados) : null;
    }

    private gravarPapo(papo: Papo) {
        this.sql.exec('INSERT OR REPLACE INTO papos (id, a, b, dados) VALUES (?, ?, ?, ?)', papo.id, papo.a, papo.b, JSON.stringify(papo));
        this.paraParticipantes(papo.participants, { t: 'papo', papo });
    }

    private msgPrivada(ws: WebSocket, p: Pessoa, m: any) {
        if (!idValido(m.para)) return this.recusar(ws, m, 'destino');
        const id = conv(p.id, m.para);
        if (this.papo(id)?.status !== 'accepted') return this.recusar(ws, m, 'nao_aceito', 'O papo ainda não foi aceito.');
        const t = texto(m.text, 500);
        if (!t) return this.recusar(ws, m, 'vazio');
        const msg = {
            id: novoId(), convId: id, from: p.id, fromName: p.name, fromColor: p.color,
            to: m.para, participants: [p.id, m.para], text: censurar(t), timestamp: Date.now(),
        };
        this.sql.exec('INSERT INTO dm (id, conv, de, para, ts, dados) VALUES (?, ?, ?, ?, ?, ?)',
            msg.id, id, p.id, m.para, msg.timestamp, JSON.stringify(msg));
        this.paraParticipantes([p.id, m.para], { t: 'dm', msg });
        this.responder(ws, m);
    }

    private paraParticipantes(ids: string[], obj: unknown) {
        const dado = JSON.stringify(obj);
        for (const id of ids) {
            const c = this.conexoes.get(id);
            if (c?.ws) try { c.ws.send(dado); } catch {}
        }
    }

    // ── INGRESSO ──
    private ingressoExiste(hash: string) {
        return this.sql.exec('SELECT 1 FROM ingressos WHERE hash = ?', hash).toArray().length > 0;
    }

    private confirmarIngresso(ws: WebSocket, c: Conexao, m: any) {
        if (!hashValido(m.hash)) return this.recusar(ws, m, 'hash');
        if (!this.ingressoExiste(m.hash)) return this.recusar(ws, m, 'nao_encontrado');
        this.sql.exec('INSERT OR REPLACE INTO vip (id, hash) VALUES (?, ?)', c.p.id, m.hash);
        c.p.isVIP = true;
        this.atualizarEu(c);
        this.responder(ws, m);
    }

    private atualizarEu(c: Conexao) {
        if (c.ws) {
            c.ws.serializeAttachment({ id: c.p.id, p: c.p } satisfies Anexo);
            this.enviar(c.ws, { t: 'eu', isVIP: c.p.isVIP, isOrg: c.p.isOrg });
        }
        this.mudouTudo.add(c.p.id);
        this.agendarFlush();
    }

    // ── RANKING (lido sob demanda, com cache: cada leitura varre as tabelas) ──
    private enviarRanking(ws: WebSocket, m: any) {
        if (!this.ranking || Date.now() - this.ranking.em > RANKING_CACHE_MS) {
            const djs = this.sql.exec<{ nome: string; n: number }>(
                'SELECT MAX(nome) AS nome, COUNT(*) AS n FROM historico GROUP BY uid ORDER BY n DESC LIMIT 5').toArray()
                .map(r => ({ name: r.nome, n: r.n }));
            const musicas = this.sql.exec<{ video: string; n: number }>(
                'SELECT video, COUNT(*) AS n FROM festa GROUP BY video ORDER BY n DESC LIMIT 5').toArray()
                .map(r => [r.video, r.n]);
            this.ranking = { em: Date.now(), dados: { djs, musicas } };
        }
        this.responder(ws, m, this.ranking.dados as Record<string, unknown>);
    }

    // ── ORGANIZAÇÃO (Entrar com Google) ──
    private async entrarOrg(ws: WebSocket, c: Conexao, m: any) {
        const admins = (this.env.ADMINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (!this.env.GOOGLE_CLIENT_ID || !admins.length) return this.recusar(ws, m, 'sem_config', 'Login da organização ainda não configurado.');
        let email: string | null = null;
        try { email = typeof m.credential === 'string' ? await verificarGoogle(m.credential, this.env.GOOGLE_CLIENT_ID) : null; }
        catch (e) { return this.recusar(ws, m, 'google', 'Não deu pra falar com o Google agora. Tente de novo.'); }
        if (!email || !admins.includes(email)) return this.recusar(ws, m, 'nao_autorizado', 'Esse e-mail não faz parte da organização.');
        this.sql.exec('INSERT OR REPLACE INTO org (id, email) VALUES (?, ?)', c.p.id, email);
        c.p.isOrg = true;
        this.atualizarEu(c);
        this.responder(ws, m, { email });
    }

    private sairOrg(ws: WebSocket, c: Conexao, m: any) {
        this.sql.exec('DELETE FROM org WHERE id = ?', c.p.id);
        c.p.isOrg = false;
        this.atualizarEu(c);
        this.responder(ws, m);
    }

    private org(ws: WebSocket, p: Pessoa, m: any) {
        if (p.isOrg) return true;
        this.recusar(ws, m, 'nao_org', 'Só a organização pode fazer isso.');
        return false;
    }

    private admPular(ws: WebSocket, p: Pessoa, m: any) {
        if (!this.org(ws, p, m)) return;
        if (!this.player.state.videoId) return this.recusar(ws, m, 'sem_musica', 'Não há música do DJ tocando.');
        this.player.countdown = null;
        this.contagem('A organização passou a música!');
        this.responder(ws, m);
    }

    private admRemoverFila(ws: WebSocket, p: Pessoa, m: any) {
        if (!this.org(ws, p, m)) return;
        const antes = this.fila.length;
        this.fila = this.fila.filter(i => i.id !== m.id);
        if (this.fila.length !== antes) this.filaMudou();
        this.responder(ws, m);
    }

    private admApagarChat(ws: WebSocket, p: Pessoa, m: any) {
        if (!this.org(ws, p, m)) return;
        if (typeof m.id === 'string') this.apagarChat(new Set([m.id]));
        this.responder(ws, m);
    }

    // remove da pista por BAN_MS, apaga as mensagens e tira as músicas da pessoa
    private admExpulsar(ws: WebSocket, p: Pessoa, m: any) {
        if (!this.org(ws, p, m)) return;
        const alvo = m.uid;
        if (!idValido(alvo) || alvo === p.id) return this.recusar(ws, m, 'alvo');
        if (this.conexoes.get(alvo)?.p.isOrg) return this.recusar(ws, m, 'alvo_org', 'Não dá pra remover alguém da organização.');
        this.sql.exec('INSERT OR REPLACE INTO banidos (id, ate) VALUES (?, ?)', alvo, Date.now() + BAN_MS);
        const c = this.conexoes.get(alvo);
        if (c?.ws) {
            this.enviar(c.ws, { t: 'removido', ate: Date.now() + BAN_MS });
            try { c.ws.close(4003, 'removido pela organização'); } catch {}
        }
        this.remover(alvo);
        this.apagarChat(new Set(this.chat.filter(x => x.uid === alvo).map(x => x.id)));
        this.sql.exec('DELETE FROM chat WHERE uid = ?', alvo);
        const antes = this.fila.length;
        this.fila = this.fila.filter(i => i.addedByUid !== alvo);
        if (this.fila.length !== antes) this.filaMudou();
        if (this.player.state.addedByUid === alvo) this.avancar(this.chaveAtual());
        this.responder(ws, m);
    }

    // ── DIFUSÃO ──
    private agendarFlush() {
        if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    }

    private flush() {
        this.timer = null;
        const m: Record<string, unknown> = { t: 'tick', agora: Date.now() };
        if (this.reset) {
            m.reset = true;
            m.tudo = [...this.conexoes.values()].map(c => c.p);
            this.reset = false;
        } else {
            const tudo: Pessoa[] = [], pos: [string, number, number][] = [];
            for (const id of this.mudouTudo) { const c = this.conexoes.get(id); if (c) tudo.push(c.p); }
            for (const id of this.mudouPos) {
                if (this.mudouTudo.has(id)) continue;
                const c = this.conexoes.get(id);
                if (c) pos.push([id, c.p.x, c.p.y]);
            }
            if (tudo.length) m.tudo = tudo;
            if (pos.length) m.pos = pos;
            if (this.saiu.size) m.saiu = [...this.saiu];
        }
        this.mudouPos.clear(); this.mudouTudo.clear(); this.saiu.clear();
        if (this.chatNovo.length) { m.chat = this.chatNovo; this.chatNovo = []; }
        if (this.chatApagado.length) { m.chatApagado = this.chatApagado; this.chatApagado = []; }
        if (this.filaSuja) { m.fila = this.fila; this.filaSuja = false; }
        if (this.playerSujo) { m.player = this.playerPublico(); this.playerSujo = false; }
        if (this.festaSuja) { m.festa = { videoId: this.player.state.videoId, n: this.festaN }; this.festaSuja = false; }
        if (this.rx.length) { m.rx = this.rx; this.rx = []; }
        if (Object.keys(m).length <= 2) return;
        const dado = JSON.stringify(m);
        for (const { ws } of this.conexoes.values()) {
            if (ws) try { ws.send(dado); } catch {}
        }
    }

    // ── UTILIDADES ──
    private enviar(ws: WebSocket, obj: unknown) {
        try { ws.send(JSON.stringify(obj)); } catch {}
    }
    private responder(ws: WebSocket, m: any, extra: Record<string, unknown> = {}) {
        if (m?.req) this.enviar(ws, { t: 'ok', req: m.req, ...extra });
    }
    private recusar(ws: WebSocket, m: any, motivo: string, texto?: string) {
        if (m?.req) this.enviar(ws, { t: 'erro', req: m.req, motivo, texto });
    }

    private liberado(id: string, tipo: string) {
        const chave = id + ':' + tipo, agora = Date.now();
        if (agora - (this.ultimaAcao.get(chave) || 0) < ESPERA[tipo]) return false;
        this.ultimaAcao.set(chave, agora);
        if (this.ultimaAcao.size > 20000) this.ultimaAcao.clear();
        return true;
    }

    private derrubar(ws: WebSocket, codigo: number, motivo: string) {
        try { ws.close(codigo, motivo); } catch {}
        this.sair(ws);
    }

    private salvar(chave: 'fila' | 'player') {
        const valor = chave === 'fila' ? this.fila : { ...this.player, playback: null };
        this.sql.exec('INSERT OR REPLACE INTO estado (chave, valor) VALUES (?, ?)', chave, JSON.stringify(valor));
    }

    private async assinar(id: string): Promise<string> {
        this.chave ??= await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(this.env.SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', this.chave, new TextEncoder().encode(id));
        return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
}

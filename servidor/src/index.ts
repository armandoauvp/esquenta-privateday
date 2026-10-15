// Sala da pista do Esquenta AUVP Private Day.
// Worker na frente (roteia /pista para o Durable Object da sala) e o DO `Pista` com
// presença e posições por WebSocket com hibernação. Etapa 1 da migração: só a pista.
import { DurableObject } from 'cloudflare:workers';

export interface Env {
    PISTA: DurableObjectNamespace<Pista>;
    SEGREDO?: string;      // assina o identificador do visitante (wrangler secret put SEGREDO)
    ORIGENS?: string;      // origens aceitas, separadas por vírgula; vazio = qualquer uma
}

const SALAS = new Set(['principal', 'teste', 'carga']);
const FLUSH_MS = 250;              // diffs da pista saem no máximo 4×/s
const FAXINA_MS = 60_000;          // alarme que derruba conexão morta enquanto há gente
const SILENCIO_MAX_MS = 90_000;    // sem mensagem nem ping nesse tempo = conexão morta
const MAX_PESSOAS = 1500;
const MAX_MSG = 4096;
const JANELA_MS = 5000, LIMITE_JANELA = 25, LIMITE_DERRUBA = 80;
const PASSOS = new Set(['', 'spin', 'jump', 'shake', 'moonwalk']);

type Avatar = Record<string, string | number | boolean>;
interface Pessoa {
    cid: string; nome: string; cor: string; avatar: Avatar; dance: string;
    x: number; y: number; away: boolean;
}
interface Anexo { cid: string; p: Pessoa }
interface Conexao { ws: WebSocket; p: Pessoa }
interface Cota { ini: number; n: number; visto: number }

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === '/saude') {
            return new Response('ok', { headers: { 'access-control-allow-origin': '*' } });
        }
        if (url.pathname !== '/pista' && url.pathname !== '/onde') return new Response('não encontrado', { status: 404 });
        if (url.pathname === '/pista' && req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('use WebSocket', { status: 426 });
        }
        const origem = req.headers.get('origin');
        const origens = (env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (origem && origens.length && !origens.includes(origem)) {
            return new Response('origem não autorizada', { status: 403 });
        }
        const sala = url.searchParams.get('sala') || 'principal';
        if (!SALAS.has(sala) && !/^carga-[a-z0-9]{1,12}$/.test(sala)) return new Response('sala inválida', { status: 404 });
        // sem locationHint: a sala nasce perto de quem a acessa primeiro. Não há Durable Object
        // na América do Sul; pedir 'sam' jogou a sala em Nova Jersey, e o padrão a partir de SP cai em Miami
        return env.PISTA.get(env.PISTA.idFromName(sala)).fetch(req);
    },
} satisfies ExportedHandler<Env>;

export class Pista extends DurableObject<Env> {
    private pessoas = new Map<string, Conexao>();
    private cotas = new WeakMap<WebSocket, Cota>();
    private mudouPos = new Set<string>();
    private mudouTudo = new Set<string>();
    private saiu = new Set<string>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private chave: CryptoKey | null = null;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        // ping/pong respondido pelo runtime, sem acordar o objeto nem contar requisição
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
        // voltando da hibernação: a pista é remontada a partir dos anexos dos sockets
        for (const ws of ctx.getWebSockets()) {
            const a = ws.deserializeAttachment() as Anexo | null;
            if (a?.cid) this.pessoas.set(a.cid, { ws, p: a.p });
        }
    }

    async fetch(req: Request): Promise<Response> {
        // diagnóstico: em qual data center da Cloudflare esta sala está rodando
        if (new URL(req.url).pathname === '/onde') {
            let colo = '?';
            try {
                const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
                colo = trace.match(/^colo=.*$/m)?.[0] ?? trace.slice(0, 200);
            } catch (e) { colo = 'erro: ' + String(e); }
            return new Response(colo, { headers: { 'access-control-allow-origin': '*' } });
        }
        if (this.ctx.getWebSockets().length >= MAX_PESSOAS) {
            return new Response('sala cheia', { status: 503 });
        }
        const par = new WebSocketPair();
        this.ctx.acceptWebSocket(par[1]);
        await this.agendarFaxina();
        return new Response(null, { status: 101, webSocket: par[0] });
    }

    async webSocketMessage(ws: WebSocket, dado: string | ArrayBuffer) {
        if (typeof dado !== 'string' || dado.length > MAX_MSG) return this.derrubar(ws, 1009, 'mensagem inválida');
        const cota = this.cotas.get(ws) ?? { ini: Date.now(), n: 0, visto: 0 };
        this.cotas.set(ws, cota);
        const t = Date.now();
        cota.visto = t;
        if (t - cota.ini > JANELA_MS) { cota.ini = t; cota.n = 0; }
        if (++cota.n > LIMITE_DERRUBA) return this.derrubar(ws, 4008, 'mensagens demais');
        if (cota.n > LIMITE_JANELA) return;

        let m: any;
        try { m = JSON.parse(dado); } catch { return; }
        if (!m || typeof m !== 'object') return;

        if (m.t === 'hora') { // relógio estilo NTP: o cliente calcula o desvio
            return this.enviar(ws, { t: 'hora', c: Number(m.c) || 0, s: Date.now() });
        }
        if (m.t === 'ola') return this.ola(ws, m);

        const a = ws.deserializeAttachment() as Anexo | null;
        const con = a?.cid ? this.pessoas.get(a.cid) : undefined;
        if (!con || con.ws !== ws) return; // ainda não se apresentou (ou foi substituído)
        const p = con.p;

        if (m.t === 'mover') {
            const x = num01(m.x), y = num01(m.y);
            if (x === null || y === null || (x === p.x && y === p.y)) return;
            p.x = x; p.y = y;
            this.mudouPos.add(p.cid);
        } else if (m.t === 'perfil') {
            Object.assign(p, limparPerfil(m.perfil));
            this.mudouTudo.add(p.cid);
        } else if (m.t === 'ausente') {
            if (p.away === !!m.v) return;
            p.away = !!m.v;
            this.mudouTudo.add(p.cid);
        } else return;

        ws.serializeAttachment({ cid: p.cid, p } satisfies Anexo);
        this.agendarFlush();
    }

    async webSocketClose(ws: WebSocket) { this.sair(ws); }
    async webSocketError(ws: WebSocket) { this.sair(ws); }

    async alarm() {
        const agora = Date.now();
        for (const ws of this.ctx.getWebSockets()) {
            const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
            const msg = this.cotas.get(ws)?.visto ?? 0;
            // cota some na hibernação: sem registro nenhum, dá o benefício da dúvida
            if (!ping && !msg) continue;
            if (agora - Math.max(ping, msg) > SILENCIO_MAX_MS) this.derrubar(ws, 4001, 'sem sinal');
        }
        await this.agendarFaxina();
    }

    // ── apresentação ──
    private async ola(ws: WebSocket, m: any) {
        if ((ws.deserializeAttachment() as Anexo | null)?.cid) return; // já se apresentou
        if (!this.env.SEGREDO) return this.derrubar(ws, 1011, 'servidor sem SEGREDO');
        let cid = typeof m.cid === 'string' && /^[a-f0-9]{16}$/.test(m.cid) ? m.cid : '';
        if (!cid || typeof m.token !== 'string' || m.token !== await this.assinar(cid)) {
            cid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        }
        // mesma pessoa em outra aba: a conexão antiga sai, a pessoa continua na pista
        const antiga = this.pessoas.get(cid);
        if (antiga && antiga.ws !== ws) {
            this.pessoas.delete(cid);
            try { antiga.ws.close(4000, 'aberto em outra aba'); } catch {}
        }
        const p: Pessoa = {
            cid, nome: 'Convidado', cor: '#DB7944', avatar: {}, dance: '', away: false,
            x: num01(m.x) ?? 20 + Math.random() * 60, y: num01(m.y) ?? 20 + Math.random() * 60,
            ...limparPerfil(m.perfil),
        };
        ws.serializeAttachment({ cid, p } satisfies Anexo);
        this.pessoas.set(cid, { ws, p });
        this.saiu.delete(cid);
        this.mudouTudo.add(cid);
        this.enviar(ws, {
            t: 'bemvindo', cid, token: await this.assinar(cid), agora: Date.now(),
            pista: [...this.pessoas.values()].map(c => c.p),
        });
        this.agendarFlush();
    }

    private sair(ws: WebSocket) {
        const a = ws.deserializeAttachment() as Anexo | null;
        try { ws.close(1000, 'tchau'); } catch {}
        if (!a?.cid || this.pessoas.get(a.cid)?.ws !== ws) return;
        this.pessoas.delete(a.cid);
        this.mudouPos.delete(a.cid);
        this.mudouTudo.delete(a.cid);
        this.saiu.add(a.cid);
        this.agendarFlush();
    }

    // ── difusão ──
    private agendarFlush() {
        if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    }

    private flush() {
        this.timer = null;
        if (!this.mudouPos.size && !this.mudouTudo.size && !this.saiu.size) return;
        const tudo: Pessoa[] = [], pos: [string, number, number][] = [];
        for (const cid of this.mudouTudo) { const c = this.pessoas.get(cid); if (c) tudo.push(c.p); }
        for (const cid of this.mudouPos) {
            if (this.mudouTudo.has(cid)) continue;
            const c = this.pessoas.get(cid);
            if (c) pos.push([cid, c.p.x, c.p.y]);
        }
        const msg = JSON.stringify({ t: 'pista', agora: Date.now(), pos, tudo, saiu: [...this.saiu] });
        this.mudouPos.clear(); this.mudouTudo.clear(); this.saiu.clear();
        for (const { ws } of this.pessoas.values()) {
            try { ws.send(msg); } catch {}
        }
    }

    // ── utilidades ──
    private enviar(ws: WebSocket, obj: unknown) {
        try { ws.send(JSON.stringify(obj)); } catch {}
    }

    private derrubar(ws: WebSocket, codigo: number, motivo: string) {
        try { ws.close(codigo, motivo); } catch {}
        this.sair(ws);
    }

    private async agendarFaxina() {
        if (!this.ctx.getWebSockets().length) return;
        if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + FAXINA_MS);
    }

    private async assinar(cid: string): Promise<string> {
        this.chave ??= await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(this.env.SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', this.chave, new TextEncoder().encode(cid));
        return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
}

// posição em % da pista, com 1 casa decimal
function num01(v: unknown): number | null {
    const n = Number(v);
    if (typeof v !== 'number' || !Number.isFinite(n)) return null;
    return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

// só passa o que é seguro desenhar em qualquer navegador; o resto é descartado
function limparPerfil(bruto: unknown): Partial<Pessoa> {
    if (!bruto || typeof bruto !== 'object') return {};
    const b = bruto as Record<string, unknown>;
    const p: Partial<Pessoa> = {};
    if (typeof b.nome === 'string') {
        const nome = b.nome.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
        if (nome) p.nome = nome;
    }
    if (typeof b.cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.cor)) p.cor = b.cor;
    if (typeof b.dance === 'string' && PASSOS.has(b.dance)) p.dance = b.dance;
    if (b.avatar && typeof b.avatar === 'object' && !Array.isArray(b.avatar)) {
        const av: Avatar = {};
        for (const [k, v] of Object.entries(b.avatar).slice(0, 20)) {
            if (!/^[a-zA-Z]{1,24}$/.test(k)) continue;
            if (typeof v === 'string' && /^[\w-]{0,32}$/.test(v)) av[k] = v;
            else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) av[k] = v;
        }
        p.avatar = av;
    }
    return p;
}

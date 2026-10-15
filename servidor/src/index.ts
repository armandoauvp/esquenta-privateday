// Servidor da pista do Esquenta AUVP Private Day (Cloudflare Workers + Durable Objects).
// O Worker só roteia: cada sala é um Durable Object `Pista` (src/pista.ts).
export { Pista } from './pista';
import type { Pista } from './pista';

export interface Env {
    PISTA: DurableObjectNamespace<Pista>;
    SEGREDO?: string;          // assina a identidade do visitante (wrangler secret put SEGREDO)
    ADMIN_CHAVE?: string;      // libera /admin/* (importação de ingressos)
    ADMINS?: string;           // e-mails da organização, separados por vírgula (secret)
    GOOGLE_CLIENT_ID?: string; // ID do cliente OAuth do "Entrar com Google"
    ORIGENS?: string;          // origens aceitas, separadas por vírgula; vazio = qualquer uma
}

const SALAS = new Set(['principal', 'teste', 'carga']);
const salaValida = (s: string) => SALAS.has(s) || /^carga-[a-z0-9]{1,12}$/.test(s);
const cors = { 'access-control-allow-origin': '*' };

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === '/saude') return new Response('ok', { headers: cors });

        const sala = url.searchParams.get('sala') || 'principal';
        if (!salaValida(sala)) return new Response('sala inválida', { status: 404 });
        // sem locationHint: a sala nasce perto de quem a acessa primeiro. Não há Durable Object
        // na América do Sul; pedir 'sam' jogou a sala em Nova Jersey, e o padrão a partir de SP cai em Miami
        const stub = env.PISTA.get(env.PISTA.idFromName(sala));

        if (url.pathname === '/onde') return stub.fetch(req);
        if (url.pathname.startsWith('/admin/')) {
            const chave = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
            if (!env.ADMIN_CHAVE || chave !== env.ADMIN_CHAVE) return new Response('não autorizado', { status: 401 });
            return stub.fetch(req);
        }
        if (url.pathname !== '/pista') return new Response('não encontrado', { status: 404 });
        if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('use WebSocket', { status: 426 });
        const origem = req.headers.get('origin');
        const origens = (env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (origem && origens.length && !origens.includes(origem)) return new Response('origem não autorizada', { status: 403 });
        return stub.fetch(req);
    },
} satisfies ExportedHandler<Env>;

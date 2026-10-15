// Validação de tudo que vem do navegador: só passa o que é seguro desenhar e guardar.

export const PASSOS = new Set(['', 'spin', 'jump', 'shake', 'moonwalk']);
export const REACOES = new Set(['🔥', '❤️', '👏', '🕺', '💃', '😂']);
export const REACOES_VIP = new Set(['🥂', '💎', '👑', '✨']);
// Área VIP (canto superior direito da pista), igual à do app
export const VIP_ZONE = { x1: 72, y1: 5, x2: 98, y2: 32 };
export const naAreaVip = (x: number, y: number) =>
    x >= VIP_ZONE.x1 && x <= VIP_ZONE.x2 && y >= VIP_ZONE.y1 && y <= VIP_ZONE.y2;

export type Avatar = Record<string, string | number | boolean>;
export interface PerfilLimpo { name?: string; color?: string; avatarConfig?: Avatar; dance?: string }

// texto livre: sem caracteres de controle, espaços aparados e com teto
export function texto(v: unknown, max: number): string {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export const videoIdValido = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v);
export const idValido = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v);
export const hashValido = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

// posição em % da pista, com 1 casa decimal
export function pct(v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

export function limparPerfil(bruto: unknown): PerfilLimpo {
    if (!bruto || typeof bruto !== 'object') return {};
    const b = bruto as Record<string, unknown>;
    const p: PerfilLimpo = {};
    const nome = texto(b.name, 24).replace(/[<>]/g, '');
    if (nome) p.name = nome;
    if (typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color)) p.color = b.color;
    if (typeof b.dance === 'string' && PASSOS.has(b.dance)) p.dance = b.dance;
    if (b.avatarConfig && typeof b.avatarConfig === 'object' && !Array.isArray(b.avatarConfig)) {
        const av: Avatar = {};
        for (const [k, v] of Object.entries(b.avatarConfig).slice(0, 24)) {
            if (!/^[a-zA-Z]{1,24}$/.test(k)) continue;
            if (typeof v === 'string' && /^[\w-]{0,32}$/.test(v)) av[k] = v;
            else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) av[k] = v;
        }
        p.avatarConfig = av;
    }
    return p;
}

// censura no servidor: vale pra todo mundo, inclusive quem mexe no app pelo console
const PALAVROES = ['porra', 'caralho', 'merda', 'buceta', 'putaria', 'fdp', 'vsf', 'pqp', 'cacete', 'viado', 'arrombado', 'desgraçad', 'cuzão', 'vagabund'];
const PALAVROES_RE = new RegExp(`\\b(${PALAVROES.join('|')})\\w*`, 'gi');
export const censurar = (t: string) => t.replace(PALAVROES_RE, m => m[0] + '*'.repeat(m.length - 1));

export const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

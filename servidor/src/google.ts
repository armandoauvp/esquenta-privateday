// Confere o "Entrar com Google" da organização: o navegador recebe um ID token (JWT)
// do Google Identity Services e o servidor valida assinatura, emissor, público e validade.

interface ChaveGoogle extends JsonWebKey { kid?: string }
let chaves: { lista: ChaveGoogle[]; ate: number } | null = null;

async function obterChaves(forcar = false): Promise<ChaveGoogle[]> {
    if (!forcar && chaves && chaves.ate > Date.now()) return chaves.lista;
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!r.ok) throw new Error('chaves do Google indisponíveis');
    const lista = ((await r.json()) as { keys: ChaveGoogle[] }).keys;
    chaves = { lista, ate: Date.now() + 60 * 60 * 1000 };
    return lista;
}

const bytes = (b64url: string) => {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};
const json = (b64url: string) => JSON.parse(new TextDecoder().decode(bytes(b64url)));

export async function verificarGoogle(token: string, clientId: string): Promise<string | null> {
    const partes = token.split('.');
    if (partes.length !== 3 || !clientId) return null;
    const [h, p, s] = partes;
    let cab: any, corpo: any;
    try { cab = json(h); corpo = json(p); } catch { return null; }
    if (cab.alg !== 'RS256' || typeof cab.kid !== 'string') return null;

    // chave nova (o Google gira as chaves): busca de novo uma vez antes de recusar
    let jwk = (await obterChaves()).find(k => k.kid === cab.kid);
    if (!jwk) jwk = (await obterChaves(true)).find(k => k.kid === cab.kid);
    if (!jwk) return null;
    const chave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, bytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;

    const agora = Date.now() / 1000;
    if (corpo.iss !== 'accounts.google.com' && corpo.iss !== 'https://accounts.google.com') return null;
    if (corpo.aud !== clientId || !(corpo.exp > agora) || corpo.email_verified !== true) return null;
    return typeof corpo.email === 'string' ? corpo.email.toLowerCase() : null;
}

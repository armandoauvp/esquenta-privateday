// Teste de ponta a ponta do protocolo: robôs fazem o que um evento faz e conferem o resultado.
// Uso: node teste/fluxo.mjs [--base http://127.0.0.1:8787] [--sala carga-x] [--chave <ADMIN_CHAVE>]
// Exige ADMIN_CHAVE (importa um ingresso de teste e dá o selo de organização a um robô).
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const arg = (n, p) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg('base', 'http://127.0.0.1:8787');
// sala nova a cada rodada: votos e histórico de rodadas anteriores não contaminam as contas
const SALA = arg('sala', `carga-f${Date.now().toString(36)}`);
let CHAVE = arg('chave', '');
if (!CHAVE) try { CHAVE = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_CHAVE=(.*)$/m)?.[1]?.trim() || ''; } catch {}
const WS = BASE.replace(/^http/, 'ws') + `/pista?sala=${SALA}`;
const SAL = 'auvp-privateday:';
const hashEmail = e => createHash('sha256').update(SAL + e.trim().toLowerCase()).digest('hex');
const espera = ms => new Promise(r => setTimeout(r, ms));
const VIDEOS = ['dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk'];

let falhas = 0;
const confere = (ok, oQue) => { console.log(`${ok ? 'ok  ' : 'FALHOU'}  ${oQue}`); if (!ok) falhas++; };

async function admin(caminho, corpo) {
    const r = await fetch(`${BASE}${caminho}?sala=${SALA}`, {
        method: corpo ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${CHAVE}`, 'content-type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return r.json();
}

class Robo {
    constructor(nome, extra = {}) {
        this.nome = nome; this.extra = extra; this.seq = 0; this.pend = new Map();
        this.users = new Map(); this.chat = []; this.fila = []; this.player = null; this.festa = null;
        this.dms = []; this.papos = new Map(); this.rx = []; this.eu = null; this.ouvintes = [];
    }
    conectar() {
        return new Promise((ok, erro) => {
            this.ws = new WebSocket(WS);
            this.ws.on('error', erro);
            this.ws.on('close', (codigo) => { this.fechado = codigo; });
            this.ws.on('open', () => this.ws.send(JSON.stringify({
                t: 'ola', id: this.id, token: this.token, x: 30, y: 60,
                perfil: { name: this.nome, color: '#00ffff', avatarConfig: { top: 'shortFlat' }, dance: '' }, ...this.extra,
            })));
            this.ws.on('message', b => {
                const txt = b.toString();
                if (txt === 'pong') return;
                const m = JSON.parse(txt);
                if (m.t === 'bemvindo') {
                    Object.assign(this, { id: m.id, token: m.token, eu: m.eu, chat: m.chat, fila: m.fila, player: m.player, festa: m.festa, dms: m.dms });
                    this.users = new Map(m.users.map(u => [u.id, u]));
                    m.papos.forEach(p => this.papos.set(p.id, p));
                    ok(this);
                } else if (m.t === 'tick') {
                    if (m.reset) this.users = new Map();
                    (m.tudo || []).forEach(u => this.users.set(u.id, u));
                    (m.pos || []).forEach(([id, x, y]) => { const u = this.users.get(id); if (u) { u.x = x; u.y = y; } });
                    (m.saiu || []).forEach(id => this.users.delete(id));
                    if (m.chat) this.chat.push(...m.chat);
                    if (m.chatApagado) this.chat = this.chat.filter(c => !m.chatApagado.includes(c.id));
                    if (m.fila) this.fila = m.fila;
                    if (m.player) this.player = m.player;
                    if (m.festa) this.festa = { ...this.festa, ...m.festa };
                    if (m.rx) this.rx.push(...m.rx);
                } else if (m.t === 'ok' || m.t === 'erro') {
                    const p = this.pend.get(m.req); if (p) { this.pend.delete(m.req); p(m); }
                } else if (m.t === 'dm') this.dms.push(m.msg);
                else if (m.t === 'papo') this.papos.set(m.papo.id, m.papo);
                else if (m.t === 'eu') this.eu = { isVIP: m.isVIP, isOrg: m.isOrg };
                else if (m.t === 'removido') this.removido = true;
                this.ouvintes.forEach(f => f(m));
            });
        });
    }
    pedir(obj) {
        const req = ++this.seq;
        return new Promise(ok => {
            this.pend.set(req, ok);
            this.ws.send(JSON.stringify({ ...obj, req }));
            setTimeout(() => { if (this.pend.delete(req)) ok({ t: 'erro', motivo: 'timeout' }); }, 5000);
        });
    }
    enviar(obj) { this.ws.send(JSON.stringify(obj)); }
    async ate(cond, ms = 9000, passo = 100) {
        const fim = Date.now() + ms;
        while (Date.now() < fim) { if (cond()) return true; await espera(passo); }
        return cond();
    }
    fechar() { try { this.ws.close(1000); } catch {} }
}

console.log(`Fluxo em ${WS}`);
if (!CHAVE) { console.log('Sem ADMIN_CHAVE (.dev.vars ou --chave)'); process.exit(1); }

// ingresso de teste
const emailVip = `robo-${Date.now()}@teste.dev`;
const imp = await admin('/admin/ingressos', { hashes: [hashEmail(emailVip)] });
confere(imp.ok, `importa ingresso (${imp.ingressos} na lista)`);

const dj = await new Robo('DJ Robô').conectar();
const ana = await new Robo('Ana').conectar();
const beto = await new Robo('Beto').conectar();
confere(dj.users.size >= 1 && dj.id && dj.token, 'bemvindo com identidade e pista');
confere(await ana.ate(() => ana.users.has(beto.id)), 'quem chegou antes vê quem chegou depois');

// presença: posição, perfil, ausência
dj.enviar({ t: 'mover', x: 40, y: 50 });
confere(await ana.ate(() => ana.users.get(dj.id)?.x === 40), 'movimento chega aos outros');
dj.enviar({ t: 'mover', x: 85, y: 10 });
await espera(600);
confere(ana.users.get(dj.id)?.x === 40, 'sem ingresso não entra na Área VIP');
ana.enviar({ t: 'perfil', perfil: { name: 'Ana <b>', dance: 'spin', color: 'red' } });
confere(await beto.ate(() => beto.users.get(ana.id)?.dance === 'spin'), 'perfil validado chega aos outros');
confere(beto.users.get(ana.id)?.name === 'Ana b' && beto.users.get(ana.id)?.color === '#00ffff', 'perfil limpo (sem <>, cor inválida ignorada)');

// ingresso
let r = await dj.pedir({ t: 'fila', videoId: VIDEOS[0] });
confere(r.t === 'erro' && r.motivo === 'sem_ingresso', 'fila recusa quem não tem ingresso');
r = await dj.pedir({ t: 'ingresso', hash: hashEmail('nao-existe@x.com') });
confere(r.t === 'erro' && r.motivo === 'nao_encontrado', 'e-mail fora da lista é recusado');
await espera(2100); // limite de ritmo: uma conferência a cada 2 s
r = await dj.pedir({ t: 'ingresso', hash: hashEmail(emailVip) });
confere(r.t === 'ok' && (await dj.ate(() => dj.eu?.isVIP)), 'e-mail da lista vira VIP');
confere(await ana.ate(() => ana.users.get(dj.id)?.isVIP), 'coroa aparece para os outros');

// fila → contagem → música
await espera(3100); // limite de ritmo da fila
r = await dj.pedir({ t: 'fila', videoId: VIDEOS[0], title: 'Música 1' });
confere(r.t === 'ok' && r.entraAgora, 'música entra na fila e vai pra pista');
confere(await ana.ate(() => ana.player?.countdown?.reason?.includes('DJ Robô')), 'contagem sincronizada aparece pra todos');
confere(await ana.ate(() => ana.player?.state?.videoId === VIDEOS[0], 9000), 'servidor troca a música ao fim da contagem');
confere(ana.fila.length === 0 && !ana.player.countdown, 'fila e contagem zeradas depois da troca');
r = await dj.pedir({ t: 'fila', videoId: VIDEOS[0] });
confere(r.motivo === 'repetida', 'música repetida é recusada');
await espera(3100);
r = await dj.pedir({ t: 'fila', videoId: VIDEOS[1], title: 'Música 2', duracao: 1400.4 });
confere(r.t === 'ok' && r.posicao === 1 && !r.entraAgora, 'segunda música espera na fila');
confere(await ana.ate(() => ana.fila[0]?.duracao === 1400), 'duração do vídeo longo chega a todos (aviso de corte aos 10 min)');

// playback do DJ
dj.enviar({ t: 'playback', state: 'paused', time: 12.5 });
confere(await ana.ate(() => ana.player?.playback?.state === 'paused'), 'pausa do DJ chega a todos');
ana.enviar({ t: 'playback', state: 'playing', time: 99 });
await espera(600);
confere(ana.player.playback.time === 12.5, 'quem não é DJ não mexe no player');
dj.enviar({ t: 'playback', state: 'playing', time: 12.5 }); // retoma: pausa longa passaria a vez

// festa
r = await ana.pedir({ t: 'festa' });
await beto.pedir({ t: 'festa' });
await espera(1100);
await ana.pedir({ t: 'festa' }); // repetido: não conta de novo
confere(await dj.ate(() => dj.festa?.n === 2), 'votos "vai pra festa" contados sem duplicar');

// reações
ana.enviar({ t: 'reacao', emoji: '🔥' });
ana.enviar({ t: 'reacao', emoji: '💎' });
confere(await beto.ate(() => beto.rx.some(x => x[0] === '🔥' && x[3] === ana.id)), 'reação chega aos outros');
await espera(400);
confere(!beto.rx.some(x => x[0] === '💎'), 'reação VIP recusada fora do lounge');

// chat
r = await beto.pedir({ t: 'chat', text: 'que porra de som bom' });
confere(r.t === 'ok' && (await ana.ate(() => ana.chat.some(c => c.text === 'que p**** de som bom'))), 'chat chega censurado');

// papo privado
r = await ana.pedir({ t: 'dm', para: beto.id, text: 'oi' });
confere(r.motivo === 'nao_aceito', 'mensagem privada exige papo aceito');
r = await ana.pedir({ t: 'papo', com: beto.id });
confere(r.status === 'pending' && (await beto.ate(() => [...beto.papos.values()].some(p => p.status === 'pending'))), 'pedido de papo chega');
r = await beto.pedir({ t: 'aceitar', com: ana.id });
confere(r.status === 'accepted' && (await ana.ate(() => [...ana.papos.values()].some(p => p.status === 'accepted'))), 'papo aceito dos dois lados');
await espera(600);
r = await ana.pedir({ t: 'dm', para: beto.id, text: 'oi beto' });
confere(r.t === 'ok' && (await beto.ate(() => beto.dms.some(d => d.text === 'oi beto'))), 'mensagem privada entregue');
confere(!dj.dms.length, 'terceiros não recebem mensagem privada');

// pular por votação: com 2 ouvintes o limiar é 2
await ana.pedir({ t: 'pular' });
await espera(300);
confere(!ana.player.countdown, 'um voto não basta');
await beto.pedir({ t: 'pular' });
confere(await ana.ate(() => ana.player?.countdown?.reason?.includes('votou')), 'votação da pista abre a contagem');
confere(await ana.ate(() => ana.player?.state?.videoId === VIDEOS[1], 9000), 'próxima da fila assume');

// DJ passa a vez e cancela
await dj.pedir({ t: 'passarVez' });
confere(await ana.ate(() => ana.player?.countdown?.cancelavel), 'DJ passa a vez com contagem cancelável');
r = await dj.pedir({ t: 'cancelar' });
confere(r.t === 'ok' && (await ana.ate(() => !ana.player?.countdown)), 'DJ cancela a contagem');

// pausa do DJ: aos 5 s abre a contagem; voltar a tocar cancela
dj.enviar({ t: 'playback', state: 'paused', time: 30 });
confere(await ana.ate(() => ana.player?.countdown?.tipo === 'pausa', 9000), 'pausa longa do DJ abre a contagem');
dj.enviar({ t: 'playback', state: 'playing', time: 30 });
confere(await ana.ate(() => !ana.player?.countdown) && ana.player.state.videoId === VIDEOS[1], 'DJ volta a tocar e a contagem some');

// fim do vídeo pelo DJ
dj.enviar({ t: 'fim', chave: `${VIDEOS[1]}_${ana.player.state.startedAt}` });
confere(await ana.ate(() => ana.player?.state?.videoId === null), 'fim informado pelo DJ volta para a playlist da casa');

// ranking
r = await ana.pedir({ t: 'ranking' });
confere(r.t === 'ok' && r.djs.some(d => d.name === 'DJ Robô' && d.n >= 2) && r.musicas.some(([v, n]) => v === VIDEOS[0] && n === 2), 'ranking com DJs e votos');

// recarregar mantém a identidade e a mesa
await espera(3100);
r = await dj.pedir({ t: 'fila', videoId: VIDEOS[2], title: 'Música 3' });
confere(await ana.ate(() => ana.player?.state?.videoId === VIDEOS[2], 9000), 'terceira música no ar');
const idAntes = dj.id;
dj.fechar();
await espera(1500);
await dj.conectar();
confere(dj.id === idAntes && dj.eu.isVIP, 'reconexão mantém identidade e ingresso');
confere(ana.player.state.addedByUid === idAntes, 'recarregar não tira o DJ da mesa');

// organização
r = await ana.pedir({ t: 'admPular' });
confere(r.motivo === 'nao_org', 'quem não é da organização não pula');
const org = await admin('/admin/org', { id: ana.id, email: 'teste@auvp.dev' });
confere(org.ok && (await ana.ate(() => ana.eu?.isOrg)), 'selo de organização concedido');
confere(await beto.ate(() => beto.users.get(ana.id)?.isOrg), 'selo aparece para os outros');
const msgBeto = beto.chat.find(c => c.uid === beto.id);
r = await ana.pedir({ t: 'admApagarChat', id: msgBeto.id });
confere(r.t === 'ok' && (await dj.ate(() => !dj.chat.some(c => c.id === msgBeto.id))), 'organização apaga mensagem');
r = await ana.pedir({ t: 'admPular' });
confere(r.t === 'ok' && (await beto.ate(() => beto.player?.countdown?.reason?.includes('organização'))), 'organização pula a música');
await beto.ate(() => !beto.player?.countdown, 9000);
r = await ana.pedir({ t: 'admExpulsar', uid: beto.id });
confere(r.t === 'ok' && (await beto.ate(() => beto.removido)), 'organização remove alguém');
confere(await dj.ate(() => !dj.users.has(beto.id)), 'removido some da pista');
let voltou = null;
try { const b2 = new Robo('Beto'); b2.id = beto.id; b2.token = beto.token; await Promise.race([b2.conectar(), espera(2500)]); voltou = b2; } catch {}
confere(!voltou?.eu, 'removido não volta antes do prazo');

// pausa do DJ por mais de 10 s passa a vez
await espera(3100);
await dj.pedir({ t: 'fila', videoId: 'hTWKbfoikeg', title: 'Pausa' });
confere(await ana.ate(() => ana.player?.state?.videoId === 'hTWKbfoikeg', 9000), 'música nova no ar');
// um ouvinte só na pista: o voto dele não tira a música do DJ (mínimo de 2 votos)
r = await ana.pedir({ t: 'pular' });
await espera(800);
confere(r.t === 'ok' && !ana.player.countdown && ana.player.state.videoId === 'hTWKbfoikeg', 'um voto sozinho não pula a música de outro DJ');
const pausouEm = Date.now();
dj.enviar({ t: 'playback', state: 'paused', time: 12 });
await espera(5500);
dj.enviar({ t: 'playback', state: 'paused', time: 12 }); // republicar "pausado" não reinicia o prazo
confere(await ana.ate(() => ana.player?.state?.videoId === null, 9000), 'pausada por mais de 10 s, a música passa a vez');
const levou = (Date.now() - pausouEm) / 1000;
confere(levou >= 9.5 && levou <= 12.5, `passou aos ~10 s de pausa (${levou.toFixed(1)} s)`);

// --lento: DJ que sai da tela perde a mesa; música de quem está fora sai da fila (~2 min)
if (process.argv.includes('--lento')) {
    await espera(3100);
    await dj.pedir({ t: 'fila', videoId: 'L_jWHffIx5E', title: 'Lento 1' });
    confere(await ana.ate(() => ana.player?.state?.videoId === 'L_jWHffIx5E', 15000), '[lento] música do DJ no ar');
    await espera(3100);
    await dj.pedir({ t: 'fila', videoId: 'fJ9rUzIMcZQ', title: 'Lento 2' });
    confere(await ana.ate(() => ana.fila.some(i => i.videoId === 'fJ9rUzIMcZQ')), '[lento] segunda música do DJ na fila');
    dj.enviar({ t: 'ausente', v: true });
    console.log('      (DJ fora da tela; esperando a tolerância de 45 s + a ronda)');
    confere(await ana.ate(() => ana.player?.countdown?.reason?.includes('saiu da pista'), 90000, 500), '[lento] DJ fora da tela perde a mesa');
    confere(await ana.ate(() => !ana.fila.length, 30000, 500), '[lento] música de quem está fora sai da fila');
    confere(await ana.ate(() => ana.player?.state?.videoId === null, 15000), '[lento] pista volta para a playlist da casa');
}

[dj, ana].forEach(r => r.fechar());
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
setTimeout(() => process.exit(falhas ? 1 : 0), 500);

// Teste de carga da pista: N robôs conectam, andam, conversam, reagem e conferem se todos veem todos.
// Uso: node teste/carga.mjs [--url ws://127.0.0.1:8787/pista?sala=carga] [--n 500]
//      [--duracao 90] [--rampa 15] [--mover 10] [--chat 60] [--reacao 20] [--observadores 25] [--total N]
// Acima de ~250 robôs contra a Cloudflare, divida em vários processos: um Node só não dá conta
// de tantas conexões TLS e o atraso medido passa a ser do cliente, não do servidor.
import WebSocket from 'ws';

const arg = (nome, padrao) => {
    const i = process.argv.indexOf('--' + nome);
    return i > 0 ? process.argv[i + 1] : padrao;
};
const URL_PISTA = arg('url', 'ws://127.0.0.1:8787/pista?sala=carga');
const N = +arg('n', 500);
const DURACAO_S = +arg('duracao', 90);
const RAMPA_S = +arg('rampa', 15);          // tempo para todos entrarem
const MOVER_S = +arg('mover', 10);          // intervalo médio entre passos de cada robô
const OBSERVADORES = +arg('observadores', 25); // robôs que medem a latência de propagação
const CHAT_S = +arg('chat', 60);            // intervalo médio entre mensagens de cada robô (0 = sem chat)
const REACAO_S = +arg('reacao', 20);        // intervalo médio entre reações de cada robô (0 = sem reação)

const m = {
    conectados: 0, bemvindos: 0, falhas: 0, quedas: 0, codigosQueda: {},
    msgs: 0, bytes: 0, enviados: 0, chats: 0, reacoes: 0, chatsVistos: 0,
    propag: [], rtt: [], semEntrega: 0,
};
let msgsJanela = 0, bytesJanela = 0;
const enviadosEm = new Map(); // `${cid}:${x}:${y}` → instante do envio (mesmo relógio do processo)
const robos = [];

function percentil(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function robo(i) {
    const r = { i, cid: null, vistos: new Set(), ws: null, timers: [], pingEm: 0, fechado: false };
    const ws = new WebSocket(URL_PISTA);
    r.ws = ws;
    ws.on('open', () => {
        m.conectados++;
        ws.send(JSON.stringify({
            t: 'ola', perfil: {
                name: `Robô ${i}`, color: '#00ffff', dance: '',
                avatarConfig: { top: 'shortFlat', eyes: 'default', mouth: 'smile', skinColor: 'edb98a' },
            },
        }));
    });
    ws.on('message', (buf) => {
        const txt = buf.toString();
        m.msgs++; msgsJanela++; m.bytes += txt.length; bytesJanela += txt.length;
        if (txt === 'pong') { if (r.pingEm) m.rtt.push(Date.now() - r.pingEm); r.pingEm = 0; return; }
        const msg = JSON.parse(txt);
        if (msg.t === 'bemvindo') {
            m.bemvindos++;
            r.cid = msg.id;
            for (const p of msg.users) r.vistos.add(p.id);
            // passo aleatório a cada ~MOVER_S, defasado entre robôs
            const passo = () => {
                if (r.fechado) return;
                const x = Math.round(Math.random() * 1000) / 10, y = Math.round(Math.random() * 1000) / 10;
                enviadosEm.set(`${r.cid}:${x}:${y}`, Date.now());
                m.enviados++;
                ws.send(JSON.stringify({ t: 'mover', x, y }));
                r.timers.push(setTimeout(passo, MOVER_S * 1000 * (0.5 + Math.random())));
            };
            r.timers.push(setTimeout(passo, Math.random() * MOVER_S * 1000));
            const repetir = (seg, fn) => {
                if (!seg) return;
                const vez = () => { if (r.fechado) return; fn(); r.timers.push(setTimeout(vez, seg * 1000 * (0.5 + Math.random()))); };
                r.timers.push(setTimeout(vez, Math.random() * seg * 1000));
            };
            repetir(CHAT_S, () => { m.chats++; ws.send(JSON.stringify({ t: 'chat', text: `oi do robô ${i}` })); });
            repetir(REACAO_S, () => { m.reacoes++; ws.send(JSON.stringify({ t: 'reacao', emoji: '🔥' })); });
            r.timers.push(setInterval(() => { r.pingEm = Date.now(); ws.send('ping'); }, 20_000));
        } else if (msg.t === 'tick') {
            if (msg.reset) r.vistos.clear();
            for (const p of msg.tudo || []) r.vistos.add(p.id);
            for (const id of msg.saiu || []) r.vistos.delete(id);
            if (i === 0 && msg.chat) m.chatsVistos += msg.chat.length;
            if (i < OBSERVADORES) {
                const agora = Date.now();
                for (const [cid, x, y] of msg.pos || []) {
                    const em = enviadosEm.get(`${cid}:${x}:${y}`);
                    if (em) { m.propag.push(agora - em); (r.propag ??= []).push(agora - em); }
                }
            }
        }
    });
    ws.on('error', () => { if (!r.cid) m.falhas++; });
    ws.on('close', (codigo) => {
        r.timers.forEach(clearTimeout);
        if (!r.fechado && r.cid) { m.quedas++; m.codigosQueda[codigo] = (m.codigosQueda[codigo] || 0) + 1; }
        r.fechado = true;
    });
    return r;
}

console.log(`Carga: ${N} robôs em ${URL_PISTA} (rampa ${RAMPA_S}s, duração ${DURACAO_S}s, passo a cada ~${MOVER_S}s)`);
const inicio = Date.now();
for (let i = 0; i < N; i++) setTimeout(() => robos.push(robo(i)), (i / N) * RAMPA_S * 1000);

const painel = setInterval(() => {
    const s = ((Date.now() - inicio) / 1000).toFixed(0);
    const p = m.propag.slice(-5000);
    console.log(`[${s.padStart(3)}s] conectados ${m.bemvindos}/${N}  falhas ${m.falhas}  quedas ${m.quedas}  ` +
        `msgs/s ${(msgsJanela / 5).toFixed(0)}  KB/s ${(bytesJanela / 5 / 1024).toFixed(0)}  ` +
        `propagação p50 ${percentil(p, .5)}ms p95 ${percentil(p, .95)}ms`);
    msgsJanela = 0; bytesJanela = 0;
}, 5000);

setTimeout(async () => {
    clearInterval(painel);
    // dá um último flush pra chegar antes de conferir
    await new Promise(r => setTimeout(r, 1500));
    const vivos = robos.filter(r => !r.fechado && r.cid);
    const tamanhos = vivos.map(r => r.vistos.size);
    // com vários processos na mesma sala, passe --total com a soma dos robôs
    const esperado = +arg('total', vivos.length);
    const certos = tamanhos.filter(t => t === esperado).length;
    const resumo = {
        robos: N, conectados: m.bemvindos, falhas: m.falhas, quedas: m.quedas, codigosQueda: m.codigosQueda,
        passosEnviados: m.enviados, chatsEnviados: m.chats, chatsVistosPeloRobo0: m.chatsVistos, reacoesEnviadas: m.reacoes,
        // cota grátis: 100 mil requisições/dia, mensagens recebidas contam 20:1
        mensagensPorSegundo: +((m.enviados + m.chats + m.reacoes) / DURACAO_S).toFixed(1),
        mensagensRecebidas: m.msgs, mbRecebidos: +(m.bytes / 1048576).toFixed(1),
        propagacaoMs: { p50: percentil(m.propag, .5), p95: percentil(m.propag, .95), p99: percentil(m.propag, .99), max: percentil(m.propag, 1), amostras: m.propag.length },
        pingMs: { p50: percentil(m.rtt, .5), p95: percentil(m.rtt, .95), amostras: m.rtt.length },
        // atraso concentrado em poucos observadores = rede/cliente; espalhado em todos = servidor
        observadoresP95: (() => {
            const v = robos.filter(r => r.propag?.length).map(r => percentil(r.propag, .95));
            return { min: percentil(v, 0), mediana: percentil(v, .5), max: percentil(v, 1) };
        })(),
        consistencia: `${certos}/${vivos.length} robôs veem exatamente ${esperado} pessoas (min ${Math.min(...tamanhos)}, max ${Math.max(...tamanhos)})`,
    };
    console.log('\nRESUMO\n' + JSON.stringify(resumo, null, 2));
    for (const r of robos) { r.fechado = true; r.timers.forEach(clearTimeout); try { r.ws.close(1000); } catch {} }
    setTimeout(() => process.exit(0), 1000);
}, DURACAO_S * 1000);

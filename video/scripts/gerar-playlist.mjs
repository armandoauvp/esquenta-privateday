// Gera a playlist inteira num vídeo só (out/playlist-esquenta.mp4) a partir de ../músicas.
//
//   1. lê título/artista/duração de cada MP3, extrai a capa e copia o áudio para public/
//   2. monta a linha do tempo (crossfade entre faixas) → playlist.json (props da composição Playlist)
//   3. vídeo em segmentos, sem renderizar 3 h quadro a quadro:
//        - trecho parado de cada música: renderiza 1 ciclo (32 s) e repete sem recodificar
//        - cada virada: renderiza só os 2 s da transição do card
//      e emenda tudo com stream copy
//   4. áudio da playlist inteira num render só (só áudio, rápido) e junta no vídeo
//
// Retomável: segmentos prontos em out/playlist/ são reaproveitados.
// Para reordenar as faixas, edite a ordem em playlist.json e rode de novo
// (apague-o para recriar a partir da pasta; mudou a ordem → apague out/playlist/).
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { montarAudio } from "./audio.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FPS = 30;
const LOOP = 960; // 1 ciclo da pista (src/loop.ts)
const CROSSFADE = 90; // 3 s
const JANELA = 30; // quadros renderizados de cada lado da virada (a animação do card cabe aqui)

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MUSICAS = path.resolve(RAIZ, "..", "músicas");
const BIN = path.join(RAIZ, "node_modules", "@remotion", "compositor-win32-x64-msvc");
const EXE = process.platform === "win32" ? ".exe" : "";
const FFMPEG = path.join(BIN, "ffmpeg" + EXE);
const FFPROBE = path.join(BIN, "ffprobe" + EXE);
const PUBLIC = path.join(RAIZ, "public");
const JSON_PROPS = path.join(RAIZ, "playlist.json");
const TRAB = path.join(RAIZ, "out", "playlist");
const FINAL = path.join(RAIZ, "out", "playlist-esquenta.mp4");

// sufixos de catálogo que não interessam na tela
const limparTitulo = (t) =>
  t
    .replace(/\s+-\s+(\d{4}\s+)?Remaster(ed)?.*$/i, "")
    .replace(/\s+-\s+Single Version$/i, "")
    .replace(/\s+-\s+Original Version.*$/i, "")
    .replace(/\s+-\s+From\s+.*Soundtrack$/i, "")
    .trim();

const slug = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const ff = (args) => execFileSync(FFMPEG, ["-y", "-v", "error", ...args]);

const probe = (arq) => {
  const j = JSON.parse(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration:format_tags=title,artist:stream=codec_name", "-of", "json", arq]),
  );
  const tags = j.format.tags || {};
  return {
    titulo: tags.title || path.parse(arq).name,
    artista: (tags.artist || "").replace(/\s*[;/]\s*/g, ", "),
    duracao: Number(j.format.duration),
    temCapa: (j.streams || []).some((s) => s.codec_name === "mjpeg" || s.codec_name === "png"),
  };
};

const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19);

// ── 1 e 2: faixas, capas, áudio e linha do tempo ──
fs.mkdirSync(path.join(PUBLIC, "capas"), { recursive: true });
fs.mkdirSync(path.join(PUBLIC, "audio"), { recursive: true });
fs.mkdirSync(TRAB, { recursive: true });

let props;
if (fs.existsSync(JSON_PROPS)) {
  props = JSON.parse(fs.readFileSync(JSON_PROPS, "utf8"));
  console.log(`Usando a ordem de ${path.basename(JSON_PROPS)} (${props.musicas.length} faixas)`);
} else {
  const arquivos = fs
    .readdirSync(MUSICAS)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const musicas = arquivos.map((arq) => {
    const nome = path.parse(arq).name;
    const id = slug(nome);
    const info = probe(path.join(MUSICAS, arq));
    return {
      titulo: limparTitulo(info.titulo),
      artista: info.artista,
      capa: info.temCapa ? `capas/${id}.jpg` : "",
      audio: `audio/${id}.mp3`,
      duracao: info.duracao,
      inicio: 0,
      arquivo: arq, // origem em ../músicas (a composição ignora)
    };
  });
  props = { tag: "Esquenta 2026", data: "7 E 8 DE NOVEMBRO", crossfade: CROSSFADE, musicas };
}

// linha do tempo: cada faixa entra `crossfade` quadros antes de a anterior acabar
{
  let acc = 0;
  for (const m of props.musicas) {
    m.inicio = Math.round(acc * FPS);
    acc += m.duracao - props.crossfade / FPS;
  }
}
fs.writeFileSync(JSON_PROPS, JSON.stringify(props, null, 2) + "\n");

for (const m of props.musicas) {
  const mp3 = path.join(MUSICAS, m.arquivo);
  const audio = path.join(PUBLIC, m.audio);
  if (!fs.existsSync(audio)) fs.copyFileSync(mp3, audio);
  if (m.capa && !fs.existsSync(path.join(PUBLIC, m.capa))) ff(["-i", mp3, "-an", "-frames:v", "1", "-c:v", "copy", path.join(PUBLIC, m.capa)]);
}

const n = props.musicas.length;
const ultima = props.musicas[n - 1];
const TOTAL = ultima.inicio + Math.round(ultima.duracao * FPS);
const viradas = props.musicas.map((m, k) => (k === 0 ? 0 : m.inicio + Math.floor(props.crossfade / 2)));
console.log(`${n} faixas, ${hms(TOTAL / FPS)} de playlist`);

// ── 3: segmentos de vídeo ──
// trecho parado da música k: do fim da virada anterior ao começo da próxima
const segmentos = [];
for (let k = 0; k < n; k++) {
  const a = k === 0 ? 0 : viradas[k] + JANELA;
  const b = k === n - 1 ? TOTAL : viradas[k + 1] - JANELA;
  segmentos.push({ tipo: "parado", k, a, b });
  if (k < n - 1) segmentos.push({ tipo: "virada", k: k + 1, a: b, b: viradas[k + 1] + JANELA });
}

console.log("Empacotando o projeto…");
const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts"), publicDir: PUBLIC });
const composition = await selectComposition({ serveUrl, id: "Playlist", inputProps: props, timeoutInMilliseconds: 240000 });

// sem B-frames: o corte por `outpoint` com stream copy fica exato.
// O x264 roda no "pre-stitcher" (o "stitcher" só copia); o último argumento é a saída.
const semBFrames = ({ type, args }) => (type === "pre-stitcher" ? [...args.slice(0, -1), "-bf", "0", args[args.length - 1]] : args);

const render = async (rotulo, opcoes, destino) => {
  if (fs.existsSync(destino)) return;
  const tmp = destino.replace(/(\.\w+)$/, ".tmp$1");
  for (let tentativa = 1; ; tentativa++) {
    try {
      const t0 = Date.now();
      let ultimo = -1;
      await renderMedia({
        composition,
        serveUrl,
        inputProps: props,
        timeoutInMilliseconds: 240000,
        outputLocation: tmp,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 10) * 10;
          if (pct !== ultimo) {
            ultimo = pct;
            process.stdout.write(`\r${rotulo} ${pct}%   `);
          }
        },
        ...opcoes,
      });
      fs.renameSync(tmp, destino);
      process.stdout.write(`(${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
      return;
    } catch (e) {
      if (tentativa >= 5) throw e;
      console.log(`\n${rotulo}: falhou (${e.message.split("\n")[0]}), tentando de novo em 20 s…`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
};

// CRF 20: o YouTube recomprime de qualquer jeito, e a granulação incha muito o arquivo em CRF menor
const video = { codec: "h264", crf: 20, muted: true, ffmpegOverride: semBFrames };
const lista = []; // linhas do concat do ffmpeg
const entrada = (f, outpoint) =>
  `file '${f.replace(/\\/g, "/")}'` + (outpoint ? `\noutpoint ${outpoint.toFixed(6)}` : "");
let s = 0;
for (const seg of segmentos) {
  s++;
  const m = props.musicas[seg.k];
  const nome = `${String(s).padStart(3, "0")}-${seg.tipo}-${slug(m.titulo).slice(0, 40)}`;
  const arq = path.join(TRAB, `${nome}.mp4`);
  const quadros = seg.b - seg.a;
  const rotulo = `[${s}/${segmentos.length}] ${seg.tipo === "virada" ? "virada →" : ""} ${m.titulo}`;
  if (seg.tipo === "virada" || quadros <= LOOP) {
    await render(rotulo, { ...video, frameRange: [seg.a, seg.b - 1] }, arq);
    lista.push(entrada(arq));
  } else {
    // 1 ciclo a partir de `a` é periódico: repetido no concat, cobre o trecho inteiro
    // sem gerar arquivo intermediário. O resto entra cortado por `outpoint`
    // (exato porque não há B-frames: o pacote seguinte já tem pts >= outpoint).
    await render(rotulo, { ...video, frameRange: [seg.a, seg.a + LOOP - 1] }, arq);
    for (let r = 0; r < Math.floor(quadros / LOOP); r++) lista.push(entrada(arq));
    const resto = quadros % LOOP;
    if (resto) lista.push(entrada(arq, (resto - 0.5) / FPS));
  }
}

const listaTxt = path.join(TRAB, "lista.txt");
fs.writeFileSync(listaTxt, lista.join("\n") + "\n");

// ── 4: áudio e montagem final ──
const audio = path.join(TRAB, "audio.m4a");
if (!fs.existsSync(audio)) {
  console.log("Montando o áudio (crossfade com ffmpeg)…");
  montarAudio({ ffmpeg: FFMPEG, pastaMp3: MUSICAS, musicas: props.musicas, crossfade: props.crossfade, fps: FPS, trabalho: path.join(TRAB, "audio"), destino: audio + ".tmp" });
  fs.renameSync(audio + ".tmp", audio);
}

console.log("Emendando o vídeo e juntando o áudio…");
ff(["-f", "concat", "-safe", "0", "-i", listaTxt, "-i", audio, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", FINAL]);

const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FINAL]).toString());
const qv = parseInt(execFileSync(FFPROBE, ["-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", FINAL]).toString(), 10);
console.log(`Pronto: ${FINAL}`);
console.log(`Duração ${hms(dur)} · quadros de vídeo ${qv} (esperado ${TOTAL})`);

// capítulos para a descrição do YouTube (o card troca no meio do crossfade)
const capitulos = props.musicas
  .map((m, k) => `${hms(viradas[k] / FPS)} ${m.titulo}${m.artista ? ` — ${m.artista}` : ""}`)
  .join("\n");
fs.writeFileSync(path.join(RAIZ, "out", "capitulos.txt"), capitulos + "\n");
console.log("Capítulos do YouTube em out/capitulos.txt");

// Monta uma playlist só com as N primeiras faixas, reaproveitando os segmentos
// que o gerar-playlist.mjs já renderizou em out/playlist/. Renderiza apenas o
// finzinho da última faixa (na playlist completa ele já é virada) e o áudio.
// Uso: node scripts/playlist-parcial.mjs 20   → out/playlist-parcial-20.mp4
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { montarAudio } from "./audio.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FPS = 30;
const LOOP = 960;
const JANELA = 30; // igual ao gerar-playlist.mjs

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(RAIZ, "node_modules", "@remotion", "compositor-win32-x64-msvc");
const EXE = process.platform === "win32" ? ".exe" : "";
const FFMPEG = path.join(BIN, "ffmpeg" + EXE);
const FFPROBE = path.join(BIN, "ffprobe" + EXE);
const PUBLIC = path.join(RAIZ, "public");
const SEGS = path.join(RAIZ, "out", "playlist");
const N = Number(process.argv[2]);
const TRAB = path.join(RAIZ, "out", `playlist-parcial-${N}`);
const FINAL = path.join(RAIZ, "out", `playlist-parcial-${N}.mp4`);

const ff = (args) => execFileSync(FFMPEG, ["-y", "-v", "error", ...args]);
const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19);

const todas = JSON.parse(fs.readFileSync(path.join(RAIZ, "playlist.json"), "utf8"));
if (!(N >= 2 && N < todas.musicas.length)) throw new Error(`N inválido: ${process.argv[2]}`);
const props = { ...todas, musicas: todas.musicas.slice(0, N) };
fs.mkdirSync(TRAB, { recursive: true });

// mesma linha do tempo do gerar-playlist.mjs (com todas as faixas)
const viradas = todas.musicas.map((m, k) => (k === 0 ? 0 : m.inicio + Math.floor(todas.crossfade / 2)));
const ultima = props.musicas[N - 1];
const FIM = ultima.inicio + Math.round(ultima.duracao * FPS);
const corte = viradas[N] - JANELA; // até aqui os segmentos prontos valem

// segmentos 1..(2N-1): parado da faixa 1, virada, parado da 2, …, parado da faixa N
const arquivos = fs
  .readdirSync(SEGS)
  .filter((f) => /^\d{3}-.*\.mp4$/.test(f) && !f.includes(".tmp"))
  .sort()
  .slice(0, 2 * N - 1);
if (arquivos.length < 2 * N - 1) throw new Error(`Só há ${arquivos.length} segmentos prontos; preciso de ${2 * N - 1}.`);
console.log(`${N} faixas: ${props.musicas[0].titulo} … ${ultima.titulo} (${hms(FIM / FPS)})`);

const entrada = (f, outpoint) => `file '${f.replace(/\\/g, "/")}'` + (outpoint ? `\noutpoint ${outpoint.toFixed(6)}` : "");
const lista = [];
for (let k = 0; k < N; k++) {
  const a = k === 0 ? 0 : viradas[k] + JANELA;
  const b = k === N - 1 ? corte : viradas[k + 1] - JANELA;
  const quadros = b - a;
  const parado = path.join(SEGS, arquivos[2 * k]);
  if (quadros <= LOOP) lista.push(entrada(parado));
  else {
    for (let r = 0; r < Math.floor(quadros / LOOP); r++) lista.push(entrada(parado));
    if (quadros % LOOP) lista.push(entrada(parado, ((quadros % LOOP) - 0.5) / FPS));
  }
  if (k < N - 1) lista.push(entrada(path.join(SEGS, arquivos[2 * k + 1])));
}

console.log("Empacotando o projeto…");
const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts"), publicDir: PUBLIC });
const composition = await selectComposition({ serveUrl, id: "Playlist", inputProps: props, timeoutInMilliseconds: 240000 });
const semBFrames = ({ type, args }) => (type === "pre-stitcher" ? [...args.slice(0, -1), "-bf", "0", args[args.length - 1]] : args);

const render = async (rotulo, opcoes, destino) => {
  if (fs.existsSync(destino)) return;
  const tmp = destino.replace(/(\.\w+)$/, ".tmp$1");
  for (let tentativa = 1; ; tentativa++) {
    try {
      // concorrência baixa: roda ao lado do render completo sem sufocá-lo
      await renderMedia({ composition, serveUrl, inputProps: props, concurrency: 2, timeoutInMilliseconds: 240000, outputLocation: tmp, ...opcoes });
      fs.renameSync(tmp, destino);
      console.log(`${rotulo}: ok`);
      return;
    } catch (e) {
      if (tentativa >= 5) throw e;
      console.log(`${rotulo}: falhou (${e.message.split("\n")[0]}), tentando de novo em 20 s…`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
};

// finzinho da última faixa: sem a 21ª no props, o card fica parado até o fim
const cauda = path.join(TRAB, "cauda.mp4");
await render("Fim da última faixa", { codec: "h264", crf: 20, muted: true, ffmpegOverride: semBFrames, frameRange: [corte, FIM - 1] }, cauda);
lista.push(entrada(cauda));
const listaTxt = path.join(TRAB, "lista.txt");
fs.writeFileSync(listaTxt, lista.join("\n") + "\n");

// a última faixa fica sem fade de saída (não há próxima); as junções valem as da completa
const audio = path.join(TRAB, "audio.m4a");
if (!fs.existsSync(audio)) {
  console.log("Montando o áudio (crossfade com ffmpeg)…");
  montarAudio({ ffmpeg: FFMPEG, pastaMp3: path.resolve(RAIZ, "..", "músicas"), musicas: props.musicas, crossfade: props.crossfade, fps: FPS, trabalho: path.join(TRAB, "audio"), destino: audio + ".tmp" });
  fs.renameSync(audio + ".tmp", audio);
}

console.log("Emendando…");
ff(["-f", "concat", "-safe", "0", "-i", listaTxt, "-i", audio, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", FINAL]);

const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FINAL]).toString());
const qv = parseInt(execFileSync(FFPROBE, ["-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", FINAL]).toString(), 10);
console.log(`Pronto: ${FINAL}`);
console.log(`Duração ${hms(dur)} · quadros de vídeo ${qv} (esperado ${FIM})`);
fs.writeFileSync(
  path.join(RAIZ, "out", `capitulos-parcial-${N}.txt`),
  props.musicas.map((m, k) => `${hms(viradas[k] / FPS)} ${m.titulo}${m.artista ? ` — ${m.artista}` : ""}`).join("\n") + "\n",
);

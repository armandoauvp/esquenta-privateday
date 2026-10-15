// Áudio da playlist direto dos MP3 com o ffmpeg (bem mais rápido que o render de
// áudio do Remotion, que percorre a linha do tempo quadro a quadro).
// Mesmo crossfade da composição Playlist: seno entrando, cosseno saindo.
//
// Custo linear: cada faixa vira "corpo" (sem as bordas de crossfade) e cada
// virada vira uma "junção" de `crossfade` segundos mixando só as duas faixas
// envolvidas. Tudo em WAV PCM 48 kHz e emendado pelo concat (exato na amostra).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PCM = ["-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "wav"];
const normaliza = "aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo";

/**
 * @param musicas  faixas na ordem, com `arquivo` (em pastaMp3) e `duracao` (s)
 * @param crossfade quadros de sobreposição entre faixas
 * @param trabalho pasta para os pedaços em WAV (reaproveitados entre execuções)
 */
export const montarAudio = ({ ffmpeg, pastaMp3, musicas, crossfade, fps, trabalho, destino }) => {
  const ff = (args) => execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 26 });
  const cf = crossfade / fps;
  const n = musicas.length;
  fs.mkdirSync(trabalho, { recursive: true });
  const dur = musicas.map((m) => Math.round(m.duracao * fps) / fps); // mesmo corte da <Sequence>
  const mp3 = (k) => path.join(pastaMp3, musicas[k].arquivo);
  const pedacos = [];
  const gerar = (nome, args) => {
    const arq = path.join(trabalho, nome);
    if (!fs.existsSync(arq)) {
      ff([...args, ...PCM, arq + ".tmp"]);
      fs.renameSync(arq + ".tmp", arq);
    }
    pedacos.push(arq);
  };

  for (let k = 0; k < n; k++) {
    const ini = k > 0 ? cf : 0;
    const fim = k < n - 1 ? dur[k] - cf : dur[k];
    const id = String(k).padStart(3, "0");
    gerar(`${id}-corpo.wav`, ["-i", mp3(k), "-af", `atrim=start=${ini}:end=${fim},asetpts=PTS-STARTPTS,${normaliza}`]);
    if (k < n - 1) {
      const sai = `[0:a]atrim=start=${dur[k] - cf}:end=${dur[k]},asetpts=PTS-STARTPTS,${normaliza},volume=eval=frame:volume='cos(t/${cf}*PI/2)'[s]`;
      const entra = `[1:a]atrim=start=0:end=${cf},asetpts=PTS-STARTPTS,${normaliza},volume=eval=frame:volume='sin(t/${cf}*PI/2)'[e]`;
      gerar(`${id}-juncao.wav`, [
        "-i", mp3(k), "-i", mp3(k + 1),
        "-filter_complex", `${sai};${entra};[s][e]amix=inputs=2:normalize=0:duration=longest[j]`,
        "-map", "[j]",
      ]);
    }
  }

  const lista = path.join(trabalho, "lista.txt");
  fs.writeFileSync(lista, pedacos.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n") + "\n");
  // libfdk_aac: ~3× mais rápido que o aac nativo (que roda num núcleo só e se arrasta em 3 h de áudio)
  ff(["-f", "concat", "-safe", "0", "-i", lista, "-c:a", "libfdk_aac", "-b:a", "320k", "-f", "mp4", destino]);
};

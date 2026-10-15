import { measureText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { Easing, Img, interpolate, interpolateColors, staticFile, useCurrentFrame } from "remotion";
import { fontFamily } from "./fonte";
import { COR, W, fase, onda, pulso } from "./loop";

export type Musica = {
  readonly titulo: string;
  readonly artista: string;
  readonly capa: string; // URL ou arquivo em public/ ("" = nota musical)
  readonly audio: string; // arquivo em public/ ("" = sem áudio)
  readonly duracao: number; // segundos
  readonly inicio: number; // quadro em que o áudio entra (já descontado o crossfade)
};

// geometria do card (px)
const TOPO = 548;
const ALT = 172;
const CAPA = 132;
const VINIL = 46; // quanto o vinil aparece atrás da capa
const PAD_E = 20;
const PAD_D = 44;
const VAO = 34;
const ROTULO = 340; // "Tocando agora" + equalizador
const TEXTO_MAX = 920;
const FIXO = PAD_E + CAPA + VINIL + VAO + PAD_D + 4;

// transição: começa ANTES quadros antes da virada e termina DEPOIS quadros depois
const ANTES = 12;
const DEPOIS = 20;
const suave = Easing.bezier(0.65, 0, 0.35, 1);
const salto = Easing.bezier(0.34, 1.56, 0.64, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const srcCapa = (capa: string) => (/^https?:\/\//.test(capa) ? capa : staticFile(capa));

/** Largura do card para caber o título e o artista (com teto; o resto vira reticências). */
const larguraCard = (m: Musica) => {
  const t = measureText({ text: m.titulo, fontFamily, fontSize: 48, fontWeight: "700" }).width;
  const a = m.artista ? measureText({ text: m.artista, fontFamily, fontSize: 30, fontWeight: "400" }).width : 0;
  return FIXO + Math.min(TEXTO_MAX, Math.max(ROTULO, t, a) + 6);
};

// equalizador ao lado do "Tocando agora": [cor, vezes por ciclo]
const EQ: [string, number][] = [
  ["#00ff88", 114],
  ["#00ccff", 91],
  ["#ff00cc", 103],
  ["#ff6600", 84],
  ["#ffff00", 97],
];

/** Capa + textos de uma música. Duas camadas desta se cruzam na transição. */
const Conteudo: React.FC<{ m: Musica; opacity: number; dy: number; escalaCapa: number }> = ({ m, opacity, dy, escalaCapa }) => {
  const frame = useCurrentFrame();
  const p = pulso(frame, 4);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        gap: VAO,
        padding: `0 ${PAD_D}px 0 ${PAD_E}px`,
        opacity,
      }}
    >
      {/* capa com o vinil saindo por trás */}
      <div style={{ position: "relative", width: CAPA + VINIL, height: CAPA, flexShrink: 0, scale: `${escalaCapa}` }}>
        <div
          style={{
            position: "absolute",
            left: VINIL,
            top: 6,
            width: CAPA - 12,
            height: CAPA - 12,
            borderRadius: "50%",
            background: "repeating-radial-gradient(circle, #111 0 3px, #1c1c1c 3px 5px)",
            boxShadow: "0 0 0 1px #2a2a2a",
            rotate: `${360 * fase(frame, 16)}deg`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* reflexo, para o giro aparecer */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, transparent 0 20%, rgba(255,255,255,.1) 25%, transparent 30% 70%, rgba(255,255,255,.07) 75%, transparent 80%)" }} />
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: COR.laranja, boxShadow: "inset 0 0 0 11px #DB7944, inset 0 0 0 13px #060606" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: CAPA,
            height: CAPA,
            borderRadius: 16,
            overflow: "hidden",
            scale: `${1 + 0.025 * p}`,
            boxShadow: "0 8px 24px rgba(0,0,0,.7), 0 0 0 1px rgba(255,247,235,.15)",
            background: `linear-gradient(135deg, ${COR.azul}, ${COR.vermelho})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {m.capa ? (
            <Img src={srcCapa(m.capa)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <svg viewBox="0 0 24 24" width={60} height={60} fill="none" stroke={COR.creme} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, translate: `0px ${dy}px` }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, color: COR.laranja, fontSize: 22, fontWeight: 600, letterSpacing: "0.3em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 22 }}>
            {EQ.map(([cor, vezes], k) => (
              <div key={k} style={{ width: 5, borderRadius: 2, background: cor, height: 12 + 10 * onda(frame, vezes, k * 0.21) }} />
            ))}
          </div>
          Tocando agora
        </div>
        <div style={{ marginTop: 6, color: COR.creme, fontSize: 48, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {m.titulo}
        </div>
        {m.artista ? (
          <div style={{ color: COR.creme, opacity: 0.7, fontSize: 30, fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {m.artista}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Card "Tocando agora" da playlist. `inicios` = quadro da virada de cada música.
 * Na virada, o card muda de largura para o novo título enquanto o conteúdo
 * antigo sobe e some e o novo entra por baixo.
 */
export const CardPlaylist: React.FC<{ musicas: Musica[]; inicios: number[] }> = ({ musicas, inicios }) => {
  const frame = useCurrentFrame();
  const larguras = useMemo(() => musicas.map(larguraCard), [musicas]);
  if (!musicas.length) return null;

  // música atual = última que já começou
  let i = 0;
  while (i + 1 < musicas.length && inicios[i + 1] <= frame) i++;

  // virada mais próxima em andamento (entrando na atual ou saindo para a próxima)
  let virada = -1;
  if (i >= 1 && frame < inicios[i] + DEPOIS) virada = i;
  else if (i + 1 < musicas.length && frame >= inicios[i + 1] - ANTES) virada = i + 1;

  const t = virada >= 1 ? frame - inicios[virada] : 0;
  const largura =
    virada >= 1
      ? interpolate(t, [-ANTES, DEPOIS * 0.7], [larguras[virada - 1], larguras[virada]], { ...clamp, easing: suave })
      : larguras[i];
  // clarão da borda no instante da troca
  const flash = virada >= 1 ? interpolate(t, [-ANTES, 0, DEPOIS], [0, 1, 0], clamp) : 0;

  const cor = interpolateColors(fase(frame, 8), [0, 1 / 3, 2 / 3, 1], [
    "rgba(255,0,200,0.45)",
    "rgba(0,255,255,0.45)",
    "rgba(255,220,0,0.45)",
    "rgba(255,0,200,0.45)",
  ]);

  return (
    <div
      style={{
        position: "absolute",
        top: TOPO,
        left: W / 2 - largura / 2,
        width: largura,
        height: ALT,
        background: "rgba(10,10,10,.84)",
        border: `2px solid rgba(219,121,68,${0.7 + 0.3 * flash})`,
        borderRadius: 30,
        overflow: "hidden",
        boxShadow: `0 0 ${40 + 40 * flash}px ${cor}, 0 0 ${60 * flash}px rgba(219,121,68,${0.8 * flash}), 0 20px 60px rgba(0,0,0,.6)`,
      }}
    >
      {virada >= 1 ? (
        <>
          <Conteudo
            m={musicas[virada - 1]}
            opacity={interpolate(t, [-ANTES, 0], [1, 0], clamp)}
            dy={interpolate(t, [-ANTES, 0], [0, -30], { ...clamp, easing: suave })}
            escalaCapa={interpolate(t, [-ANTES, 0], [1, 0.85], clamp)}
          />
          <Conteudo
            m={musicas[virada]}
            opacity={interpolate(t, [0, DEPOIS * 0.6], [0, 1], clamp)}
            dy={interpolate(t, [0, DEPOIS], [30, 0], { ...clamp, easing: suave })}
            escalaCapa={interpolate(t, [0, DEPOIS], [0.7, 1], { ...clamp, easing: salto })}
          />
        </>
      ) : (
        <Conteudo m={musicas[i]} opacity={1} dy={0} escalaCapa={1} />
      )}
    </div>
  );
};

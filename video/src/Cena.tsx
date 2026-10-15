import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { fontFamily } from "./fonte";
import { COR, fase, loopFrame, pulso } from "./loop";
import { Brilhos, Feixes } from "./Luzes";
import { Pista } from "./Pista";

/** Luzes de fundo nas cores da marca, girando devagar (1 volta por ciclo). */
const Fundo: React.FC = () => {
  const frame = useCurrentFrame();
  const a = fase(frame, 1) * Math.PI * 2;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(900px 600px at ${960 + 520 * Math.cos(a)}px ${340 + 140 * Math.sin(a)}px, ${COR.azul}cc, transparent 70%)`,
          `radial-gradient(800px 520px at ${960 - 520 * Math.cos(a)}px ${340 - 140 * Math.sin(a)}px, ${COR.vermelho}88, transparent 70%)`,
          COR.fundo,
        ].join(","),
      }}
    />
  );
};

const Titulo: React.FC<{ tag: string; data: string }> = ({ tag, data }) => {
  const frame = useCurrentFrame();
  const p = pulso(frame, 4);
  return (
    <AbsoluteFill style={{ alignItems: "center", top: 110 }}>
      <div style={{ color: COR.laranja, fontSize: 34, fontWeight: 600, letterSpacing: "0.45em", marginRight: "-0.45em", textTransform: "uppercase" }}>
        {tag}
      </div>
      <Img
        src={staticFile("LETTERING.png")}
        style={{
          width: 1160,
          marginTop: 18,
          scale: `${1 + 0.018 * p}`,
          filter: `drop-shadow(0 0 ${18 + 22 * p}px rgba(219,121,68,${0.55 + 0.35 * p})) drop-shadow(0 0 60px rgba(255,0,200,.25))`,
        }}
      />
      <div
        style={{
          marginTop: 22,
          color: COR.creme,
          fontSize: 60,
          fontWeight: 700,
          letterSpacing: "0.12em",
          marginRight: "-0.12em",
          textShadow: "0 0 24px rgba(219,121,68,.65), 0 4px 18px rgba(0,0,0,.9)",
        }}
      >
        {data}
      </div>
    </AbsoluteFill>
  );
};

/** Granulação de filme do app (.film-grain), trocando de semente a cada 2 quadros. */
const Grao: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = Math.floor(loopFrame(frame) / 2) % 12;
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%">
        <filter id="grao">
          <feTurbulence type="fractalNoise" baseFrequency={0.8} numOctaves={3} seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grao)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Pista completa; `children` (o card) entra acima da vinheta e abaixo do grão. */
export const Cena: React.FC<{ tag: string; data: string; children?: React.ReactNode }> = ({ tag, data, children }) => (
  <AbsoluteFill style={{ backgroundColor: COR.fundo, fontFamily, overflow: "hidden" }}>
    <Fundo />
    <Feixes />
    <Pista />
    <Brilhos />
    <Titulo tag={tag} data={data} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.75) 100%)" }} />
    {children}
    <Grao />
  </AbsoluteFill>
);

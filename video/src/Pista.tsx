import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BATIDA, NEONS, batida, hash, loopFrame, mod, pulso, rgba } from "./loop";

// mesma grade do app: 14 × 9 ladrilhos
const COLS = 14;
const ROWS = 9;

// Cada padrão diz se o ladrilho (i, j) acende na batida b do trecho.
// O ciclo tem 64 batidas = 8 trechos de 8 batidas, um padrão por trecho.
type Padrao = (i: number, j: number, b: number) => boolean;
const PADROES: Padrao[] = [
  (i, j, b) => mod(i + j - b, 4) === 0, // diagonais correndo
  (i, j, b) => mod(i + j + b, 2) === 0, // xadrez piscando
  (i, j, b) => mod(Math.round(Math.hypot(i - 6.5, (j - 4) * 1.4)) - b, 4) === 0, // ondas do centro
  (i, j, b) => hash(i, j, b, 3) > 0.62, // faíscas
  (i, _j, b) => mod(i - b * 2, COLS) < 3 || mod(COLS - 1 - i - b * 2, COLS) < 3, // varredura cruzada
  (_i, j, b) => mod(j + b, 3) === 0, // linhas subindo
  (i, j, b) => mod(Math.abs(i - 6.5) + Math.abs(j - 4) * 1.5 - b * 1.5, 6) < 1.6, // losango
  (i, j, b) => hash(i, j, b, 7) > 0.55, // faíscas densas
];

export const Pista: React.FC = () => {
  const frame = useCurrentFrame();
  const b = batida(frame);
  const trecho = Math.floor(b / 8);
  const padrao = PADROES[trecho];
  const forca = pulso(frame, 3);
  // brilho residual da batida anterior, para o piso não apagar de vez
  const anterior = PADROES[Math.floor(mod(b - 1, 64) / 8)];
  const sobra = 0.35 * Math.exp(-((loopFrame(frame) % BATIDA) / BATIDA) * 2);

  const ladrilhos = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const cor = NEONS[mod(i * 2 + j * 3 + trecho, NEONS.length)];
      const on = padrao(i, j, b);
      const antes = anterior(i, j, mod(b - 1, 64));
      const a = on ? 0.25 + 0.75 * forca : antes ? sobra : 0;
      ladrilhos.push(
        <div
          key={`${i}-${j}`}
          style={{
            border: "2px solid rgba(255,255,255,0.06)",
            background: rgba(cor, 0.42 * a),
            boxShadow:
              a > 0.02
                ? `inset 0 0 40px ${rgba(cor, 0.8 * a)}, 0 0 30px ${rgba(cor, 0.45 * a)}`
                : "none",
          }}
        />,
      );
    }
  }

  return (
    <AbsoluteFill style={{ perspective: 1100, perspectiveOrigin: "50% 38%" }}>
      <div
        style={{
          position: "absolute",
          left: (1920 - 3000) / 2,
          bottom: -120,
          width: 3000,
          height: 1500,
          transformOrigin: "50% 100%",
          transform: "rotateX(66deg)",
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          background: "#070707",
          // fundo da pista some no escuro
          maskImage: "linear-gradient(to top, black 45%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to top, black 45%, transparent 100%)",
        }}
      >
        {ladrilhos}
      </div>
    </AbsoluteFill>
  );
};

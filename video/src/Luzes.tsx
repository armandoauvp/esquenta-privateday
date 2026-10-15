import { AbsoluteFill, useCurrentFrame } from "remotion";
import { H, NEONS, W, fase, hash, onda, pulso, rgba } from "./loop";

// Refletores de palco presos no alto, varrendo a pista.
// [x, y, cor, ângulo base, amplitude, vezes por ciclo, defasagem]
const REFLETORES: [number, number, readonly number[], number, number, number, number][] = [
  [-60, -80, NEONS[0], -40, 16, 2, 0],
  [W + 60, -80, NEONS[1], 40, 16, 2, 0.5],
  [560, -100, NEONS[2], -8, 22, 4, 0.25],
  [W - 560, -100, NEONS[3], 8, 22, 4, 0.75],
  [220, -100, NEONS[4], -22, 12, 1, 0.1],
  [W - 220, -100, NEONS[5], 22, 12, 1, 0.6],
];

export const Feixes: React.FC = () => {
  const frame = useCurrentFrame();
  const p = pulso(frame, 3);
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {REFLETORES.map(([x, y, cor, base, amp, vezes, desloc], k) => (
        <div
          key={k}
          style={{
            position: "absolute",
            left: x - 170,
            top: y,
            width: 340,
            height: 1600,
            transformOrigin: "50% 0%",
            rotate: `${base + amp * onda(frame, vezes, desloc)}deg`,
            clipPath: "polygon(47% 0, 53% 0, 100% 100%, 0 100%)",
            background: `linear-gradient(to bottom, ${rgba(cor, 0.55)}, ${rgba(cor, 0.12)} 55%, transparent)`,
            opacity: 0.2 + 0.18 * p,
            filter: "blur(6px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Pontinhos de luz deslizando pela cena. */
export const Brilhos: React.FC = () => {
  const frame = useCurrentFrame();
  const margem = 60;
  const larg = W + margem * 2;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {Array.from({ length: 50 }, (_, k) => {
        const sentido = hash(k, 1) > 0.5 ? 1 : -1;
        const voltas = hash(k, 2) > 0.7 ? 2 : 1;
        // volta inteira: sai por um lado e reentra pelo outro, fora da tela
        const x = (((hash(k, 3) + sentido * fase(frame, voltas)) % 1) + 1) % 1 * larg - margem;
        const y = 30 + hash(k, 4) * (H * 0.55) + 18 * onda(frame, voltas, hash(k, 5));
        const tam = 3 + hash(k, 6) * 7;
        const cor = NEONS[Math.floor(hash(k, 7) * NEONS.length)];
        const branco = hash(k, 8) > 0.5;
        const tw = 0.5 + 0.5 * onda(frame, 8 + Math.floor(hash(k, 9) * 8), hash(k, 10));
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: tam,
              height: tam,
              borderRadius: "50%",
              background: branco ? "#fff" : rgba(cor, 1),
              boxShadow: `0 0 ${tam * 2}px ${branco ? "rgba(255,255,255,.9)" : rgba(cor, 0.9)}`,
              opacity: 0.12 + 0.5 * tw,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Relógio do loop. Regra de ouro: TODO movimento depende de fase()/onda() com
// `vezes` INTEIRO — assim o quadro seguinte ao último é idêntico ao primeiro e
// várias cópias do vídeo emendam sem costura.
export const FPS = 30;
export const LOOP_S = 32;
export const LOOP = FPS * LOOP_S; // 960 quadros
export const BPM = 120;
export const BATIDA = (FPS * 60) / BPM; // 15 quadros
export const BATIDAS = LOOP / BATIDA; // 64 batidas por ciclo

export const W = 1920;
export const H = 1080;

// paleta do app
export const COR = {
  fundo: "#050505",
  laranja: "#DB7944",
  azul: "#0B2A47",
  vermelho: "#932621",
  creme: "#FFF7EB",
};
// neons dos ladrilhos (t-pink, t-cyan, t-yellow, t-orange, t-purple, t-green)
export const NEONS = [
  [255, 0, 200],
  [0, 255, 255],
  [255, 220, 0],
  [255, 100, 0],
  [160, 0, 255],
  [0, 255, 100],
] as const;

const mod = (n: number, m: number) => ((n % m) + m) % m;
export const loopFrame = (frame: number) => mod(frame, LOOP);

/** Posição 0..1 dentro de algo que se repete `vezes` vezes por ciclo. */
export const fase = (frame: number, vezes: number, desloc = 0) =>
  mod((loopFrame(frame) / LOOP) * vezes + desloc, 1);

/** Senoide -1..1 que fecha `vezes` voltas por ciclo. */
export const onda = (frame: number, vezes: number, desloc = 0) =>
  Math.sin(fase(frame, vezes, desloc) * Math.PI * 2);

/** Índice da batida atual (0..63). */
export const batida = (frame: number) => Math.floor(loopFrame(frame) / BATIDA);

/** Pancada da batida: 1 no início, decai até a próxima. */
export const pulso = (frame: number, dureza = 4) =>
  Math.exp(-((loopFrame(frame) % BATIDA) / BATIDA) * dureza);

/** Pseudoaleatório determinístico 0..1 (mesmo resultado em todo render). */
export const hash = (...n: number[]) => {
  const x =
    Math.sin(n.reduce((acc, v, i) => acc + v * (127.1 + i * 311.7), 0)) *
    43758.5453;
  return x - Math.floor(x);
};

export const rgba = (c: readonly number[], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export { mod };

# Pista em loop — vídeo de fundo do Esquenta

Animação da pista do Esquenta AUVP Private Day feita em [Remotion](https://www.remotion.dev).
É o vídeo que sobe para o YouTube e vira a playlist da casa (`FALLBACK_VIDEO` no `index.html`, hoje `5D_Of9Zpsgs`). Trocou o vídeo? Atualize também `duracaoFallback` (duração em segundos), que é fixa de propósito.

Projeto separado do app: tem `package.json` próprio e fica fora do deploy da Vercel (`.vercelignore`).

## Loop perfeito

Um ciclo dura **32 s** (960 quadros a 30 fps, 64 batidas a 120 BPM). Todo movimento depende de
`fase()`/`onda()` em `src/loop.ts`, sempre com um número **inteiro** de repetições por ciclo. Com isso,
o quadro seguinte ao último é idêntico ao primeiro, e cópias emendadas não mostram costura.

Ao mexer na animação, mantenha a regra: nada de `Math.random()`, `Date.now()` ou períodos que não
dividam o ciclo (use `hash()` para variação e `vezes` inteiro em `fase/onda`).

## Comandos

```bash
npm i                 # dependências
npm run dev           # Remotion Studio (pré-visualização)
npm run render        # 1 ciclo → out/pista-loop.mp4
npm run render:longo  # 19 cópias emendadas (~10 min) → out/pista-loop-10min.mp4
```

Para mudar a duração da versão longa, ajuste o `-stream_loop` em `package.json` (número de cópias − 1).

## Card "Tocando agora" (uma versão por música)

A parte de baixo mostra a capa e o nome da música. Os dados entram como props, num JSON por música
(modelo em `musicas/exemplo.json`):

```json
{ "tag": "Esquenta 2026", "data": "7 E 8 DE NOVEMBRO",
  "titulo": "Nome da música", "artista": "Artista", "capa": "capas/nome.jpg" }
```

```bash
npx remotion render PistaLoop out/nome.mp4 --crf=16 --props=musicas/nome.json
```

- `capa`: arquivo dentro de `public/` (ex.: `public/capas/nome.jpg`) ou URL. Prefira o arquivo local,
  porque URL remota pode estourar o tempo limite no render. Vazio = nota musical sobre o degradê da marca.
- `titulo` vazio = vídeo sem o card.
- Título longo é cortado com reticências.

## Onde mexer

| Arquivo | Conteúdo |
|---|---|
| `src/Root.tsx` | composição e props padrão |
| `src/loop.ts` | relógio do loop, paleta e helpers |
| `src/Pista.tsx` | ladrilhos 14 × 9 e os 8 padrões de luz |
| `src/Luzes.tsx` | refletores de palco e brilhos |
| `src/TocandoAgora.tsx` | card com capa, vinil girando, equalizador e nome da música |
| `src/PistaLoop.tsx` | fundo, título (`LETTERING.png` + data), vinheta e granulação |
| `public/` | cópia do `LETTERING.png` (e as capas) |

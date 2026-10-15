import { Audio } from "@remotion/media";
import { useMemo } from "react";
import { CalculateMetadataFunction, Sequence, staticFile } from "remotion";
import { CardPlaylist, Musica } from "./Card";
import { Cena } from "./Cena";
import { FPS } from "./loop";

export type PlaylistProps = {
  readonly tag: string;
  readonly data: string;
  readonly crossfade: number; // quadros em que uma faixa se sobrepõe à seguinte
  readonly musicas: Musica[];
};

// A linha do tempo vem pronta nas props (`inicio` de cada faixa, gerado por
// scripts/gerar-playlist.mjs). Daqui saem só a virada do card e o fim do vídeo.

/** Quadro em que o card troca: no meio do crossfade. */
export const viradasDe = (musicas: Musica[], crossfade: number) =>
  musicas.map((m, k) => (k === 0 ? 0 : m.inicio + Math.floor(crossfade / 2)));

export const duracaoPlaylist = (musicas: Musica[]) => {
  const ultima = musicas[musicas.length - 1];
  return ultima ? ultima.inicio + Math.round(ultima.duracao * FPS) : 1;
};

export const calcularPlaylist: CalculateMetadataFunction<PlaylistProps> = ({ props }) => ({
  durationInFrames: duracaoPlaylist(props.musicas),
});

/** Playlist inteira num vídeo só: o fundo segue em loop e o card troca a cada faixa. */
export const Playlist: React.FC<PlaylistProps> = ({ tag, data, crossfade, musicas }) => {
  const viradas = useMemo(() => viradasDe(musicas, crossfade), [musicas, crossfade]);
  const n = musicas.length;
  return (
    <Cena tag={tag} data={data}>
      <CardPlaylist musicas={musicas} inicios={viradas} />
      {musicas.map((m, k) => {
        if (!m.audio) return null;
        const dur = Math.round(m.duracao * FPS);
        return (
          <Sequence key={k} from={m.inicio} durationInFrames={dur} layout="none">
            <Audio
              src={staticFile(m.audio)}
              // crossfade de potência constante: seno entrando, cosseno saindo
              volume={(f) => {
                let v = 1;
                if (k > 0 && f < crossfade) v *= Math.sin(((f / crossfade) * Math.PI) / 2);
                if (k < n - 1 && f > dur - crossfade) v *= Math.cos((((f - (dur - crossfade)) / crossfade) * Math.PI) / 2);
                return Math.max(0, v);
              }}
            />
          </Sequence>
        );
      })}
    </Cena>
  );
};

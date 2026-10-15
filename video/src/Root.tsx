import { Composition } from "remotion";
import { PistaLoop } from "./PistaLoop";
import { Playlist, calcularPlaylist } from "./Playlist";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 1 ciclo exato (32 s × 30 fps = 960 quadros, LOOP em loop.ts): cópias emendam sem costura */}
      <Composition
        id="PistaLoop"
        component={PistaLoop}
        durationInFrames={960}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          tag: "Esquenta 2026",
          data: "7 E 8 DE NOVEMBRO",
          titulo: "",
          artista: "",
          capa: "",
        }}
      />
      {/* playlist inteira num vídeo só; a duração sai da soma das faixas (npm run playlist gera as props) */}
      <Composition
        id="Playlist"
        component={Playlist}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        calculateMetadata={calcularPlaylist}
        defaultProps={{
          tag: "Esquenta 2026",
          data: "7 E 8 DE NOVEMBRO",
          crossfade: 90,
          musicas: [
            { titulo: "I Wish", artista: "Stevie Wonder", capa: "capas/i-wish.jpg", audio: "audio/i-wish.mp3", duracao: 252.577959, inicio: 0 },
            {
              titulo: "Ripa Na Xulipa - Extended Charles Maurice Version",
              artista: "Rabo De Saia, Charles Maurice",
              capa: "capas/ripa-na-xulipa-extended-charles-maurice-version.jpg",
              audio: "audio/ripa-na-xulipa-extended-charles-maurice-version.mp3",
              duracao: 328.608,
              inicio: 7487,
            },
          ],
        }}
      />
    </>
  );
};

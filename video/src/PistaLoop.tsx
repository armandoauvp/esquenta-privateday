import { CardPlaylist } from "./Card";
import { Cena } from "./Cena";

export type PistaLoopProps = {
  readonly tag: string;
  readonly data: string;
  // música do card "Tocando agora" (titulo vazio = sem card)
  readonly titulo: string;
  readonly artista: string;
  readonly capa: string; // URL ou arquivo em public/
};

/** Um ciclo da pista, mudo, com o card parado numa música (ou sem card). */
export const PistaLoop: React.FC<PistaLoopProps> = ({ tag, data, titulo, artista, capa }) => (
  <Cena tag={tag} data={data}>
    {titulo ? <CardPlaylist musicas={[{ titulo, artista, capa, audio: "", duracao: 0, inicio: 0 }]} inicios={[0]} /> : null}
  </Cena>
);

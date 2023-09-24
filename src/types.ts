export interface NowPlaying {
    is_playing: true;
    song: string;
    album: string;
    album_art: string;
    artist: string;
    total: number;
    start: number;
    track_id: string;
}

export interface NotPlaying {
    is_playing: false;
}

export type Status = NowPlaying | NotPlaying;

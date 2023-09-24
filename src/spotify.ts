import { tokenDb } from "./db.ts";
import { logger } from "./logger.ts";
import {
    currentlyPlayingResponseSchema,
    refreshTokenResponseSchema,
} from "./schemas.ts";
import { Status } from "./types.ts";
import { clientToken } from "./util.ts";

const accessTokens = new Map<string, string>();

export async function getAccessToken(userId: string): Promise<string | null> {
    const existingToken = accessTokens.get(userId);
    if (existingToken) return existingToken;

    const refreshTokenResult = await tokenDb.get([userId]);
    if (!refreshTokenResult.value) return null;
    const refreshToken = refreshTokenResult.value as string;

    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${clientToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
    });
    if (response.status === 400) {
        logger.debug(`User ${userId} has deauthorized the application`);
        tokenDb.delete([userId]);
        return null;
    }
    if (response.status !== 200) {
        throw new Error("Invalid status code " + response.status);
    }
    const unknownData = await response.json();
    const data = refreshTokenResponseSchema.parse(unknownData);

    accessTokens.set(userId, data.access_token);
    setTimeout(
        () => accessTokens.delete(userId),
        data.expires_in * 1_000 - 5_000,
    );

    return data.access_token;
}

export async function getUserNP(
    userId: string,
    accessToken: string,
): Promise<Status> {
    const now1 = Date.now();
    const response = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    );
    const now2 = Date.now();
    const now = (now1 + now2) / 2;
    if (response.status === 204) return { is_playing: false };
    if (response.status !== 200) {
        accessTokens.delete(userId);
        throw new Error("Invalid status code " + response.status);
    }
    const unknownData = await response.json();
    const data = currentlyPlayingResponseSchema.parse(unknownData);
    if (
        data.currently_playing_type !== "track" ||
        !data.is_playing
    ) return { is_playing: false };
    const startMs = now - data.progress_ms;
    const ms = startMs % 1000;
    const c = ms > 500 ? 1000 - ms : ms;
    const start = Math.floor((startMs + (c < 100 ? 500 : 0)) / 1000)
    return {
        is_playing: true,
        song: data.item.name,
        album: data.item.album.name,
        artist: data.item.artists.map((artist) => artist.name).join(", "),
        album_art: data.item.album.images[0].url,
        track_id: data.item.id,
        total: Math.floor(data.item.duration_ms / 1000),
        start,
    };
}

import { z } from "zod";

export const tokenResponseSchema = z.object({
    access_token: z.string(),
    expires_in: z.number(),
    refresh_token: z.string(),
});

export const refreshTokenResponseSchema = tokenResponseSchema.omit({
    refresh_token: true,
});

export const userResponseSchema = z.object({
    display_name: z.string(),
    id: z.string(),
});

export const currentlyPlayingResponseSchema = z.object({
    currently_playing_type: z.enum(["track", "episode", "ad", "unknown"]),
    is_playing: z.boolean(),
    progress_ms: z.number(),
    item: z.object({
        name: z.string(),
        album: z.object({
            name: z.string(),
            images: z.array(
                z.object({
                    url: z.string(),
                }),
            ),
        }),
        artists: z.array(
            z.object({
                name: z.string(),
            }),
        ),
        duration_ms: z.number(),
        id: z.string(),
    }),
});

export const clientMessageSchema = z.discriminatedUnion("op", [
    z
        .object({
            op: z.literal(2),
            d: z.string().min(1).max(32),
        })
        .strict(),
    z
        .object({
            op: z.literal(3),
        })
        .strict(),
]);

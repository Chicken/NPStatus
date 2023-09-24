import "dotenv";
import { z } from "zod";
import { formatError, logger } from "./logger.ts";

const runtime = {
    PORT: Deno.env.get("PORT"),
    CALLBACK_URL: Deno.env.get("CALLBACK_URL"),
    CLIENT_ID: Deno.env.get("CLIENT_ID"),
    CLIENT_SECRET: Deno.env.get("CLIENT_SECRET"),
    UPDATE_INTERVAL: Deno.env.get("UPDATE_INTERVAL"),
};

const envSchema = z.object({
    PORT: z.coerce.number(),
    CALLBACK_URL: z.string(),
    CLIENT_ID: z.string(),
    CLIENT_SECRET: z.string(),
    UPDATE_INTERVAL: z.coerce.number(),
}).strict();

const parsed = envSchema.safeParse(runtime);

if (!parsed.success) {
    logger.error("Invalid environment variables\n", formatError(parsed.error));
    Deno.exit(1);
}

export const env = parsed.data;

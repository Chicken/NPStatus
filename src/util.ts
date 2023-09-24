import { env } from "./env.ts";

export const clientToken = btoa(
    `${env.CLIENT_ID}:${env.CLIENT_SECRET}`,
);

export function safeJsonParse(data: unknown): unknown {
    try {
        return JSON.parse(String(data));
    } catch {
        return null;
    }
}

export function shallowEqual(obj1: unknown, obj2: unknown) {
    if (
        !obj1 || !obj2 || typeof obj1 !== "object" || typeof obj2 !== "object"
    ) return false;
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    for (const key of keys1) {
        if (
            (obj1 as Record<string, unknown>)[key] !==
                (obj2 as Record<string, unknown>)[key]
        ) return false;
    }
    return true;
}

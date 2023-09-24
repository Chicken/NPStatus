import cors from "cors";
// @deno-types="@types/express"
import express from "express";
import { rateLimit } from "express-rate-limit";
// @deno-types="@types/ws"
import { WebSocket, WebSocketServer } from "ws";
import { tokenDb } from "./db.ts";
import { env } from "./env.ts";
import { formatError, logger } from "./logger.ts";
import {
    clientMessageSchema,
    tokenResponseSchema,
    userResponseSchema,
} from "./schemas.ts";
import { getAccessToken, getUserNP } from "./spotify.ts";
import { Status } from "./types.ts";
import { clientToken, safeJsonParse, shallowEqual } from "./util.ts";

const app = express();
app.use(cors({ origin: "*" }));

const server = app.listen(env.PORT);

app.get("/", (_req, res) => {
    res.sendFile("index.html", { root: "./public" });
});

app.get("/logged-in", (_req, res) => {
    res.sendFile("logged-in.html", { root: "./public" });
});

app.get("/spotify.png", (_req, res) => {
    res.sendFile("spotify.png", { root: "./public" });
});

const loginRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-6",
    legacyHeaders: true,
    message: {
        message: "Too many requests, please try again later.",
    },
    keyGenerator: (req) => req.headers["x-forwarded-for"] as string,
});

const dataRestRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-6",
    legacyHeaders: true,
    message: {
        message: "Too many requests, please use the websocket gateway.",
    },
    keyGenerator: (req) => req.headers["x-forwarded-for"] as string,
});

app.get("/api/login", loginRateLimit, (_req, res) => {
    res.redirect(
        `https://accounts.spotify.com/authorize?client_id=${env.CLIENT_ID}&response_type=code&redirect_uri=${
            encodeURIComponent(
                env.CALLBACK_URL,
            )
        }&scope=user-read-currently-playing`,
    );
});

app.get("/api/callback", loginRateLimit, async (req, res) => {
    const code = req.query.code;

    if (typeof code !== "string" || !/^[A-Za-z0-9_\-]+$/.test(code)) {
        res.status(400).json({
            message: "Bad code",
        });
        return;
    }

    const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${clientToken}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `grant_type=authorization_code&code=${
                encodeURIComponent(code)
            }&redirect_uri=${encodeURIComponent(env.CALLBACK_URL)}`,
        },
    ).catch((e: Error) => ({ err: e }));
    if ("err" in tokenResponse) {
        logger.error(
            "Error while fetching token",
            formatError(tokenResponse.err),
        );
        res.status(500).json({
            message: "Error while fetching token",
        });
        return;
    }
    if (tokenResponse.status === 400) {
        res.status(400).json({
            message: "Bad code",
        });
        return;
    }

    const tokenUnknownData = await tokenResponse.json().catch(() =>
        null
    ) as unknown;
    const tokenParsed = tokenResponseSchema.safeParse(tokenUnknownData);
    if (
        tokenResponse.status !== 200 || tokenUnknownData == null ||
        !tokenParsed.success
    ) {
        logger.error(
            "Bad response from spotify, status",
            tokenResponse.status,
            tokenParsed.success ? "" : "\n" + formatError(tokenParsed.error),
        );
        res.status(500).json({
            message: "Bad response from spotify",
        });
        return;
    }
    const tokenData = tokenParsed.data;

    const userResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
        },
    }).catch((e: Error) => ({ err: e }));
    if ("err" in userResponse) {
        logger.error(
            "Error while fetching user profile",
            formatError(userResponse.err),
        );
        res.status(500).json({
            message: "Error while fetching user profile",
        });
        return;
    }
    const userUnknownData = await userResponse.json().catch(() =>
        null
    ) as unknown;
    const userParsed = userResponseSchema.safeParse(userUnknownData);
    if (
        userResponse.status !== 200 || userUnknownData == null ||
        !userParsed.success
    ) {
        logger.error(
            "Bad response from spotify, status",
            tokenResponse.status,
            userParsed.success ? "" : "\n" + formatError(userParsed.error),
        );
        res.status(500).json({
            message: "Bad response from spotify",
        });
        return;
    }
    const userData = userParsed.data;

    await tokenDb.set([userData.id], tokenData.refresh_token);

    logger.log(
        `User ${userData.display_name} (${userData.id}) authorized the application`,
    );

    res.redirect(
        `/logged-in?display_name=${
            encodeURIComponent(userData.display_name)
        }&id=${encodeURIComponent(userData.id)}`,
    );
});

const statusCache = new Map<string, Status>();

app.get("/api/np/:userId", dataRestRateLimit, async (req, res) => {
    if (!/^[A-Za-z0-9]+$/.test(req.params.userId)) {
        res.status(400).json({
            message: "Bad user id",
        });
        return;
    }
    const existingStatus = statusCache.get(req.params.userId);
    if (existingStatus) {
        res.json(existingStatus);
        return;
    }
    try {
        const accessToken = await getAccessToken(req.params.userId);
        if (!accessToken) {
            logger.debug(
                `User ${req.params.userId} has not authorized the application`,
            );
            res.status(400).json({
                message: "User has not authorized the application.",
            });
            return;
        }
        try {
            res.json(await getUserNP(req.params.userId, accessToken));
        } catch (e: unknown) {
            logger.error(
                "Error fetching user status",
                formatError(e),
            );
            res.status(500).json({
                message: "Error fetching user status",
            });
        }
    } catch (err: unknown) {
        logger.error(
            "Error fetching user access token",
            formatError(err),
        );
        res.status(500).json({
            message: "Error fetching user status",
        });
    }
});

const HEARTBEAT_INTERVAL = 15_000;
const CALLBACK_TIMEOUT = 10_000;

const subscribedUsers = new Map<string, number>();
const socketSubscriptions = new Map<WebSocket, string>();
const socketHeartbeats = new WeakMap<WebSocket, number>();

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, res, head) => {
    wss.handleUpgrade(req, res, head, (socket) => {
        wss.emit("connection", socket);
    });
});

wss.on("connection", (ws) => {
    logger.log(
        `New websocket connection, current connections: ${wss.clients.size}`,
    );
    ws.send(
        JSON.stringify({
            op: 1,
            d: {
                heartbeat_interval: HEARTBEAT_INTERVAL,
            },
        }),
    );
    setTimeout(() => {
        if (socketSubscriptions.has(ws)) return;
        if (ws.readyState === WebSocket.OPEN) {
            logger.debug("Websocket didn't initialize in time");
            ws.send(
                JSON.stringify({
                    op: 4,
                    d: "No initialization in time",
                }),
            );
        }
        ws.close();
    }, CALLBACK_TIMEOUT);
    const heartbeat = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            logger.debug("Websocket didn't send heartbeat in time");
            ws.send(
                JSON.stringify({
                    op: 4,
                    d: "No heartbeat received",
                }),
            );
            ws.close();
        }
    }, HEARTBEAT_INTERVAL * 1.5);
    socketHeartbeats.set(ws, heartbeat);

    ws.on("message", async (rawData) => {
        const jsonData = safeJsonParse(rawData);
        const parsed = clientMessageSchema.safeParse(jsonData);
        if (!parsed.success) {
            logger.debug("Websocket sent a bad message");
            ws.send(
                JSON.stringify({
                    op: 4,
                    d: "Bad message",
                }),
            );
            ws.close();
            return;
        }
        const data = parsed.data;
        logger.debug("Received a message", data);
        if (data.op === 3) {
            const oldHearbeat = socketHeartbeats.get(ws);
            if (oldHearbeat) clearTimeout(oldHearbeat);
            const heartbeat = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    logger.debug("Websocket didn't send heartbeat in time");
                    ws.send(
                        JSON.stringify({
                            op: 4,
                            d: "No heartbeat received",
                        }),
                    );
                    ws.close();
                }
            }, HEARTBEAT_INTERVAL * 1.5);
            socketHeartbeats.set(ws, heartbeat);
            return;
        } else if (data.op === 2) {
            const userId = data.d;
            const existing = socketSubscriptions.get(ws);
            if (existing) {
                logger.debug("Websocket already initialized");
                ws.send(
                    JSON.stringify({
                        op: 4,
                        d: "Already initialized.",
                    }),
                );
                ws.close();
                return;
            }
            if (statusCache.has(userId)) {
                ws.send(
                    JSON.stringify({
                        op: 0,
                        d: statusCache.get(userId),
                    }),
                );
            } else {
                let accessToken: string | null;
                try {
                    accessToken = await getAccessToken(userId);
                } catch (err: unknown) {
                    logger.error(
                        "Error fetching user access token",
                        formatError(err),
                    );
                    ws.send(
                        JSON.stringify({
                            op: 4,
                            d: "Error fetching user access token",
                        }),
                    );
                    ws.close();
                    return;
                }
                if (!accessToken) {
                    logger.debug(
                        `User ${userId} has not authorized the application`,
                    );
                    ws.send(
                        JSON.stringify({
                            op: 4,
                            d: "User has not authorized the application",
                        }),
                    );
                    ws.close();
                    return;
                }
                let status: Status;
                try {
                    status = await getUserNP(userId, accessToken);
                } catch (err: unknown) {
                    logger.error(
                        "Error fetching user status",
                        formatError(err),
                    );
                    ws.send(
                        JSON.stringify({
                            op: 4,
                            d: "Error fetching user status",
                        }),
                    );
                    ws.close();
                    return;
                }
                logger.debug(`Initial status for ${userId}`, status);
                statusCache.set(userId, status);
                ws.send(
                    JSON.stringify({
                        op: 0,
                        d: status,
                    }),
                );
            }
            socketSubscriptions.set(ws, userId);
            const count = subscribedUsers.get(userId);
            if (!count) {
                logger.debug(`Subscribed to ${userId}`);
                subscribedUsers.set(userId, 1);
            } else {
                subscribedUsers.set(userId, count + 1);
            }
            return;
        }
    });

    ws.on("close", () => {
        logger.log(
            `Websocket closed, current connections: ${wss.clients.size}`,
        );
        socketHeartbeats.delete(ws);
        const userId = socketSubscriptions.get(ws);
        if (!userId) return;
        socketSubscriptions.delete(ws);
        const count = subscribedUsers.get(userId);
        if (!count) return;
        if (count === 1) {
            logger.debug(`Unsubscribed to ${userId}`);
            subscribedUsers.delete(userId);
            statusCache.delete(userId);
        } else {
            subscribedUsers.set(userId, count - 1);
        }
    });
});

setInterval(async () => {
    for (const [user] of subscribedUsers) {
        let accessToken: string | null;
        try {
            accessToken = await getAccessToken(user);
        } catch (err: unknown) {
            logger.error(
                "Error fetching user access token",
                formatError(err),
            );
            continue;
        }
        if (!accessToken) continue;
        let status;
        try {
            status = await getUserNP(user, accessToken);
        } catch (err: unknown) {
            logger.error(
                "Error fetching user status",
                formatError(err),
            );
            continue;
        }
        const oldStatus = statusCache.get(user);
        if (shallowEqual(status, oldStatus)) continue;
        statusCache.set(user, status);
        logger.debug(`New status for ${user}`, status);
        for (const ws of wss.clients) {
            if (socketSubscriptions.get(ws) === user) {
                ws.send(
                    JSON.stringify({
                        op: 0,
                        d: status,
                    }),
                );
            }
        }
    }
}, env.UPDATE_INTERVAL);

logger.log(`Listening on port ${env.PORT}`);

Deno.addSignalListener("SIGINT", () => Deno.exit());
Deno.addSignalListener("SIGTERM", () => Deno.exit());

globalThis.addEventListener("unload", () => {
    logger.log("Exiting...");
    wss.close();
    server.close();
});

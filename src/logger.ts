import { blue, greenBright, redBright, yellow } from "colorette";
import { inspect } from "node:util";

const time = () =>
    blue(
        `[${
            new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000)
                .toISOString()
                .replace("T", " ")
                .split(".")[0]
        }]`,
    );

const dataToString = (
    data: unknown[],
    lineProcess: (line: string) => string = (line) => line,
) => data
    .map((
        e,
    ) => (typeof e !== "string" ? inspect(e, { colors: true, depth: 4 }) : e))
    .join(" ")
    .split("\n")
    .map(lineProcess)
    .join(`\n${" ".repeat(22)}`);

const line = () => {
    const e = new Error();
    if (!e.stack) return "";
    const stackLine = e.stack.split("\n")[3];
    const cwd = Deno.cwd();
    const [file, line] = stackLine.split(cwd)[1].split(":");
    if (!file || !line) return "";
    return ` [.${file}:${line}]`;
};

export const logger = {
    log: (...data: unknown[]) => console.log(`${time()} ${dataToString(data)}`),
    success: (...data: unknown[]) =>
        console.log(`${time()} ${dataToString(data, greenBright)}`),
    error: (...data: unknown[]) =>
        console.error(
            `${time()}${redBright(line())} ${dataToString(data, redBright)}`,
        ),
    debug: (...data: unknown[]) =>
        Deno.env.get("DEV") === "true"
            ? console.log(
                `${time()}${yellow(line())} ${dataToString(data, yellow)}`,
            )
            : void 0,
} as const;

export const formatError = (
    err: unknown,
) => (err instanceof Error ? err.stack ?? err.message : String(err));

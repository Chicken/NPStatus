await Deno.mkdir(new URL("../data", import.meta.url).pathname, {
    recursive: true,
});
export const tokenDb = await Deno.openKv(
    new URL("../data/kv.db", import.meta.url).pathname,
);

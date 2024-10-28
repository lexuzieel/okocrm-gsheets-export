import Keyv from "keyv";
import { KeyvFile } from "keyv-file";
import Debug from "debug";
import dotenv from "dotenv";

dotenv.config();

const debug = Debug("okocrm-api:cache");

const keyv = new Keyv(
    new KeyvFile({
        filename: "storage/cache.json",
    })
);

export const remember = async (
    key: string,
    fn: () => Promise<any>,
    ttl: number
) => {
    const value = await keyv.get(key);

    if (await keyv.has(key)) {
        debug(`Found cached value for key: ${key}`);

        return value;
    } else {
        debug(`Caching value for key: ${key}`);

        const value = await fn();
        await keyv.set(key, value, ttl);
        return value;
    }
};

export const forget = async (key: string) => {
    debug(`Clearing cache for key: ${key}`);

    return await keyv.delete(key);
};

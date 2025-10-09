import dotenv from "dotenv";
import crypto from "crypto";

import { main } from "./main.js";
import { CronJob } from "cron";

dotenv.config();

const schedules = (process.env.CRON_SCHEDULE || "*/15 * * * *")
    .split(",")
    .map((s) => s.trim());

const log = (message: string) => {
    console.log(message);
};

const time = (message: string) => {
    console.time(message);

    return () => {
        console.timeEnd(message);
    };
};

for (const schedule of schedules) {
    CronJob.from({
        cronTime: schedule,
        onTick: async () => {
            const id = crypto.randomUUID();
            const name = `${id} @ ${schedule}`;

            log(`Job ${name} started`);
            const span = time(`Job ${name} completed in`);

            await main();

            span();
        },
        start: true,
        waitForCompletion: true,
        timeZone: "Europe/Moscow",
    });

    console.log(`Scheduled job @ ${schedule}`);
}


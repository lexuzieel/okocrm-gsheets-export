import OkoCRM from "./okocrm-api/okocrm.js";
import Keyv from "keyv";
import { KeyvFile } from "keyv-file";
import ms from "ms";
import dotenv from "dotenv";
import { remember } from "./services/cache.js";
import Debug from "debug";

dotenv.config();

const debug = Debug("okocrm-api");

const api = new OkoCRM({
    apiKey: process.env.OKOCRM_API_KEY || "",
});

const leads = await api.leads.getLeads();

const pipelines = await remember(
    "pipelines",
    async () => await api.pipelines.getPipelines(),
    ms("1m")
);

console.log(pipelines);

// for (const pipeline of pipelines) {
//     console.log(pipeline, {
//         stages: await api.pipelines.getPipelineStages(pipeline.id),
//     });
// }

// const getPipelinesByName = async (names: string[]) => {
//     const pipelines = await api.pipelines.getPipelines();

//     return pipelines.filter((pipeline) => {
//         return names
//             .map((s) => s.toLocaleLowerCase().trim())
//             .includes(pipeline.name.toLocaleLowerCase().trim());
//     });
// };

// const pipelines = await getPipelinesByName(["первая покупка", "Пролонгация"]);

// for (const pipeline of pipelines) {
//     console.log(pipeline, {
//         stages: await api.pipelines.getPipelineStages(pipeline.id),
//     });
// }

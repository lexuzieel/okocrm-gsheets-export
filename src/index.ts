import OkoCRM from "./okocrm-api/okocrm.js";
import ms from "ms";
import dotenv from "dotenv";
import { remember } from "./services/cache.js";
import Debug from "debug";
import { Lead, Pipeline } from "./okocrm-api/types.js";

dotenv.config();

const debug = Debug("okocrm-api");

const api = new OkoCRM({
    apiKey: process.env.OKOCRM_API_KEY || "",
});

const pipelines = await remember(
    "pipelines",
    async () => await api.pipelines.getPipelines(),
    ms("1m")
);

const stages = await (async () => {
    const allStages = [];

    for (const pipeline of pipelines) {
        const stages = await remember(
            `pipelines:${pipeline.id}:stages`,
            async () => await api.pipelines.getPipelineStages(pipeline.id),
            ms("1m")
        );

        allStages.push(...stages);
    }

    return allStages;
})();

const activeStagesNames =
    process.env.EXPORT_STAGES?.split(",").map((s) =>
        s.toLocaleLowerCase().trim()
    ) || [];

const activeStages = stages.filter((stage) => {
    return activeStagesNames.includes(stage.name.toLocaleLowerCase().trim());
});

// const getPipelineById = (id: number) => {
//     return pipelines.find((p: Pipeline) => p.id === id);
// };

const leads = await api.leads.getLeads();

const leadsToExport = leads.filter((lead: Lead) => {
    return activeStages.map((stage) => stage.id).includes(lead.stages_id);
});

for (const lead of leadsToExport) {
    const { id, name } = lead;
    console.log({ id, name });
}

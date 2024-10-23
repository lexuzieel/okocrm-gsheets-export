import OkoCRM from "./okocrm-api/okocrm.js";
import ms from "ms";
import dotenv from "dotenv";
import { remember } from "./services/cache.js";
import Debug from "debug";
import { Lead, Pipeline, User } from "./okocrm-api/types.js";
import _ from "lodash";
import { DateTime, DurationLike } from "luxon";

dotenv.config();

const debug = Debug("okocrm-api");

const api = new OkoCRM({
    apiKey: process.env.OKOCRM_API_KEY || "",
});

const cacheDuration = ms("1d");

const users = await remember(
    "users",
    async () => await api.users.getUsers(),
    cacheDuration
);

const pipelines = await remember(
    "pipelines",
    async () => await api.pipelines.getPipelines(),
    cacheDuration
);

const stages = await (async () => {
    const allStages = [];

    for (const pipeline of pipelines) {
        const stages = await remember(
            `pipelines:${pipeline.id}:stages`,
            async () => await api.pipelines.getPipelineStages(pipeline.id),
            cacheDuration
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

const getLeads = async (duration: DurationLike = { days: 7 }) => {
    const result: Lead[] = [];

    const until = DateTime.now()
        .set({ hour: 0, minute: 0, second: 0 })
        .minus(duration);

    const timestamp = until.toUnixInteger();

    const d = debug.extend("leads");

    d(`Fetching leads until ${until.toSQLDate()}`);

    let page = 1;

    while (true) {
        d(`Fetching page ${page}`);

        const leads = await api.leads.getLeads(page++);

        result.push(...leads);

        if (
            leads[leads.length - 1]?.arrived_stage_at <= timestamp ||
            leads.length == 0
        ) {
            break;
        }
    }

    return result;
};

const leads = await remember(
    "leads",
    async () => await getLeads({ days: 7 }),
    ms("1h")
);

debug(`Got ${leads.length} leads`);

let leadsToExport: Lead[] = [];

for (const lead of leads.filter((lead: Lead) => {
    return activeStages.map((stage) => stage.id).includes(lead.stages_id);
})) {
    debug(`Fetching lead ${lead.id}`);
    leadsToExport.push(
        await remember(
            `leads:${lead.id}`,
            async () => await api.leads.getLead(lead.id),
            cacheDuration
        )
    );
}

const createEntryFromLead = (lead: Lead) => {
    const date = DateTime.fromMillis(lead.arrived_stage_at * 1000)
        .setLocale("ru-RU")
        .setZone("Europe/Moscow");

    const user = users.find((u: User) => u.id === lead.user_id);

    const policyStartDate = DateTime.fromSQL(_.get(lead, "cf_8705", ""));

    const bank = _.find(_.get(lead, "tabs.0.groups.1.fields.0.enums"), {
        id: _.get(lead, "cf_8700"),
    });

    const insurer_type = _.find(_.get(lead, "tabs.0.groups.2.fields.3.enums"), {
        id: _.get(lead, "cf_8717"),
    });

    return {
        sheet: {
            name: date.toFormat("LLLyy"),
        },
        data: {
            id: lead.id,
            date: date.toFormat("dd.MM.yyyy"),
            manager: user.full_name.short.split(/\s+/)[0],
            client: _.get(lead, "contacts.0.name"),
            policy: _.get(lead, "cf_8710"),
            type: _.map(_.map(_.get(lead, "cf_8706"), "name"), (name) => {
                if (name == "ЖИЗНЬ") {
                    return "Ж";
                } else if (name == "ИМУЩЕСТВО") {
                    return "И";
                }

                return name;
            }).join(""),
            policy_start: policyStartDate.isValid
                ? policyStartDate.toFormat("dd.MM.yyyy")
                : "-",
            insurer_company:
                insurer_type?.id == 13513
                    ? _.map(_.get(lead, "cf_8703"), "name").join(", ")
                    : insurer_type?.name,
            insurer_type: insurer_type?.name,
            bank: bank?.name,
            policy_amount: parseInt(_.get(lead, "cf_8712") || "") || 0,
            agent_amount: parseInt(lead.budget) || 0,
            agent_payment: _.get(lead, "cf_11080") != null,
        },
    };
};

for (const lead of leadsToExport) {
    console.log(createEntryFromLead(lead));
    break;
}

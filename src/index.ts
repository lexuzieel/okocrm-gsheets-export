import OkoCRM from "./okocrm-api/okocrm.js";
import ms from "ms";
import dotenv from "dotenv";
import { remember } from "./services/cache.js";
import Debug from "debug";
import { Lead, Pipeline, User } from "./okocrm-api/types.js";
import _ from "lodash";
import { DateTime, DurationLike } from "luxon";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

dotenv.config();

const debug = Debug("okocrm-api");

const api = new OkoCRM({
    apiKey: process.env.OKOCRM_API_KEY || "",
});

const cacheDuration = ms(process.env.CACHE_DURATION || "30m");

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
    async () =>
        await getLeads({ days: parseInt(process.env.EXPORT_DAYS || "") || 30 }),
    ms("1h")
);

debug(`Got ${leads.length} leads`);

let leadsToExport: Lead[] = [];

for (const lead of _.orderBy(leads, "arrived_stage_at").filter((lead: Lead) => {
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

type EntryData = {
    id: string;
    date: string;
    manager: string;
    client: string;
    policy: string;
    type: string;
    policy_start: string;
    insurer_company: string;
    bank: string;
    policy_amount: number;
    agent_amount: number;
    // discount: string;
    agent_payment: boolean;
};

type Entry = {
    sheet: {
        name: string;
    };
    data: EntryData;
    secondPolicy?: EntryData;
};

const createEntryFromLead = (lead: Lead): Entry => {
    const date = DateTime.fromMillis(lead.arrived_stage_at * 1000)
        .setLocale("ru-RU")
        .setZone("Europe/Moscow");

    const user = users.find((u: User) => u.id === lead.user_id);

    const policyStartDate = DateTime.fromSQL(_.get(lead, "cf_8705", ""));

    const bank = _.find(_.get(lead, "tabs.0.groups.1.fields.0.enums"), {
        id: _.get(lead, "cf_8700"),
    });

    const insurerType = _.find(_.get(lead, "tabs.0.groups.2.fields.3.enums"), {
        id: _.get(lead, "cf_8717"),
    });

    const hasSecondPolicy =
        _.get(lead, "cf_8797") != null || _.get(lead, "cf_8798") != null;

    const agent_amount = (() => {
        if (hasSecondPolicy) {
            return parseInt(_.get(lead, "cf_8798") || "") || 0;
        }

        return parseInt(lead.budget) || 0;
    })();

    const data = {
        id: lead.id.toString(),
        date: date.toFormat("dd.MM.yyyy"),
        manager: user.full_name.short.split(/\s+/)[0],
        client: _.get(lead, "contacts.0.name", "-"),
        policy: _.get(lead, "cf_8710", "-"),
        type: _.map(_.map(_.get(lead, "cf_8706"), "name"), (name: string) => {
            if (name.toLocaleUpperCase() == "ЖИЗНЬ") {
                return "Ж";
            } else if (name.toLocaleUpperCase() == "ИМУЩЕСТВО") {
                return "И";
            }

            return name;
        })
            .join(", ")
            .replace("Ж, И", "ЖИ"),
        policy_start: policyStartDate.isValid
            ? policyStartDate.toFormat("dd.MM.yyyy")
            : "-",
        insurer_company:
            (insurerType?.name == "Напрямую в Страховой"
                ? _.map(_.get(lead, "cf_8703"), "name").join(", ")
                : insurerType?.name) || "-",
        // insurer_type: insurer_type?.name || "-",
        bank: bank?.name || "-",
        policy_amount: parseInt(_.get(lead, "cf_8712") || "") || 0,
        agent_amount,
        agent_payment: _.get(lead, "cf_11080") != null,
    };

    const secondPolicyStartDate = DateTime.fromSQL(_.get(lead, "cf_8792", ""));

    const secondInsurerType = _.find(
        _.get(lead, "tabs.1.groups.0.fields.3.enums"),
        {
            id: _.get(lead, "cf_8796"),
        }
    );

    const secondInsurerCompany = _.find(
        _.get(lead, "tabs.1.groups.0.fields.2.enums"),
        {
            id: _.get(lead, "cf_8795"),
        }
    );

    const secondPolicy = {
        ...data,
        id: `${lead.id}-2`,
        policy_start: secondPolicyStartDate.isValid
            ? secondPolicyStartDate.toFormat("dd.MM.yyyy")
            : "-",
        insurer_company:
            (secondInsurerType?.name == "Напрямую в Страховой"
                ? secondInsurerCompany?.name
                : secondInsurerType?.name) || "-",
        type: _.map(_.map(_.get(lead, "cf_8799"), "name"), (name: string) => {
            if (name.toLocaleUpperCase() == "ЖИЗНЬ") {
                return "Ж";
            } else if (name.toLocaleUpperCase() == "ИМУЩЕСТВО") {
                return "И";
            }

            return name;
        })
            .join(", ")
            .replace("Ж, И", "ЖИ"),
        policy: _.get(lead, "cf_8794", "-"),
        policy_amount: parseInt(_.get(lead, "cf_8793") || "") || 0,
        agent_amount: parseInt(_.get(lead, "cf_8797") || "") || 0,
    };

    return {
        sheet: {
            name: date.toFormat("LLLyy"),
        },
        data,
        secondPolicy: hasSecondPolicy ? secondPolicy : undefined,
    };
};

const mapEntryToColumns = (data: EntryData) => {
    return {
        "№ ЗАЯВКИ": data.id,
        ДАТА: data.date,
        МЕНЕДЖЕР: data.manager,
        КЛИЕНТ: data.client,
        "№ ПОЛИСА": data.policy,
        "ТИП ПОЛИСА": data.type,
        "ДАТА НАЧАЛА": data.policy_start,
        СТРАХОВАЯ: data.insurer_company,
        БАНК: data.bank,
        "СУММА ПОЛИСА": data.policy_amount,
        "СУММА ПРИБЫЛИ": data.agent_amount,
        "Агент?": data.agent_payment,
    };
};

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: SCOPES,
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID || "", jwt);

await doc.loadInfo();

type RowToInsert = {
    sheetTitle: string;
    columns: object;
};

const rowsToInsert: RowToInsert[] = [];

for (const lead of leadsToExport) {
    const entry = createEntryFromLead(lead);

    const sheet = await (async () => {
        if (doc.sheetsByTitle[entry.sheet.name]) {
            // await doc.deleteSheet(doc.sheetsByTitle[entry.sheet.name].sheetId);
            return doc.sheetsByTitle[entry.sheet.name];
        }

        const template = doc.sheetsByTitle["Шаблон"];

        if (!template) {
            throw new Error("Шаблон не найден");
        }

        const response = await template.copyToSpreadsheet(doc.spreadsheetId);

        await doc.loadInfo();

        const sheet = doc.sheetsById[response.data.sheetId];

        await sheet.updateProperties({
            title: entry.sheet.name,
            index: 0,
        });

        await sheet.clearRows();

        return sheet;
    })();

    rowsToInsert.push({
        sheetTitle: sheet.title,
        columns: mapEntryToColumns(entry.data),
    });

    if (entry.secondPolicy) {
        rowsToInsert.push({
            sheetTitle: sheet.title,
            columns: mapEntryToColumns(entry.secondPolicy),
        });
    }
}

const tasks = _.map(
    _.groupBy(rowsToInsert, "sheetTitle"),
    async (rows, sheetTitle) => {
        const debug = Debug("okocrm-api:gsheets");

        const sheet = doc.sheetsByTitle[sheetTitle];

        await sheet.loadCells();

        const sheetRows = await sheet.getRows();

        const columns = _.filter(_.map(rows, "columns"), (row: any) => {
            const entryId = row["№ ЗАЯВКИ"];

            for (const sheetRow of sheetRows) {
                const rowId = sheetRow.get("№ ЗАЯВКИ");

                if (rowId == entryId) {
                    return false;
                }
            }

            return true;
        });

        if (columns.length > 0) {
            // @ts-ignore
            await doc.sheetsByTitle[sheetTitle].addRows(columns);
        }

        debug(
            `Added ${columns.length} entries to the worksheet: ${sheetTitle}`
        );
    }
);

await Promise.all(tasks);

debug("Done - waiting for restart");

// Wait indefinitely
await new Promise(() => {});

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
import exp from "constants";

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

const since = (duration: DurationLike) =>
    DateTime.now().set({ hour: 0, minute: 0, second: 0 }).minus(duration);

const exportLeadsSince = since({
    days: parseInt(process.env.EXPORT_DAYS || "") || 30,
});

const exportLeadsSinceTimestamp = exportLeadsSince.toUnixInteger();

const exportPages = parseInt(process.env.EXPORT_PAGES || "") || -1;

const withExponentialBackoff = async <T>(
    fn: () => Promise<T>,
    maxRetries: number = 9,
    baseDelay: number = 1000
): Promise<T> => {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (attempt === maxRetries) {
                throw lastError;
            }

            const delay = baseDelay * Math.pow(2, attempt);
            debug(
                `API call failed (attempt ${attempt + 1}/${
                    maxRetries + 1
                }), retrying in ${delay}ms: ${lastError.message}`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError!;
};

const getLeads = async (duration: DurationLike = { days: 7 }) => {
    const result: Lead[] = [];

    const d = debug.extend("leads");

    debug(`Fetching leads since ${exportLeadsSince.toSQLDate()}`);

    let page = 1;

    while (true) {
        const leads = await remember(
            `leads:page:${page}`,
            async () => {
                return await withExponentialBackoff(() =>
                    api.leads.getLeads(page)
                );
            },
            cacheDuration
        );

        page++;

        result.push(...leads);

        if ((page >= exportPages && exportPages > 0) || leads.length == 0) {
            break;
        }
    }

    return result;
};

const leads = await getLeads(exportLeadsSince);

debug(`Got ${leads.length} leads`);

const relevantLeads = _.orderBy(leads, "arrived_stage_at").filter(
    (lead: Lead) => {
        return (
            activeStages.map((stage) => stage.id).includes(lead.stages_id) &&
            lead.arrived_stage_at >= exportLeadsSinceTimestamp
        );
    }
);

debug(`Got ${relevantLeads.length} relevant leads (matching stage)`);

let leadsToExport: Lead[] = [];

for (const lead of relevantLeads) {
    leadsToExport.push(
        await remember(
            `leads:${lead.id}`,
            async () => {
                return await withExponentialBackoff(() =>
                    api.leads.getLead(lead.id)
                );
            },
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
    pipeline: string;
    stage: string;
    cashback: number;
    control_date: string;
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

    // Оплачивать агенту?
    const paidByAgent =
        _.get(
            _.find(_.get(lead, "tabs.0.groups.0.fields.3.enums"), {
                id: _.get(lead, "cf_11080"),
            }),
            "name"
        )?.toLocaleLowerCase() == "да";

    const hasSecondPolicy =
        _.get(lead, "cf_8797") != null || _.get(lead, "cf_8798") != null;

    const cashback = parseInt(_.get(lead, "cf_14412", "")) || 0;

    const agent_amount = (() => {
        if (hasSecondPolicy) {
            return parseInt(_.get(lead, "cf_8798") || "") || 0;
        }

        return (parseInt(lead.budget) || 0) - cashback;
    })();

    const controlDate = DateTime.fromSQL(_.get(lead, "cf_14410", ""));

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
            } else if (name.toLocaleUpperCase() == "ЖИЗНЬ; ИМУЩЕСТВО") {
                return "ЖИ";
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
        agent_payment: paidByAgent, // _.get(lead, "cf_11080") == 16907, // != null,
        pipeline: _.find(pipelines, { id: lead.pipeline_id })?.name,
        stage: _.find(stages, { id: lead.stages_id })?.name,
        cashback,
        control_date: controlDate.isValid
            ? controlDate.toFormat("dd.MM.yyyy")
            : "-",
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
            } else if (name.toLocaleUpperCase() == "ЖИЗНЬ; ИМУЩЕСТВО") {
                return "ЖИ";
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
            name:
                date.toFormat("LLL").replace(".", "") +
                "." +
                date.toFormat("yy"),
        },
        data,
        secondPolicy: hasSecondPolicy ? secondPolicy : undefined,
    };
};

const mapEntryToColumns = (data: EntryData) => {
    return {
        Сделка: `=HYPERLINK(CONCAT("https://strahov.okocrm.com/todos#lead-"; "${data.id}"); "Открыть 🡥")`,
        "№ ЗАЯВКИ": data.id,
        ДАТА: data.date,
        МЕНЕДЖЕР: data.manager,
        КЛИЕНТ: data.client,
        "№ ПОЛИСА": data.policy,
        "ТИП ПОЛИСА": data.type.length == 0 ? null : data.type,
        "ДАТА НАЧАЛА": data.policy_start,
        СТРАХОВАЯ: data.insurer_company,
        БАНК: data.bank,
        "СУММА ПОЛИСА": data.policy_amount,
        "СУММА ПРИБЫЛИ": data.agent_amount,
        "Агент?": data.agent_payment,
        ВОРОНКА: data.pipeline,
        ЭТАП: data.stage,
        КЭШБЭК: data.cashback,
        "Дата контроля": data.control_date,
        "% прибыли": data.agent_amount / data.policy_amount,
        "Дни до полиса":
            data.policy_start != "-" && data.date != "-"
                ? DateTime.fromFormat(data.policy_start, "dd.MM.yyyy")
                      .diff(
                          DateTime.fromFormat(data.date, "dd.MM.yyyy"),
                          "days"
                      )
                      .days.toString()
                : "-",
        "Дни до даты контроля":
            data.control_date != "-" && data.date != "-"
                ? DateTime.fromFormat(data.control_date, "dd.MM.yyyy")
                      .diff(
                          DateTime.fromFormat(data.date, "dd.MM.yyyy"),
                          "days"
                      )
                      .days.toString()
                : "-",
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

        let updated = 0;

        const promises = _.map(_.map(rows, "columns"), async (row: any) => {
            const entryId = row["№ ЗАЯВКИ"];

            for (const sheetRow of sheetRows) {
                const rowId = sheetRow.get("№ ЗАЯВКИ");

                if (rowId == entryId) {
                    // Update the row
                    const columns: any[string] =
                        _.find(_.map(rowsToInsert, "columns"), {
                            "№ ЗАЯВКИ": entryId,
                        }) || {};

                    const keys = _.without(
                        Object.keys(columns),
                        "Сделка",
                        "№ ЗАЯВКИ",
                        "ЭТАП",
                        "% прибыли"
                    );

                    let current: any[string] = {};

                    for (const key of keys) {
                        const value = (() => {
                            switch (key) {
                                case "СУММА ПОЛИСА":
                                case "СУММА ПРИБЫЛИ": {
                                    return parseFloat(
                                        sheetRow
                                            .get(key)
                                            .replace(/\s+/g, "")
                                            .replace(",", ".")
                                    );
                                }
                                case "КЭШБЭК":
                                    return parseInt(sheetRow.get(key));
                                case "Агент?":
                                    return sheetRow.get(key) == "TRUE";
                                default: {
                                    const value = sheetRow.get(key);

                                    if (
                                        typeof value == "string" &&
                                        value.length == 0
                                    ) {
                                        return null;
                                    }

                                    return value;
                                }
                            }
                        })();

                        current[key] = value;
                    }

                    const tainted = (() => {
                        for (const key of keys) {
                            if (columns[key] != current[key]) {
                                return true;
                            }
                        }

                        return false;
                    })();

                    if (tainted) {
                        debug(`Entry "${entryId}" is tainted - updating...`);

                        for (const column in columns) {
                            // @ts-ignore
                            sheetRow.set(column, columns[column]);
                        }

                        await sheetRow.save();

                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.random() * 1000)
                        );

                        updated++;
                    }

                    return null;
                }
            }

            return row;
        });

        // Filter out null values
        const columns = _.compact(await Promise.all(promises));

        if (columns.length > 0) {
            // @ts-ignore
            await doc.sheetsByTitle[sheetTitle].addRows(columns);
        }

        debug(
            `Added ${columns.length} entries to the worksheet: ${sheetTitle}`
        );

        debug(`Updated ${updated} entries in the worksheet: ${sheetTitle}`);
    }
);

await Promise.all(tasks);

const restartInterval = process.env.RESTART_INTERVAL || "1m";

debug(`Done - waiting for ${restartInterval} until restart`);

await new Promise<void>((resolve) => {
    setInterval(() => {
        resolve();
    }, ms(restartInterval));
});

debug("Restarting...");

process.exit(0);

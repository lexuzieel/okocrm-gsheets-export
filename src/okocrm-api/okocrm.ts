// OkoCRM.ts
import { AxiosInstance } from "axios";
import { createClient } from "./client.js";
import { Lead, Pipeline, PipelineStage } from "./types.js";
import { LeadsAPI } from "./endpoints/leads.js";
import { PipelinesAPI } from "./endpoints/pipelines.js";

interface OkoCRMOptions {
    apiKey: string;
}

class OkoCRM {
    private client: AxiosInstance;
    public leads: LeadsAPI;
    public pipelines: PipelinesAPI;

    constructor(options: OkoCRMOptions) {
        this.client = createClient(options);
        this.leads = new LeadsAPI(this.client);
        this.pipelines = new PipelinesAPI(this.client);
    }
}

export default OkoCRM;

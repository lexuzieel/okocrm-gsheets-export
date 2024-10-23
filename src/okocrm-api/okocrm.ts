import { AxiosInstance } from "axios";
import { createClient } from "./client.js";
import { LeadsAPI } from "./endpoints/leads.js";
import { PipelinesAPI } from "./endpoints/pipelines.js";
import { UsersAPI } from "./endpoints/users.js";

interface OkoCRMOptions {
    apiKey: string;
}

class OkoCRM {
    private client: AxiosInstance;
    public leads: LeadsAPI;
    public pipelines: PipelinesAPI;
    public users: UsersAPI;

    constructor(options: OkoCRMOptions) {
        this.client = createClient(options);
        this.leads = new LeadsAPI(this.client);
        this.pipelines = new PipelinesAPI(this.client);
        this.users = new UsersAPI(this.client);
    }
}

export default OkoCRM;

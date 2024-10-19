import { AxiosInstance, AxiosResponse } from "axios";
import { Lead } from "../types.js";

export class LeadsAPI {
    constructor(private client: AxiosInstance) {}

    async getLeads(): Promise<Lead[]> {
        try {
            const response: AxiosResponse<{ data: Lead[] }> =
                await this.client.get("/leads/");
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch leads: ${(error as Error).message}`
            );
        }
    }
}

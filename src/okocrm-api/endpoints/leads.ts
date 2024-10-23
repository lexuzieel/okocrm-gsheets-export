import { AxiosInstance, AxiosResponse } from "axios";
import { Lead } from "../types.js";

export class LeadsAPI {
    constructor(private client: AxiosInstance) {}

    async getLeads(page?: number): Promise<Lead[]> {
        try {
            const response: AxiosResponse<{ data: Lead[] }> =
                await this.client.get("/leads/", {
                    params: {
                        page: page || 1,
                    },
                });
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch leads: ${(error as Error).message}`
            );
        }
    }

    async getLead(id: number): Promise<Lead> {
        try {
            const response: AxiosResponse<{ data: Lead }> =
                await this.client.get(`/leads/${id}`);
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch lead ${id}: ${(error as Error).message}`
            );
        }
    }
}

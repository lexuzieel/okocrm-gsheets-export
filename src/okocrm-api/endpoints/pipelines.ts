import { AxiosInstance, AxiosResponse } from "axios";
import { Pipeline, PipelineStage } from "../types.js";

export class PipelinesAPI {
    constructor(private client: AxiosInstance) {}

    async getPipelines(): Promise<Pipeline[]> {
        try {
            const response: AxiosResponse<{ data: Pipeline[] }> =
                await this.client.get("/pipelines/");
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch pipelines: ${(error as Error).message}`
            );
        }
    }

    async getPipelineStages(pipelineId: number): Promise<PipelineStage[]> {
        try {
            const response: AxiosResponse<{ data: PipelineStage[] }> =
                await this.client.get(`/pipelines/stages/${pipelineId}`);
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch pipeline stages for pipeline ${pipelineId}: ${
                    (error as Error).message
                }`
            );
        }
    }
}

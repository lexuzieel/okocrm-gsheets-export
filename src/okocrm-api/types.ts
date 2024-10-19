export interface Lead {
    id: number;
    name: string;
    // Add other relevant fields based on the API response
}

export interface Pipeline {
    id: number;
    name: string;
    stages?: PipelineStage[];
}

export interface PipelineStage {
    id: number;
    name: string;
}

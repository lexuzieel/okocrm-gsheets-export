export interface Lead {
    id: number;
    name: string;
    // Add other relevant fields based on the API response
    stages_id: number;
    user_id: number;
    budget: string;
    arrived_stage_at: number;
    tabs: LeadTab[];
}

export interface LeadTab {
    id: number;
    name: string;
    groups: LeadTabGroup[];
}

export interface LeadTabGroup {
    id: number;
    name: string;
    fields: LeadTabGroupField[];
}

export interface LeadTabGroupField {
    id: number;
    name: string;
    var_name: string;
    var_type: LeadTabGroupFieldVarType;
    enums: LeadTabGroupFieldEnum[];
}

export interface LeadTabGroupFieldVarType {
    id: number;
    name: string;
    type: string;
}

export interface LeadTabGroupFieldEnum {
    id: number;
    name: string;
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

export interface User {
    id: number;
    name: string;
    email: string;
}

import axios, { AxiosInstance } from "axios";

interface ClientOptions {
    apiKey: string;
}

export const createClient = (options: ClientOptions): AxiosInstance => {
    return axios.create({
        baseURL: "https://api.okocrm.com/v2",
        headers: {
            Authorization: `Bearer ${options.apiKey}`,
            Accept: "application/json",
        },
    });
};

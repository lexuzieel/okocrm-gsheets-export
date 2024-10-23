import { AxiosInstance, AxiosResponse } from "axios";
import { User } from "../types.js";

export class UsersAPI {
    constructor(private client: AxiosInstance) {}

    async getUsers(): Promise<User[]> {
        try {
            const response: AxiosResponse<{ data: User[] }> =
                await this.client.get("/users/");
            return response.data.data;
        } catch (error) {
            throw new Error(
                `Failed to fetch users: ${(error as Error).message}`
            );
        }
    }
}

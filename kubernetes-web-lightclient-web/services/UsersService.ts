/**
 * Client for the existing admin `/api/users` routes (from
 * `@devopsplaybook.io/common-utils`). No backend change: the UI only wraps
 * the routes documented in the README.
 */
import axios from "axios";
import { AuthService } from "./AuthService";
import Config from "./Config";
import type { AppScope } from "./Scopes";

export interface AppUser {
  id: string;
  name: string;
  role: "admin" | "user" | string;
  scopes: AppScope[];
}

export interface CreateUserInput {
  name: string;
  password: string;
  role?: "admin" | "user";
  scopes?: AppScope[];
}

export interface UpdateUserInput {
  role?: "admin" | "user";
  scopes?: AppScope[];
  password?: string;
}

export interface SessionRefreshResult {
  token?: string;
  user?: AppUser;
}

async function serverUrl(): Promise<string> {
  return (await Config.get()).SERVER_URL;
}

function pickDefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export class UsersService {
  static async list(): Promise<AppUser[]> {
    const response = await axios.get(
      `${await serverUrl()}/users?limit=1000`,
      await AuthService.getAuthHeader(),
    );
    return response.data || [];
  }

  static async create(input: CreateUserInput): Promise<AppUser> {
    const response = await axios.post(
      `${await serverUrl()}/users`,
      pickDefined(input),
      await AuthService.getAuthHeader(),
    );
    return response.data.user;
  }

  static async update(id: string, input: UpdateUserInput): Promise<AppUser> {
    const response = await axios.put(
      `${await serverUrl()}/users/${encodeURIComponent(id)}`,
      pickDefined(input),
      await AuthService.getAuthHeader(),
    );
    return response.data.user;
  }

  static async remove(id: string): Promise<void> {
    await axios.delete(
      `${await serverUrl()}/users/${encodeURIComponent(id)}`,
      await AuthService.getAuthHeader(),
    );
  }

  /** Refreshes the JWT and returns the live role/scopes of the signed-in user. */
  static async refreshSession(): Promise<SessionRefreshResult> {
    const response = await axios.post(
      `${await serverUrl()}/users/session/refresh`,
      {},
      await AuthService.getAuthHeader(),
    );
    return response.data || {};
  }
}

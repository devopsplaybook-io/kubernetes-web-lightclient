import { Span } from "@opentelemetry/sdk-trace-base";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { CrdScannerGetBuiltinResources } from "./CrdScanner";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("UserResourceSelections");

const SELECTIONS_FILE_PATTERN = /^user-selections-([0-9a-f-]{36})\.json$/;

const USER_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function IsValidUserId(userId: string): boolean {
  return typeof userId === "string" && USER_ID_REGEX.test(userId);
}

export interface ListPreference {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: string[];
}

export interface UserSelections {
  selectedIds: string[];
  listPreferences: Record<string, ListPreference> | null;
  updatedAt: string;
}

const LIST_PREFERENCES_MAX_TYPES = 100;
const LIST_PREFERENCES_MAX_SORT_BY_LENGTH = 64;
const LIST_PREFERENCES_MAX_FILTERS = 16;
const LIST_PREFERENCES_MAX_FILTER_LENGTH = 32;
const LIST_PREFERENCES_MAX_JSON_BYTES = 16 * 1024;

function ParseSelectedIds(raw: string): string[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as string[];
    }
  } catch {
    // Fall through to defaults
  }
  return undefined;
}

function ParseListPreferences(
  raw: string | null | undefined,
): Record<string, ListPreference> | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, ListPreference>;
    }
    logger.warn("Invalid listPreferences stored, ignoring");
  } catch {
    logger.warn("Could not parse stored listPreferences, ignoring");
  }
  return null;
}

/**
 * Validates an untrusted listPreferences payload from the API. Returns the
 * cleaned map when valid, or null when the value is absent/malformed so the
 * caller can reject it. An empty object is valid.
 */
export function ValidateListPreferences(
  raw: unknown,
): Record<string, ListPreference> | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > LIST_PREFERENCES_MAX_TYPES) {
    return null;
  }
  const validated: Record<string, ListPreference> = {};
  for (const [typeId, value] of entries) {
    if (!typeId || typeof typeId !== "string" || typeId.length > 64) {
      return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const pref: ListPreference = {};
    const preference = value as Record<string, unknown>;
    if (preference.sortBy !== undefined) {
      if (
        typeof preference.sortBy !== "string" ||
        preference.sortBy.length === 0 ||
        preference.sortBy.length > LIST_PREFERENCES_MAX_SORT_BY_LENGTH
      ) {
        return null;
      }
      pref.sortBy = preference.sortBy;
    }
    if (preference.sortDir !== undefined) {
      if (preference.sortDir !== "asc" && preference.sortDir !== "desc") {
        return null;
      }
      pref.sortDir = preference.sortDir;
    }
    if (preference.filters !== undefined) {
      if (
        !Array.isArray(preference.filters) ||
        preference.filters.length > LIST_PREFERENCES_MAX_FILTERS
      ) {
        return null;
      }
      const filters: string[] = [];
      for (const filter of preference.filters) {
        if (
          typeof filter !== "string" ||
          filter.length === 0 ||
          filter.length > LIST_PREFERENCES_MAX_FILTER_LENGTH
        ) {
          return null;
        }
        filters.push(filter);
      }
      pref.filters = filters;
    }
    validated[typeId] = pref;
  }
  if (
    JSON.stringify(validated).length > LIST_PREFERENCES_MAX_JSON_BYTES
  ) {
    return null;
  }
  return validated;
}

export async function UserSelectionLoad(
  span: Span | undefined,
  config: Config,
  userId: string,
): Promise<UserSelections> {
  if (!IsValidUserId(userId)) {
    throw new Error("Invalid user id");
  }
  const rows = await DbUtilsQuerySQL(
    span,
    "SELECT selectedIds, listPreferences, dateUpdated FROM users_resource_selections WHERE userId = ?",
    [userId],
  );
  if (rows.length > 0) {
    const selectedIds = ParseSelectedIds(rows[0].selectedIds);
    if (selectedIds) {
      logger.info(`Loaded selections for user ${userId}`);
      return {
        selectedIds,
        listPreferences: ParseListPreferences(rows[0].listPreferences),
        updatedAt: rows[0].dateUpdated,
      };
    }
    logger.warn(`Invalid selections stored for user ${userId}, using defaults`);
  }

  // Default: select all built-in resources, persisted for next time
  const defaults: UserSelections = {
    selectedIds: CrdScannerGetBuiltinResources(),
    listPreferences: null,
    updatedAt: new Date().toISOString(),
  };
  await DbUtilsExecSQL(
    span,
    `INSERT INTO users_resource_selections (userId, selectedIds, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO NOTHING`,
    [
      userId,
      JSON.stringify(defaults.selectedIds),
      defaults.updatedAt,
      defaults.updatedAt,
    ],
  );
  return defaults;
}

export async function UserSelectionSave(
  span: Span | undefined,
  config: Config,
  userId: string,
  selectedIds: string[] | undefined,
  listPreferences?: Record<string, ListPreference> | null,
): Promise<void> {
  if (!IsValidUserId(userId)) {
    throw new Error("Invalid user id");
  }
  const now = new Date().toISOString();
  // A field that is not provided is bound as NULL so the COALESCE below keeps
  // the stored value: saves that only update one field stay compatible with
  // clients writing the other. selectedIds is NOT NULL in the schema, so the
  // initial insert falls back to the built-in defaults when it is not provided.
  const selectedIdsParam =
    selectedIds === undefined ? null : JSON.stringify(selectedIds);
  const listPreferencesParam =
    listPreferences === undefined || listPreferences === null
      ? null
      : JSON.stringify(listPreferences);
  await DbUtilsExecSQL(
    span,
    `INSERT INTO users_resource_selections (userId, selectedIds, listPreferences, dateCreated, dateUpdated)
     VALUES (?, COALESCE(?, ?), ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE
     SET selectedIds = COALESCE(?, users_resource_selections.selectedIds),
         listPreferences = COALESCE(?, users_resource_selections.listPreferences),
         dateUpdated = EXCLUDED.dateUpdated`,
    [
      userId,
      selectedIdsParam,
      JSON.stringify(CrdScannerGetBuiltinResources()),
      listPreferencesParam,
      now,
      now,
      selectedIdsParam,
      listPreferencesParam,
    ],
  );
  logger.info(
    `Saved selections for user ${userId}: ${
      selectedIds ? selectedIds.length : "unchanged"
    } types`,
  );
}

// One-time, idempotent import of the legacy per-user JSON files
// (user-selections-<userId>.json in DATA_DIR). Files are left in place.
export async function UserSelectionsDataInit(config: Config): Promise<void> {
  const files = await fse.readdir(config.DATA_DIR);
  let imported = 0;
  for (const file of files) {
    const match = SELECTIONS_FILE_PATTERN.exec(file);
    if (!match || !IsValidUserId(match[1])) {
      continue;
    }
    const userId = match[1];
    try {
      const data = await fse.readJson(path.join(config.DATA_DIR, file));
      if (
        !data ||
        !Array.isArray(data.selectedIds) ||
        !data.selectedIds.every((id: unknown) => typeof id === "string")
      ) {
        logger.warn(`Skipping selections file with invalid content: ${file}`);
        continue;
      }
      const existing = await DbUtilsQuerySQL(
        undefined,
        "SELECT userId FROM users_resource_selections WHERE userId = ?",
        [userId],
      );
      if (existing.length > 0) {
        continue;
      }
      const now = new Date().toISOString();
      await DbUtilsExecSQL(
        undefined,
        `INSERT INTO users_resource_selections (userId, selectedIds, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO NOTHING`,
        [userId, JSON.stringify(data.selectedIds), now, now],
      );
      imported++;
    } catch (error) {
      logger.warn(`Could not import selections file ${file}: ${error.message}`);
    }
  }
  logger.info(`${imported} selections imported`);
}

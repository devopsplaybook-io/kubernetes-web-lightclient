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

export interface UserSelections {
  selectedIds: string[];
  updatedAt: string;
}

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
    "SELECT selectedIds, dateUpdated FROM users_resource_selections WHERE userId = ?",
    [userId],
  );
  if (rows.length > 0) {
    const selectedIds = ParseSelectedIds(rows[0].selectedIds);
    if (selectedIds) {
      logger.info(`Loaded selections for user ${userId}`);
      return { selectedIds, updatedAt: rows[0].dateUpdated };
    }
    logger.warn(`Invalid selections stored for user ${userId}, using defaults`);
  }

  // Default: select all built-in resources, persisted for next time
  const defaults: UserSelections = {
    selectedIds: CrdScannerGetBuiltinResources(),
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
  selectedIds: string[],
): Promise<void> {
  if (!IsValidUserId(userId)) {
    throw new Error("Invalid user id");
  }
  const now = new Date().toISOString();
  await DbUtilsExecSQL(
    span,
    `INSERT INTO users_resource_selections (userId, selectedIds, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE
     SET selectedIds = EXCLUDED.selectedIds, dateUpdated = EXCLUDED.dateUpdated`,
    [userId, JSON.stringify(selectedIds), now, now],
  );
  logger.info(
    `Saved selections for user ${userId}: ${selectedIds.length} types`,
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

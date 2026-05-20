import * as fse from "fs-extra";
import * as path from "path";
import { Config } from "../Config";
import { CrdScannerGetBuiltinResources } from "./CrdScanner";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("UserResourceSelections");

const BASE_SELECTIONS_FILE = "user-selections";

export interface UserSelections {
  selectedIds: string[];
  updatedAt: string;
}

export function UserSelectionGetFilePath(
  config: Config,
  userId: string,
): string {
  return path.join(config.DATA_DIR, `${BASE_SELECTIONS_FILE}-${userId}.json`);
}

export async function UserSelectionLoad(
  config: Config,
  userId: string,
): Promise<UserSelections> {
  const filePath = UserSelectionGetFilePath(config, userId);
  try {
    if (await fse.pathExists(filePath)) {
      const data = await fse.readJson(filePath);
      if (data && Array.isArray(data.selectedIds)) {
        logger.info(`Loaded selections for user ${userId}`);
        return data as UserSelections;
      }
    }
  } catch (error) {
    logger.warn(
      `Could not load selections for user ${userId}: ${error.message}`,
    );
  }

  // Default: select all built-in resources
  const defaults: UserSelections = {
    selectedIds: CrdScannerGetBuiltinResources(),
    updatedAt: new Date().toISOString(),
  };
  // Save defaults to disk for next time
  try {
    await fse.ensureDir(path.dirname(filePath));
    await fse.writeJson(filePath, defaults, { spaces: 2 });
  } catch (error) {
    logger.error(
      `Failed to save default selections for user ${userId}: ${error.message}`,
      error,
    );
  }
  return defaults;
}

export async function UserSelectionSave(
  config: Config,
  userId: string,
  selectedIds: string[],
): Promise<void> {
  const selections: UserSelections = {
    selectedIds,
    updatedAt: new Date().toISOString(),
  };
  const filePath = UserSelectionGetFilePath(config, userId);
  try {
    await fse.ensureDir(path.dirname(filePath));
    await fse.writeJson(filePath, selections, { spaces: 2 });
    logger.info(
      `Saved selections for user ${userId}: ${selectedIds.length} types`,
    );
  } catch (error) {
    logger.error(
      `Failed to save selections for user ${userId}: ${error.message}`,
      error,
    );
    throw error;
  }
}

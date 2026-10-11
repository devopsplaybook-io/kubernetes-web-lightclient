// In-file counting uuid mock: the repo's global uuid mock
// (src/test-utils/uuid-mock.ts) returns a fixed value, which would collide
// user ids across this spec. This mock overrides it for this file only.
jest.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `mock-uuid-${++counter}` };
});

import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  DbUtilsExecSQL,
  DbUtilsGetDatabase,
  DbUtilsInit,
  DbUtilsQuerySQL,
  DbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { Config } from "../Config";
import {
  IsValidUserId,
  UserSelectionLoad,
  UserSelectionSave,
  UserSelectionsDataInit,
} from "./UserResourceSelections";
import { CrdScannerGetBuiltinResources } from "./CrdScanner";

const mockSpan = {
  setAttribute: jest.fn(),
  end: jest.fn(),
};

jest.mock("../OTelContext", () => ({
  OTelTracer: () => ({
    startSpan: () => mockSpan,
  }),
  OTelMeter: () => ({
    createObservableGauge: jest.fn(),
  }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}));

const mockTracer = {
  startSpan: jest.fn(() => ({
    end: jest.fn(),
    addEvent: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
  })),
} as unknown as StandardTracer;

const mockModuleLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockStandardLogger = {
  createModuleLogger: jest.fn(() => mockModuleLogger),
} as unknown as StandardLogger;

let baseDir: string;
let dataDir: string;
let config: Config;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function selectionsFilePath(userId: string): string {
  return path.join(dataDir, `user-selections-${userId}.json`);
}

function closeCurrentDb(): void {
  const db = DbUtilsGetDatabase() as unknown as
    | { close: () => void }
    | undefined;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  baseDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "user-selections-"));
  dataDir = path.join(baseDir, "data");
  nodeFs.mkdirSync(dataDir, { recursive: true });

  DbUtilsSetOTel(mockTracer, mockStandardLogger);

  // Boots a fresh instance against the real sql/ directory: this both
  // initializes the schema and proves init-0004.sql applies cleanly.
  await DbUtilsInit(
    undefined as never,
    { DATABASE_TYPE: "sqlite", DATA_DIR: dataDir } as never,
    path.resolve(__dirname, "../../sql"),
  );

  config = { DATA_DIR: dataDir } as unknown as Config;
});

afterEach(async () => {
  closeCurrentDb();
  nodeFs.rmSync(baseDir, { recursive: true, force: true });
});

describe("UserResourceSelections", () => {
  test("save then load round-trips the selected ids", async () => {
    await UserSelectionSave(undefined as never, config, USER_A, [
      "pod",
      "node",
    ]);

    const selections = await UserSelectionLoad(
      undefined as never,
      config,
      USER_A,
    );

    expect(selections.selectedIds).toEqual(["pod", "node"]);
    expect(typeof selections.updatedAt).toBe("string");
  });

  test("load for an unknown user returns built-in defaults and persists them", async () => {
    const selections = await UserSelectionLoad(
      undefined as never,
      config,
      USER_A,
    );

    expect(selections.selectedIds).toEqual(CrdScannerGetBuiltinResources());

    const rows = await DbUtilsQuerySQL(
      undefined as never,
      "SELECT selectedIds FROM users_resource_selections WHERE userId = ?",
      [USER_A],
    );
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].selectedIds)).toEqual(
      CrdScannerGetBuiltinResources(),
    );

    // Second load reads the persisted row and returns the same defaults
    const second = await UserSelectionLoad(undefined as never, config, USER_A);
    expect(second.selectedIds).toEqual(CrdScannerGetBuiltinResources());
  });

  test("two users have independent selections", async () => {
    await UserSelectionSave(undefined as never, config, USER_A, ["pod"]);
    await UserSelectionSave(undefined as never, config, USER_B, ["node"]);

    const a = await UserSelectionLoad(undefined as never, config, USER_A);
    const b = await UserSelectionLoad(undefined as never, config, USER_B);

    expect(a.selectedIds).toEqual(["pod"]);
    expect(b.selectedIds).toEqual(["node"]);
  });

  test("an explicit empty selection is persisted and returned as empty", async () => {
    await UserSelectionSave(undefined as never, config, USER_A, []);

    const selections = await UserSelectionLoad(
      undefined as never,
      config,
      USER_A,
    );

    expect(selections.selectedIds).toEqual([]);
  });

  test("a second save replaces the ids and bumps dateUpdated", async () => {
    await UserSelectionSave(undefined as never, config, USER_A, ["pod"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await UserSelectionSave(undefined as never, config, USER_A, [
      "secret",
      "node",
    ]);

    const rows = await DbUtilsQuerySQL(
      undefined as never,
      "SELECT selectedIds, dateCreated, dateUpdated FROM users_resource_selections WHERE userId = ?",
      [USER_A],
    );
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].selectedIds)).toEqual(["secret", "node"]);
    expect(rows[0].dateUpdated >= rows[0].dateCreated).toBe(true);
  });

  test("load falls back to defaults when stored selections are malformed", async () => {
    const now = new Date().toISOString();
    DbUtilsExecSQL(
      undefined as never,
      `INSERT INTO users_resource_selections (userId, selectedIds, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?)`,
      [USER_A, "{not json", now, now],
    );

    const selections = await UserSelectionLoad(
      undefined as never,
      config,
      USER_A,
    );

    expect(selections.selectedIds).toEqual(CrdScannerGetBuiltinResources());
  });

  test("UserSelectionsDataInit imports legacy files for users without a row", async () => {
    nodeFs.writeFileSync(
      selectionsFilePath(USER_A),
      JSON.stringify({ selectedIds: ["pod", "node"] }),
    );
    nodeFs.writeFileSync(
      selectionsFilePath(USER_B),
      "{corrupted json",
    );
    nodeFs.writeFileSync(
      path.join(dataDir, "user-selections-notanid.json"),
      JSON.stringify({ selectedIds: ["pod"] }),
    );

    await UserSelectionsDataInit(config);

    const a = await UserSelectionLoad(undefined as never, config, USER_A);
    expect(a.selectedIds).toEqual(["pod", "node"]);

    // Malformed and invalid-named files are skipped without throwing: user B
    // has no row, so a load inserts the defaults
    const b = await UserSelectionLoad(undefined as never, config, USER_B);
    expect(b.selectedIds).toEqual(CrdScannerGetBuiltinResources());

    // Files are left in place
    expect(nodeFs.existsSync(selectionsFilePath(USER_A))).toBe(true);
    expect(nodeFs.existsSync(selectionsFilePath(USER_B))).toBe(true);

    // Second run is a no-op (existing rows are kept)
    await UserSelectionSave(undefined as never, config, USER_A, ["secret"]);
    await UserSelectionsDataInit(config);
    const aAfter = await UserSelectionLoad(undefined as never, config, USER_A);
    expect(aAfter.selectedIds).toEqual(["secret"]);
  });

  test("UserSelectionsDataInit keeps the database row when a legacy file exists", async () => {
    await UserSelectionSave(undefined as never, config, USER_A, ["secret"]);
    nodeFs.writeFileSync(
      selectionsFilePath(USER_A),
      JSON.stringify({ selectedIds: ["pod"] }),
    );

    await UserSelectionsDataInit(config);

    const a = await UserSelectionLoad(undefined as never, config, USER_A);
    expect(a.selectedIds).toEqual(["secret"]);
  });

  test("IsValidUserId rejects non-UUID and non-string values", () => {
    expect(IsValidUserId(USER_A)).toBe(true);
    expect(IsValidUserId("not-an-id")).toBe(false);
    expect(IsValidUserId("11111111-1111-1111-1111-11111111111g")).toBe(false);
    expect(IsValidUserId(undefined as unknown as string)).toBe(false);
    expect(IsValidUserId(12345 as unknown as string)).toBe(false);
  });
});

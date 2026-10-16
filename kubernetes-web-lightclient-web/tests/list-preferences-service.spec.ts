import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const resourceServiceMock = vi.hoisted(() => ({
  getUserListPreferences: vi.fn(),
  saveUserListPreferences: vi.fn(),
}));

vi.mock("~~/services/ResourceService", () => ({
  ResourceService: resourceServiceMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  resourceServiceMock.getUserListPreferences.mockReset();
  resourceServiceMock.saveUserListPreferences.mockReset();
  resourceServiceMock.saveUserListPreferences.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ListPreferencesService", () => {
  it("loads the per-user preferences from the selections payload", async () => {
    const { ListPreferencesService } = await import(
      "~~/services/ListPreferencesService"
    );
    resourceServiceMock.getUserListPreferences.mockResolvedValue({
      pod: { sortBy: "restarts", sortDir: "desc", filters: ["not-ready"] },
    });

    await ListPreferencesService.ensureLoaded();

    expect(ListPreferencesService.get("pod")).toEqual({
      sortBy: "restarts",
      sortDir: "desc",
      filters: ["not-ready"],
    });
    expect(ListPreferencesService.get("unknown")).toEqual({});
  });

  it("loads only once per session", async () => {
    const { ListPreferencesService } = await import(
      "~~/services/ListPreferencesService"
    );
    resourceServiceMock.getUserListPreferences.mockResolvedValue({});

    await ListPreferencesService.ensureLoaded();
    await ListPreferencesService.ensureLoaded();

    expect(resourceServiceMock.getUserListPreferences).toHaveBeenCalledTimes(1);
  });

  it("debounces saves into a single PUT with the full map", async () => {
    const { ListPreferencesService } = await import(
      "~~/services/ListPreferencesService"
    );
    resourceServiceMock.getUserListPreferences.mockResolvedValue({});
    await ListPreferencesService.ensureLoaded();

    ListPreferencesService.set("pod", { sortBy: "restarts" });
    ListPreferencesService.set("pod", {
      sortBy: "restarts",
      sortDir: "desc",
      filters: ["not-ready"],
    });
    vi.advanceTimersByTime(500);

    expect(resourceServiceMock.saveUserListPreferences).toHaveBeenCalledTimes(1);
    expect(resourceServiceMock.saveUserListPreferences).toHaveBeenCalledWith({
      pod: { sortBy: "restarts", sortDir: "desc", filters: ["not-ready"] },
    });
  });

  it("keeps local state and falls back to defaults when loading fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ListPreferencesService } = await import(
      "~~/services/ListPreferencesService"
    );
    resourceServiceMock.getUserListPreferences.mockRejectedValue(
      new Error("offline"),
    );

    await expect(ListPreferencesService.ensureLoaded()).resolves.toBeUndefined();

    expect(ListPreferencesService.get("pod")).toEqual({});

    // Saving still works from the local (empty) state
    ListPreferencesService.set("pod", { sortBy: "name" });
    vi.advanceTimersByTime(500);
    expect(resourceServiceMock.saveUserListPreferences).toHaveBeenCalledWith({
      pod: { sortBy: "name" },
    });
    warnSpy.mockRestore();
  });

  it("does not throw when saving fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ListPreferencesService } = await import(
      "~~/services/ListPreferencesService"
    );
    resourceServiceMock.getUserListPreferences.mockResolvedValue({});
    await ListPreferencesService.ensureLoaded();
    resourceServiceMock.saveUserListPreferences.mockRejectedValue(
      new Error("offline"),
    );

    ListPreferencesService.set("pod", { sortBy: "name" });
    await vi.advanceTimersByTimeAsync(500);
    expect(resourceServiceMock.saveUserListPreferences).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  LIST_PAGE_SIZE,
  ListPaginationService,
} from "~~/services/ListPagination";

beforeEach(() => {
  ListPaginationService.resetAll();
});

describe("ListPaginationService", () => {
  it("creates a default state on demand", () => {
    expect(ListPaginationService.getState("pod")).toEqual({
      page: 1,
      total: 0,
    });
  });

  it("clamps a page to the available pages", () => {
    ListPaginationService.setTotal("pod", LIST_PAGE_SIZE * 3);
    expect(ListPaginationService.getState("pod").page).toBe(1);

    ListPaginationService.setPage("pod", 2);
    expect(ListPaginationService.getState("pod").page).toBe(2);

    ListPaginationService.setPage("pod", 99);
    expect(ListPaginationService.getState("pod").page).toBe(3);

    ListPaginationService.setPage("pod", 0);
    expect(ListPaginationService.getState("pod").page).toBe(1);
  });

  it("shrinks the current page when the total decreases", () => {
    ListPaginationService.setTotal("pod", LIST_PAGE_SIZE * 3);
    ListPaginationService.setPage("pod", 3);

    ListPaginationService.setTotal("pod", LIST_PAGE_SIZE + 1);
    expect(ListPaginationService.getState("pod").page).toBe(2);

    ListPaginationService.setTotal("pod", 0);
    expect(ListPaginationService.getState("pod").page).toBe(1);
  });

  it("resets a single list back to the first page", () => {
    ListPaginationService.setTotal("pod", LIST_PAGE_SIZE * 2);
    ListPaginationService.setTotal("deployment", LIST_PAGE_SIZE * 2);
    ListPaginationService.setPage("pod", 2);
    ListPaginationService.setPage("deployment", 2);

    ListPaginationService.reset("pod");

    expect(ListPaginationService.getState("pod").page).toBe(1);
    expect(ListPaginationService.getState("deployment").page).toBe(2);
  });

  it("resets every list", () => {
    ListPaginationService.setTotal("pod", LIST_PAGE_SIZE * 2);
    ListPaginationService.setPage("pod", 2);

    ListPaginationService.resetAll();

    expect(ListPaginationService.getState("pod")).toEqual({
      page: 1,
      total: 0,
    });
  });
});

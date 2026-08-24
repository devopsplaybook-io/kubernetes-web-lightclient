import { DeletePolicy } from "./DeletePolicy";

describe("DeletePolicy", () => {
  test("should allow only pods by default", () => {
    const policy = new DeletePolicy("pod");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(false);
    expect(policy.isDeletable("secret")).toBe(false);
  });

  test("should allow nothing when set to NONE", () => {
    const policy = new DeletePolicy("NONE");
    expect(policy.isDeletable("pod")).toBe(false);
    expect(policy.isDeletable("deployment")).toBe(false);
    expect(policy.isDeletable("")).toBe(false);
  });

  test("should treat lowercase none as NONE", () => {
    const policy = new DeletePolicy("none");
    expect(policy.isDeletable("pod")).toBe(false);
  });

  test("should allow everything when set to ALL", () => {
    const policy = new DeletePolicy("ALL");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(true);
    expect(policy.isDeletable("somecustomresource")).toBe(true);
  });

  test("should treat lowercase all as ALL", () => {
    const policy = new DeletePolicy("all");
    expect(policy.isDeletable("deployment")).toBe(true);
  });

  test("should allow only listed object types in a comma-separated list", () => {
    const policy = new DeletePolicy("pod,deployment");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(true);
    expect(policy.isDeletable("statefulset")).toBe(false);
    expect(policy.isDeletable("secret")).toBe(false);
  });

  test("should ignore surrounding whitespace in entries", () => {
    const policy = new DeletePolicy(" pod , deployment ");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(true);
  });

  test("should be case-insensitive for object types", () => {
    const policy = new DeletePolicy("Pod,Deployment");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("POD")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(true);
  });

  test("should ignore empty entries", () => {
    const policy = new DeletePolicy("pod,,deployment,");
    expect(policy.isDeletable("pod")).toBe(true);
    expect(policy.isDeletable("deployment")).toBe(true);
    expect(policy.isDeletable("")).toBe(false);
  });

  test("should allow nothing for an empty value", () => {
    const policy = new DeletePolicy("");
    expect(policy.isDeletable("pod")).toBe(false);
    expect(policy.isDeletable("deployment")).toBe(false);
  });

  test("should ignore whitespace in the checked object type", () => {
    const policy = new DeletePolicy("pod");
    expect(policy.isDeletable(" pod ")).toBe(true);
  });
});

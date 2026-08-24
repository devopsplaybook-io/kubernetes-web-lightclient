export class DeletePolicy {
  //
  private allowAll = false;
  private allowedTypes = new Set<string>();

  /**
   * Parses the ALLOWED_DELETABLE_OBJECTS configuration value.
   * Accepts "ALL" (everything can be deleted), "NONE" (nothing can be
   * deleted), or a comma-separated list of object types following the
   * application naming convention (e.g. "pod", "deployment").
   */
  constructor(allowedDeletableObjects: string) {
    const entries = (allowedDeletableObjects || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (const entry of entries) {
      if (entry.toUpperCase() === "ALL") {
        this.allowAll = true;
      } else if (entry.toUpperCase() !== "NONE") {
        this.allowedTypes.add(entry.toLowerCase());
      }
    }
  }

  public isDeletable(objectType: string): boolean {
    if (this.allowAll) {
      return true;
    }
    return this.allowedTypes.has((objectType || "").trim().toLowerCase());
  }
}

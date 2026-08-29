import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as fse from "fs-extra";
import path from "path";
import { OTelLogger } from "./OTelContext";

const logger = OTelLogger().createModuleLogger("config");

export class Config extends ConfigBase {
  // Project-specific fields
  public STATS_FETCH_FREQUENCY = 60;
  public STATS_RETENTION = 60 * 60 * 24;
  public POD_RESOURCES_FETCH_FREQUENCY = 30 * 60;
  public CACHE_TTL = 30000;
  public REQUEST_QUEUE_CONCURRENCY = 2;
  public REQUEST_TIMEOUT = 20000;
  public ALLOWED_DELETABLE_OBJECTS = "pod";

  constructor() {
    super("kubernetes-web-lightclient-server");

    // Override VERSION with this server's own package.json
    try {
      const pkg = fse.readJsonSync(path.resolve(__dirname, "../package.json"));
      if (pkg && pkg.version) {
        this.VERSION = pkg.version;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // fallback to default "1"
    }

    // Register project-specific fields so reload() processes them
    this.addConfigField({ field: "STATS_FETCH_FREQUENCY" });
    this.addConfigField({ field: "STATS_RETENTION" });
    this.addConfigField({ field: "POD_RESOURCES_FETCH_FREQUENCY" });
    this.addConfigField({ field: "CACHE_TTL" });
    this.addConfigField({ field: "REQUEST_QUEUE_CONCURRENCY" });
    this.addConfigField({ field: "REQUEST_TIMEOUT" });
    this.addConfigField({ field: "ALLOWED_DELETABLE_OBJECTS" });
  }

  public async reload(): Promise<void> {
    await super.reload((message: string) => logger.info(message));
  }
}

export class StatsNodeMesurement {
  //
  public node: string;
  public cpuUsage: number | null;
  public memoryUsage: number | null;
  public pods: number;
  public timestamp: Date;
  public podRestarts: number;

  constructor(data?: Partial<StatsNodeMesurement>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}

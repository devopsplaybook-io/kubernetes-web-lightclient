export class PodUsageStats {
  //
  public name: string;
  public namespace: string;
  public node: string;
  public cpuMin: number | null;
  public cpuMax: number | null;
  public cpuLatest: number | null;
  public memoryMin: number | null;
  public memoryMax: number | null;
  public memoryLatest: number | null;
  public updatedAt: Date;

  constructor(data?: Partial<PodUsageStats>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}

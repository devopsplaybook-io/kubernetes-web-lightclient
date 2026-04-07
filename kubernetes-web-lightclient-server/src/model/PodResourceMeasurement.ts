export class PodResourceMeasurement {
  //
  public name: string;
  public namespace: string;
  public node: string;
  public cpuRequest: string | null;
  public cpuLimit: string | null;
  public memoryRequest: string | null;
  public memoryLimit: string | null;
  public cpuUsage: string | null;
  public memoryUsage: string | null;
  public timestamp: Date;

  constructor(data?: Partial<PodResourceMeasurement>) {
    if (data) {
      Object.assign(this, data);
    }
  }
}

import { describe, expect, it } from "vitest";
import { buildLineChartOptions } from "../services/ChartOptions";

describe("buildLineChartOptions", () => {
  it("builds dark-theme options with dark grid and tooltip", () => {
    const options = buildLineChartOptions({
      id: "cpu-line",
      title: "CPU Usage (%)",
      themeMode: "dark",
      yMin: 0,
      yMax: 100,
    });

    expect(options.chart).toEqual({
      id: "cpu-line",
      background: "transparent",
    });
    expect(options.theme).toEqual({ mode: "dark" });
    expect(options.tooltip).toEqual({ theme: "dark" });
    expect(options.grid).toEqual({ borderColor: "rgba(255,255,255,0.14)" });
    expect(options.stroke).toEqual({ width: 2 });
    expect(options.xaxis).toEqual({
      type: "datetime",
      title: { text: "Timestamp" },
    });
    expect(options.yaxis).toEqual({ min: 0, max: 100 });
    expect(options.title).toEqual({ text: "CPU Usage (%)" });
  });

  it("builds light-theme options with the default grid color", () => {
    const options = buildLineChartOptions({
      id: "memory-line",
      title: "Memory Usage (%)",
      themeMode: "light",
      yMin: 0,
      yMax: 100,
    });

    expect(options.chart).toEqual({
      id: "memory-line",
      background: "transparent",
    });
    expect(options.theme).toEqual({ mode: "light" });
    expect(options.tooltip).toEqual({ theme: "light" });
    expect(options.grid).toEqual({ borderColor: "#e0e0e0" });
    expect(options.xaxis).toEqual({
      type: "datetime",
      title: { text: "Timestamp" },
    });
    expect(options.yaxis).toEqual({ min: 0, max: 100 });
    expect(options.title).toEqual({ text: "Memory Usage (%)" });
  });

  it("omits the y-axis max when not provided", () => {
    const options = buildLineChartOptions({
      id: "pods-line",
      title: "Pods per Node",
      themeMode: "light",
    });

    expect(options.yaxis).toEqual({ min: 0 });
    expect(options.title).toEqual({ text: "Pods per Node" });
  });
});

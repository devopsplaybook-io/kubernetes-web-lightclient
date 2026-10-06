export interface LineChartOptionsInput {
  id: string;
  title: string;
  themeMode: "light" | "dark";
  yMin?: number;
  yMax?: number;
}

export function buildLineChartOptions({
  id,
  title,
  themeMode,
  yMin = 0,
  yMax,
}: LineChartOptionsInput) {
  return {
    chart: {
      id,
      background: "transparent",
      theme: { mode: themeMode },
    },
    stroke: { width: 2 },
    grid: {
      borderColor: themeMode === "dark" ? "rgba(255,255,255,0.14)" : "#e0e0e0",
    },
    tooltip: { theme: themeMode },
    xaxis: { type: "datetime", title: { text: "Timestamp" } },
    yaxis: { min: yMin, ...(yMax !== undefined ? { max: yMax } : {}) },
    title: { text: title },
  };
}

export interface ChartData {
  [key: string]: string | number | null | undefined;
}

export interface LineConfig {
  key: string;
  label: string;
  color: string;
  strokeWidth?: number;
}

export interface BarConfig {
  key: string;
  label: string;
  color: string;
}

export interface PieConfig {
  dataKey: string;
  nameKey: string;
  colors: string[];
}

export { LineChart } from './LineChart';

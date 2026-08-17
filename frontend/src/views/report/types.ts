import type { TimeGridValues } from "../../components/timegrid/types";

export type ReportEventMarker = {
  id: number;
  event_ts: number;
  event_type: "event" | "note";
  title: string;
};

export type ReportPreparedMarker = {
  run_id: number;
  item_id: number;
  kind: "fluid" | "med" | "output";
  item_name: string;
  marker_code?: "i" | "o" | "d";
  marker_label?: string;
};

export type IoDripPart = "start" | "mid" | "end" | "single";

export type IoGridCellValue = {
  kind: "io_cell";
  amount?: number;
  dripPart?: IoDripPart;
  dripRateMlPerHr?: number;
  dripCarrierMlPerHr?: number;
};

export type ReportChartProps = {
  axis: number[];
  values: TimeGridValues;
  colWidth: number;
  labelColWidth: number;
  height?: number;
};

export type ReportChartVisibility = {
  spo2: boolean;
  hr: boolean;
  nibp: boolean;
  art: boolean;
  cvp: boolean;
};

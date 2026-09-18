import type { ClinicalTimelineValues } from "../../components/clinical-timeline/types";

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
  item_category?: string;
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
  values: ClinicalTimelineValues;
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

import { COL_WIDTH, LABEL_COL_WIDTH } from "./layout";
import { useVirtualColumns } from "../../hooks/useVirtualColumns";
import { useWorkstationSettings } from "../../hooks/useWorkstationSettings";
import { formatConfiguredTime } from "../../utils/dateTime";

type Props = {
  axis: number[];
  nowTs: number;
  colWidth?: number;
  labelColWidth?: number;
  scrollLeft?: number;
  viewportWidth?: number;
};

export default function ClinicalTimelineAxis({
  axis,
  nowTs,
  colWidth = COL_WIDTH,
  labelColWidth = LABEL_COL_WIDTH,
  scrollLeft = 0,
  viewportWidth = 0,
}: Props) {
  const workstation = useWorkstationSettings();
  const { startIndex, endIndex } = useVirtualColumns(
    scrollLeft,
    viewportWidth,
    colWidth,
    axis.length
  );

  if (axis.length === 0) return null;

  const visibleAxis = axis.slice(startIndex, endIndex + 1);
  const fallbackStep = axis.length > 1 ? Math.max(1, axis[1] - axis[0]) : 60_000;

  return (
    <div className="timeaxis-shell sticky top-0 z-[90] w-full border-b">
      <div className="flex">
        <div
          style={{
            width: labelColWidth,
            minWidth: labelColWidth,
          }}
          className="timeaxis-sticky-label sticky left-0 z-[100] flex flex-shrink-0 items-center border-r px-3"
        >
          <span className="timeaxis-title">Timeline</span>
        </div>

        {startIndex > 0 && (
          <div style={{ width: startIndex * colWidth, minWidth: startIndex * colWidth }} className="flex-shrink-0" />
        )}

        {visibleAxis.map((ts, i) => {
          const actualIndex = startIndex + i;
          const next = axis[actualIndex + 1] ?? Infinity;
          const isNow = ts <= nowTs && next > nowTs;
          const bucketEnd = Number.isFinite(next) ? next : ts + fallbackStep;
          const nowProgress = Math.max(0, Math.min(1, (nowTs - ts) / Math.max(1, bucketEnd - ts)));

          return (
            <div
              key={ts}
              style={{ width: colWidth, minWidth: colWidth }}
              className={`timeaxis-tick flex-shrink-0 border-r ${isNow ? "timeaxis-now-cell" : ""}`}
            >
              <time>
                {formatConfiguredTime(ts, workstation)}
              </time>
              {isNow ? <span className="timeaxis-now-badge">Now</span> : null}
              {isNow ? <span className="timeaxis-now-rule" style={{ left: `${nowProgress * 100}%` }} aria-hidden="true" /> : null}
            </div>
          );
        })}

        {endIndex < axis.length - 1 && (
          <div style={{ width: (axis.length - 1 - endIndex) * colWidth, minWidth: (axis.length - 1 - endIndex) * colWidth }} className="flex-shrink-0" />
        )}
      </div>
    </div>
  );
}

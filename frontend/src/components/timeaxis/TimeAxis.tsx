import { COL_WIDTH, LABEL_COL_WIDTH } from "../timegrid/layout";
import { useVirtualColumns } from "../../hooks/useVirtualColumns";

type Props = {
  axis: number[];
  nowTs: number;
  colWidth?: number;
  labelColWidth?: number;
  scrollLeft?: number;
  viewportWidth?: number;
};

export default function TimeAxis({
  axis,
  nowTs,
  colWidth = COL_WIDTH,
  labelColWidth = LABEL_COL_WIDTH,
  scrollLeft = 0,
  viewportWidth = 0,
}: Props) {
  const { startIndex, endIndex } = useVirtualColumns(
    scrollLeft,
    viewportWidth,
    colWidth,
    axis.length
  );

  if (axis.length === 0) return null;

  const visibleAxis = axis.slice(startIndex, endIndex + 1);

  return (
    <div className="w-full bg-gray-50 dark:bg-gray-900 border-b">
      <div className="flex">
        <div
          style={{
            width: labelColWidth,
            minWidth: labelColWidth,
          }}
          className="sticky left-0 z-20 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
        />

        {startIndex > 0 && (
          <div style={{ width: startIndex * colWidth, minWidth: startIndex * colWidth }} className="flex-shrink-0" />
        )}

        {visibleAxis.map((ts, i) => {
          const actualIndex = startIndex + i;
          const next = axis[actualIndex + 1] ?? Infinity;
          const isNow = ts <= nowTs && next > nowTs;

          return (
            <div
              key={ts}
              style={{ width: colWidth, minWidth: colWidth }}
              className={`
                flex-shrink-0
                border-r border-gray-200 dark:border-gray-800
                text-[10px] text-center py-2
                text-gray-700 dark:text-gray-300
                ${isNow ? "timeaxis-now-cell" : ""}
              `}
            >
              {new Date(ts).toLocaleTimeString("en-GB", {
                timeZone: "Asia/Bangkok",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
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

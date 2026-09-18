type Props = {
  axis: number[];
  colWidth: number;
  labelColWidth: number;
};

function formatHHMM(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ReportTimelineAxis({ axis, colWidth, labelColWidth }: Props) {
  if (axis.length === 0) return null;
  const totalWidth = labelColWidth + axis.length * colWidth;
  return (
    <div
      className="report-axis report-surface border-x border-t report-border"
      style={{ width: totalWidth, minWidth: totalWidth }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${labelColWidth}px repeat(${axis.length}, ${colWidth}px)`,
        }}
      >
        <div className="h-8 border-r report-border" />
        {axis.map(ts => (
          <div
            key={ts}
            className="h-8 border-l report-border text-center text-[11px] leading-8 report-cell-text"
          >
            {formatHHMM(ts)}
          </div>
        ))}
      </div>
    </div>
  );
}

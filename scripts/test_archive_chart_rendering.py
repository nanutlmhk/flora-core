"""Regression checks for observations and administrations lost by rendering."""
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "flora-api"))
from app.services import innovian_report as report
from reportlab.pdfgen.canvas import Canvas
import pymupdf


class ChartRenderingTests(unittest.TestCase):
    def test_asynchronous_bp_and_arterial_mean_reach_plot(self):
        snapshot = {"timeline": {"rows": [
            {"ts_minute": 60_000, "payload": {"nibp_sys": 241, "nibp_dia": 17}},
            {"ts_minute": 120_000, "payload": {"art_map": 82}},
        ]}}
        with patch.object(report, "_marker") as marker:
            report._chart_page(Canvas(BytesIO()), snapshot, "Test", 0, 600_000, 1, 1,
                               "Helvetica", "Helvetica-Bold", False)
        # Eight legend symbols plus all three readings; off-grid BP and values
        # outside the former 20..220 clipping range must survive.
        self.assertEqual(marker.call_count, 11)
        self.assertEqual([call.args[3] for call in marker.call_args_list[-3:]],
                         ["down", "up", "square"])

    def test_continuous_cadence_preserves_actual_time_and_sparse_values(self):
        rows = [{"ts_minute": i * 60_000, "payload": {"hr": 70 + i}} for i in range(10)]
        selected = report._plot_rows(rows, "hr", 0, 600_000)
        self.assertEqual([row["ts_minute"] for row in selected], [0, 300_000])
        sparse = [rows[2], rows[8]]
        self.assertEqual(report._plot_rows(sparse, "hr", 0, 600_000), sparse)
        self.assertEqual(len(rows), 10)

    def test_summary_wraps_notes_and_preserves_staff_times(self):
        note = "A long clinical event with treatment details. " * 40
        snapshot = {"case": {"start_time": 60_000, "discharge_time": 600_000},
                    "staff": {"rows": [{"name": "Test clinician", "role": "Anesthetist",
                                         "entered_at": "2024-07-17T09:15:00Z",
                                         "exited_at": "2024-07-17T13:28:00Z"}]},
                    "events": {"rows": [{"event_ts": 120_000, "title": "Event", "memo": note + "END-OF-NOTE"}]}}
        document = pymupdf.open(stream=report.build_innovian_report(snapshot, ["anes:test"]), filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        for expected in ("Test clinician", "09:15", "13:28", "END-OF-NOTE"):
            self.assertIn(expected, text)

    def test_medication_overflow_is_paginated(self):
        snapshot = {"case": {"start_time": 60_000, "discharge_time": 600_000},
                    "io_runs": {"rows": [
                        {"item_id": i, "item_name": f"Medication-{i:02}",
                         "started_at": 60_000, "stopped_at": 120_000}
                        for i in range(40)]}}
        document = pymupdf.open(stream=report.build_innovian_report(snapshot, ["anes:test"]), filetype="pdf")
        text = "\n".join(page.get_text() for page in document)
        self.assertEqual(len(document), 4)
        for i in range(40):
            self.assertIn(f"Medication-{i:02}", text)


if __name__ == "__main__":
    unittest.main()

// CSV from parse_size_chart_image (Claude Vision) → { columns, rows } for the size chart editor.
// Rows whose cell count differs from the header are dropped. null when there is no usable table.
export function parseCsvTable(csv) {
  const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const split = (line) => line.split(',').map((c) => c.trim());
  const columns = split(lines[0]);
  const rows = lines.slice(1).map(split).filter((r) => r.length === columns.length);
  if (!columns.length || !rows.length) return null;
  return { columns, rows };
}

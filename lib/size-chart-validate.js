// Pure validation for the `size_chart` metaobject shape, straight from the data contract:
// ~/Desktop/Projects/active/clara-atelier/SIZE-CHART-DATA-CONTRACT.md §2.
//
// No I/O here — everything is a plain function over already-fetched data, so it can be
// unit-tested without mocking Shopify or Supabase, and reused identically by the live
// `validate_size_chart` action and by `create_size_chart`/`update_size_chart` before they
// write anything.
//
// Split: ERRORS block the save (the contract says the theme "does not compute" — a
// malformed row/column would break rendering, not just look wrong). WARNINGS surface a
// likely mistake but never block, per the task: label mismatches and unit-in-header/cell
// slips are exactly the kind of thing a human should be able to save anyway and fix later
// (e.g. while a product's real options are still being synced).

const UNIT_WORD_RE = /\b(cm|mm|in|inch|inches|zoll)\b|["']{1,2}(?!\S)/i;

/**
 * Shape rules: every row has exactly as many cells as there are columns, and every cell
 * (column header or row value) is a bare, non-empty string. Warns (does not block) when a
 * measurement cell (any cell after the first — the first is the size label, which is
 * allowed to carry non-numeric text like "EU 38/39 (US 8)") looks like it carries a unit.
 */
export function validateChartShape({ columns, rows }) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(columns) || columns.length === 0) {
    errors.push('At least one column is required.');
    return { errors, warnings };
  }
  columns.forEach((c, j) => {
    if (typeof c !== 'string') errors.push(`Column ${j + 1} is not a string.`);
    else if (!c.trim()) errors.push(`Column ${j + 1} has no label.`);
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push('At least one row is required.');
    return { errors, warnings };
  }

  rows.forEach((row, i) => {
    if (!Array.isArray(row)) { errors.push(`Row ${i + 1} is not a list of cells.`); return; }
    if (row.length !== columns.length) {
      errors.push(`Row ${i + 1} has ${row.length} cell(s), expected ${columns.length} (one per column).`);
    }
    row.forEach((cell, j) => {
      if (typeof cell !== 'string') { errors.push(`Row ${i + 1}, column ${j + 1} is not a string.`); return; }
      if (j === 0) return; // size label — not unit-checked
      const m = cell.match(UNIT_WORD_RE);
      if (m) {
        const label = typeof columns[j] === 'string' ? columns[j] : `column ${j + 1}`;
        warnings.push(`Row ${i + 1}, "${label}": value "${cell}" looks like it carries a unit ("${m[0]}") — the contract wants bare numbers/ranges, with the unit carried by the chart's unit field or the column header, not the cell.`);
      }
    });
  });

  return { errors, warnings };
}

/** If unit is "cm" the header must not also carry a unit — the storefront's CM/INCH switch
 * and a unit baked into the header conflict (contract §2: "the unit in the column name and
 * the switch are mutually exclusive"). Warn only — some catalogs deliberately keep the unit
 * in the header and set a non-"cm" unit to disable the switch, which is a valid combination
 * this check does not see (it only fires when unit IS "cm"). */
export function validateUnitVsHeaders({ columns, unit }) {
  const warnings = [];
  if (unit !== 'cm' || !Array.isArray(columns)) return { warnings };
  columns.slice(1).forEach((c) => {
    if (typeof c !== 'string') return;
    const m = c.match(UNIT_WORD_RE);
    if (m) {
      warnings.push(`Column "${c}" carries a unit in its header ("${m[0]}") while unit is "cm" — the CM/INCH switch will divide already-labeled values by 2.54 on toggle. Either drop the unit from the header, or set unit to something other than "cm" to disable the switch.`);
    }
  });
  return { warnings };
}

/**
 * The first cell of each row is the size label and must match one of the product's real
 * size option values, for every product currently assigned to this chart. Warns (never
 * blocks) per the task — a chart is often edited before every assigned product's options
 * are known/synced.
 *
 * @param {{rows: string[][]}} chart
 * @param {{title: string, sizeOptionValues: string[]|null}[]} assignedProducts — products
 *   with `sizeOptionValues: null` (no Größe/Size option found) are skipped, nothing to compare.
 */
export function validateSizeLabelsAgainstProducts({ rows }, assignedProducts) {
  const warnings = [];
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(assignedProducts) || !assignedProducts.length) {
    return { warnings };
  }
  const labels = rows.map((r) => (Array.isArray(r) ? r[0] : undefined)).filter((v) => typeof v === 'string');
  for (const p of assignedProducts) {
    if (!Array.isArray(p.sizeOptionValues)) continue;
    const missing = p.sizeOptionValues.filter((v) => !labels.includes(v));
    const extra = labels.filter((v) => !p.sizeOptionValues.includes(v));
    if (missing.length || extra.length) {
      const parts = [];
      if (missing.length) parts.push(`missing from the chart: ${missing.join(', ')}`);
      if (extra.length) parts.push(`chart has extra labels not on the product: ${extra.join(', ')}`);
      warnings.push(`"${p.title}" size option values do not exactly match this chart's row labels — ${parts.join('; ')}.`);
    }
  }
  return { warnings };
}

/**
 * Full validation used before every save. `assignedProducts` defaults to `[]` (a brand new
 * chart has nothing assigned yet, so the label-match warning naturally produces nothing).
 */
export function validateSizeChart(chart, assignedProducts = []) {
  const shape = validateChartShape(chart);
  const unitHeaders = validateUnitVsHeaders(chart);
  // Label-mismatch comparison only makes sense once the shape itself is sound (a malformed
  // row has no reliable "first cell").
  const labels = shape.errors.length ? { warnings: [] } : validateSizeLabelsAgainstProducts(chart, assignedProducts);
  return {
    errors: shape.errors,
    warnings: [...shape.warnings, ...unitHeaders.warnings, ...labels.warnings],
    valid: shape.errors.length === 0,
  };
}

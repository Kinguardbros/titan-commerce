import { describe, it, expect } from 'vitest';
import {
  validateChartShape, validateUnitVsHeaders, validateSizeLabelsAgainstProducts, validateSizeChart,
} from '../lib/size-chart-validate.js';

const GOOD_CHART = {
  columns: ['Größe', 'Brust', 'Taille', 'Hüfte'],
  rows: [
    ['S', '86-90', '68-72', '92-96'],
    ['M', '90-94', '72-76', '96-100'],
  ],
  unit: 'cm',
};

describe('validateChartShape', () => {
  it('accepts a well-formed chart with no errors or warnings', () => {
    const { errors, warnings } = validateChartShape(GOOD_CHART);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('errors when a row has fewer cells than there are columns', () => {
    const { errors } = validateChartShape({ columns: ['Größe', 'Brust', 'Taille'], rows: [['S', '86-90']] });
    expect(errors).toEqual([expect.stringContaining('Row 1 has 2 cell(s), expected 3')]);
  });

  it('errors when a row has more cells than there are columns', () => {
    const { errors } = validateChartShape({ columns: ['Größe', 'Brust'], rows: [['S', '86', '90']] });
    expect(errors).toEqual([expect.stringContaining('Row 1 has 3 cell(s), expected 2')]);
  });

  it('errors on an empty columns array', () => {
    const { errors } = validateChartShape({ columns: [], rows: [['S']] });
    expect(errors).toEqual(['At least one column is required.']);
  });

  it('errors on an empty rows array', () => {
    const { errors } = validateChartShape({ columns: ['Größe'], rows: [] });
    expect(errors).toContain('At least one row is required.');
  });

  it('errors when a column header is blank', () => {
    const { errors } = validateChartShape({ columns: ['Größe', '  '], rows: [['S', '1']] });
    expect(errors).toEqual([expect.stringContaining('Column 2 has no label')]);
  });

  it('errors when a cell is not a string', () => {
    const { errors } = validateChartShape({ columns: ['Größe', 'Brust'], rows: [['S', 86]] });
    expect(errors).toEqual([expect.stringContaining('Row 1, column 2 is not a string')]);
  });

  it('never flags the first cell (size label) for a non-numeric value', () => {
    const { errors, warnings } = validateChartShape({
      columns: ['Größe', 'EU', 'US'],
      rows: [['EU 38/39 (US 8)', '38', '8']],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns (does not error) when a measurement cell carries a unit', () => {
    const { errors, warnings } = validateChartShape({
      columns: ['Größe', 'Brust'],
      rows: [['S', '86-90 cm']],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('looks like it carries a unit')]);
  });

  it('warns on an inch-mark suffix in a measurement cell', () => {
    const { warnings } = validateChartShape({ columns: ['Größe', 'Länge'], rows: [['S', '24"']] });
    expect(warnings.length).toBe(1);
  });
});

describe('validateUnitVsHeaders', () => {
  it('warns when unit is cm and a header carries a unit', () => {
    const { warnings } = validateUnitVsHeaders({ columns: ['Größe', 'Länge (cm)'], unit: 'cm' });
    expect(warnings).toEqual([expect.stringContaining('Länge (cm)')]);
  });

  it('does not warn when unit is cm and headers are bare', () => {
    const { warnings } = validateUnitVsHeaders({ columns: ['Größe', 'Länge'], unit: 'cm' });
    expect(warnings).toEqual([]);
  });

  it('does not warn when unit is not cm, even with a unit in the header (switch is disabled by design)', () => {
    const { warnings } = validateUnitVsHeaders({ columns: ['Größe', 'Länge (cm)'], unit: 'fixed' });
    expect(warnings).toEqual([]);
  });

  it('never flags the first column (size label)', () => {
    const { warnings } = validateUnitVsHeaders({ columns: ['Größe (cm)', 'Länge'], unit: 'cm' });
    expect(warnings).toEqual([]);
  });
});

describe('validateSizeLabelsAgainstProducts', () => {
  const chart = { rows: [['S', '1'], ['M', '2'], ['L', '3']] };

  it('warns when a product size option has a value missing from the chart', () => {
    const { warnings } = validateSizeLabelsAgainstProducts(chart, [
      { title: 'Dress A', sizeOptionValues: ['S', 'M', 'L', 'XL'] },
    ]);
    expect(warnings).toEqual([expect.stringContaining('missing from the chart: XL')]);
  });

  it('warns when the chart has an extra label the product does not offer', () => {
    const { warnings } = validateSizeLabelsAgainstProducts(chart, [
      { title: 'Dress A', sizeOptionValues: ['S', 'M'] },
    ]);
    expect(warnings).toEqual([expect.stringContaining('chart has extra labels not on the product: L')]);
  });

  it('does not warn on an exact match', () => {
    const { warnings } = validateSizeLabelsAgainstProducts(chart, [
      { title: 'Dress A', sizeOptionValues: ['S', 'M', 'L'] },
    ]);
    expect(warnings).toEqual([]);
  });

  it('skips a product with no Größe/Size option (sizeOptionValues null)', () => {
    const { warnings } = validateSizeLabelsAgainstProducts(chart, [
      { title: 'No-size product', sizeOptionValues: null },
    ]);
    expect(warnings).toEqual([]);
  });

  it('returns no warnings when no products are assigned', () => {
    const { warnings } = validateSizeLabelsAgainstProducts(chart, []);
    expect(warnings).toEqual([]);
  });
});

describe('validateSizeChart (combined)', () => {
  it('valid is false and label warnings are skipped when the shape itself has errors', () => {
    const result = validateSizeChart(
      { columns: ['Größe', 'Brust'], rows: [['S', '86', 'extra']], unit: 'cm' },
      [{ title: 'X', sizeOptionValues: ['XL'] }], // would otherwise warn about the mismatch
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('valid is true and all warning categories can appear together', () => {
    const result = validateSizeChart(
      { columns: ['Größe', 'Länge (cm)'], rows: [['S', '60 cm']], unit: 'cm' },
      [{ title: 'X', sizeOptionValues: ['S', 'M'] }],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(3); // cell unit, header unit, label mismatch
  });

  it('a brand-new chart with no assigned products has no label warnings', () => {
    const result = validateSizeChart(GOOD_CHART, []);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

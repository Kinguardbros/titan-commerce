import { describe, it, expect } from 'vitest';
import { parseCsvTable } from '../apps/dashboard/src/lib/size-chart-csv.js';

describe('parseCsvTable', () => {
  it('splits header and rows, trimming cells', () => {
    expect(parseCsvTable('Größe, Brust, Taille\nS, 84-88, 66-70\nM, 88-92, 70-74\n')).toEqual({
      columns: ['Größe', 'Brust', 'Taille'],
      rows: [['S', '84-88', '66-70'], ['M', '88-92', '70-74']],
    });
  });
  it('drops rows with the wrong number of cells', () => {
    expect(parseCsvTable('Size,Bust\nS,84\nM\nL,92').rows).toEqual([['S', '84'], ['L', '92']]);
  });
  it('returns null without a usable table', () => {
    expect(parseCsvTable('')).toBeNull();
    expect(parseCsvTable('Size,Bust')).toBeNull();
  });
});

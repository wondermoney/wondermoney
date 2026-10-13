import { describe, expect, it } from 'vitest';

import { buildSankeyCsv } from '../sankey.service';

describe('buildSankeyCsv', () => {
  it('emits two sections (nodes then links) separated by a blank line', () => {
    const csv = buildSankeyCsv({
      links: [{ source: 'income-1', target: 'expense-2', value: 1500 }],
      nodes: [
        { id: 'income-1', kind: 'income', label: 'Salary', value: 5000 },
        { id: 'expense-2', kind: 'expense', label: 'Rent', value: 1500 },
      ],
    });

    expect(csv).toBe(
      '\uFEFF# nodes\nid,label,kind,color,value\nincome-1,Salary,income,,5000.00\nexpense-2,Rent,expense,,1500.00\n\n# links\nsource,target,value\nincome-1,expense-2,1500.00\n',
    );
  });
});

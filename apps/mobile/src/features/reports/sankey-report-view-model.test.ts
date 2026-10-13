import { mapSankeyReport } from './sankey-report-view-model'

const data = {
  nodes: [
    { id: 'salary', label: 'Salary', kind: 'income' as const },
    { id: 'rent', label: 'Rent', kind: 'expense' as const },
    { id: 'main', label: 'Main Account', kind: 'account' as const },
  ],
  links: [
    { source: 'salary', target: 'rent', value: 800 },
    { source: 'salary', target: 'main', value: 2200 },
  ],
}

describe('sankey report view model', () => {
  it('resolves each link source/target id to its node label', () => {
    const result = mapSankeyReport({ data })
    expect(result.links).toEqual([
      { key: 'salary-rent-0', sourceLabel: 'Salary', targetLabel: 'Rent', value: 800 },
      { key: 'salary-main-1', sourceLabel: 'Salary', targetLabel: 'Main Account', value: 2200 },
    ])
  })

  it('falls back to the raw id when a link references an unknown node', () => {
    const result = mapSankeyReport({ data: { nodes: [], links: [{ source: 'ghost-a', target: 'ghost-b', value: 10 }] } })
    expect(result.links[0]).toMatchObject({ sourceLabel: 'ghost-a', targetLabel: 'ghost-b' })
  })

  it('sums link values sourced from income nodes as the total, excluding expense/account-sourced links', () => {
    const result = mapSankeyReport({ data })
    expect(result.total).toBe(3000)
  })

  it('returns zero links and total for empty data', () => {
    const result = mapSankeyReport({ data: { nodes: [], links: [] } })
    expect(result).toEqual({ links: [], total: 0 })
  })
})

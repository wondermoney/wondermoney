import type { SankeyData } from './reports-contract'

export type SankeyLinkRow = Readonly<{ key: string; sourceLabel: string; targetLabel: string; value: number }>

export type SankeyReportViewModel = Readonly<{
  links: readonly SankeyLinkRow[]
  total: number
}>

/**
 * Mobile ships Sankey as a table from day one, matching web's own documented sub-640px fallback
 * (components/reports/sankey/README.md: "Below the sm breakpoint, the SVG is replaced by a short
 * notice and a table of the same links... A full Sankey becomes unreadable on narrow screens").
 * Resolves each link's source/target node id to its label, same as that fallback table does.
 */
export function mapSankeyReport(response: { data: SankeyData }): SankeyReportViewModel {
  const labelById = new Map(response.data.nodes.map((node) => [node.id, node.label]))
  const links = response.data.links.map((link, index) => ({
    key: `${link.source}-${link.target}-${index}`,
    sourceLabel: labelById.get(link.source) ?? link.source,
    targetLabel: labelById.get(link.target) ?? link.target,
    value: link.value,
  }))

  const incomeNodeIds = new Set(response.data.nodes.filter((node) => node.kind === 'income').map((node) => node.id))
  const total = response.data.links
    .filter((link) => incomeNodeIds.has(link.source))
    .reduce((sum, link) => sum + link.value, 0)

  return { links, total }
}

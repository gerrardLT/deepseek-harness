import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'bidProjects'

export const zh = {
  'type.label': '投标项目', 'guide.title': '投标项目', 'guide.description': '查看中心投标项目并继续关联会话。',
  loading: '正在加载投标项目…', empty: '暂无投标项目。', error: '无法加载投标项目。', continue: '继续会话', progress: '已完成 {completed} / {total} 个章节',
  'card.tender.title': '招标文件已解析', 'card.tender.detail': '{title}，共 {count} 个章节',
  'card.match.title': '能力匹配完成', 'card.match.detail': '匹配 {matched} 项，缺口 {gaps} 项',
  'card.section.title': '章节已生成', 'card.section.detail': '{title}（{status}）',
  'card.export.title': '标书已导出', 'card.export.detail': '{path}，共 {pages} 页',
  'status.parsed': '已解析', 'status.matching': '匹配中', 'status.generating': '生成中', 'status.ready': '就绪', 'status.exported': '已导出', 'status.failed': '失败',
} satisfies Record<string, string>
export type BidProjectsKey = keyof typeof zh
export const en = {
  'type.label': 'Bid projects', 'guide.title': 'Bid projects', 'guide.description': 'Review central bid projects and continue their Sessions.',
  loading: 'Loading bid projects…', empty: 'No bid projects yet.', error: 'Could not load bid projects.', continue: 'Continue Session', progress: '{completed} of {total} sections',
  'card.tender.title': 'Tender parsed', 'card.tender.detail': '{title}, {count} sections',
  'card.match.title': 'Capability match complete', 'card.match.detail': '{matched} matched, {gaps} gaps',
  'card.section.title': 'Section generated', 'card.section.detail': '{title} ({status})',
  'card.export.title': 'Bid exported', 'card.export.detail': '{path}, {pages} pages',
  'status.parsed': 'Parsed', 'status.matching': 'Matching', 'status.generating': 'Generating', 'status.ready': 'Ready', 'status.exported': 'Exported', 'status.failed': 'Failed',
} satisfies Record<BidProjectsKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { bidProjects: BidProjectsKey }
}

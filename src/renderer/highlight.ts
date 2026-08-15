/**
 * 字幕高亮 — 主界面与历史记录详情页共用。
 * 与词库分析共用同一数据源（src/shared/lexicon-data.ts）。
 * 单一合并正则 + 长度降序：与分词器的最长优先语义一致，
 * 保证「我觉得」整体命中犹豫词，而不是先被笼统词「觉得」拆开。
 */
import { FILLER_WORDS, HEDGE_WORDS, VAGUE_WORDS, escapeRegExp } from '../shared/lexicon-data';

const HIGHLIGHT_CLASS: Record<string, string> = {};
for (const w of VAGUE_WORDS) HIGHLIGHT_CLASS[w] = 'vague';
for (const w of FILLER_WORDS) HIGHLIGHT_CLASS[w] = 'filler';
for (const w of HEDGE_WORDS) HIGHLIGHT_CLASS[w] = 'hedge';

const HIGHLIGHT_REGEX = new RegExp(
  Object.keys(HIGHLIGHT_CLASS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|'),
  'g',
);

/** 给口语文本加词库高亮 span（笼统词 / 填充词 / 犹豫词） */
export function highlightText(text: string): string {
  return text.replace(HIGHLIGHT_REGEX, (match) => {
    const cls = HIGHLIGHT_CLASS[match] ?? 'vague';
    return `<span class="${cls}">${match}</span>`;
  });
}

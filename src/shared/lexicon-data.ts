/**
 * 词库数据 — 主进程 / 渲染进程共享的唯一数据源。
 * 填充词、犹豫词、笼统词→精准词映射都集中在这里，避免多处维护导致漂移。
 * 只放纯数据，不 import electron/node 运行时，保证渲染进程也能安全引用。
 */
import tieredRaw from '../../data/tiered-lexicon.json';

/** 填充词列表（语气词/口头禅） */
export const FILLER_WORDS: readonly string[] = [
  '嗯', '啊', '呃', '额', '那个', '就是', '然后',
  '这个', '对吧', '是吧', '你知道', '怎么说呢',
  '反正', '基本上', '总之', '所以说',
  // 补充常见口头禅（原 lexicon-playground 词表中的高频口语词）
  '就是说', '其实吧', '说实话', '对对对', '是是是',
  'emmm', '啧', '哎', '唔',
];

/** 犹豫词列表（弱化表达） */
export const HEDGE_WORDS: readonly string[] = [
  '可能', '也许', '大概', '应该', '我觉得', '好像',
  '似乎', '或许', '不一定', '差不多', '算是',
  '某种程度上', '一般来说', '感觉',
  // 补充弱化表达
  '可能吧', '我不确定', '大概率', '不排除', '也有可能',
];

/** 旧版内置笼统词映射（tiered 词库未覆盖的词） */
const LEGACY_VAGUE_TO_PRECISE: Readonly<Record<string, readonly string[]>> = {
  '不舒服': ['压抑', '烦躁', '憋屈', '窒息', '煎熬', '疲惫'],
  '很多': ['大量', '海量', '充裕', '丰富', '密集', '可观'],
  '很快': ['迅速', '飞速', '立刻', '瞬间', '即刻', '火速'],
  '很大': ['巨大', '庞大', '显著', '惊人', '可观', '壮观'],
  '很小': ['微小', '细微', '轻微', '渺小', '微不足道', '些许'],
  '想想': ['反思', '回顾', '审视', '复盘', '琢磨', '斟酌'],
};

interface TieredLexicon {
  _meta?: Record<string, unknown>;
  [category: string]: Record<string, readonly string[]> | Record<string, unknown> | undefined;
}

const TIERED = tieredRaw as TieredLexicon;

/** tiered-lexicon.json 中参与笼统词检测的分区 */
const VAGUE_SECTIONS = [
  'emotions_positive',
  'emotions_negative',
  'states',
  'vague_descriptors',
  'vague_verbs',
  'intensity_markers',
  'social_expressions',
  'evaluation_words',
  'action_words',
] as const;

function buildVagueToPrecise(): Readonly<Record<string, readonly string[]>> {
  const map: Record<string, readonly string[]> = {};

  for (const section of VAGUE_SECTIONS) {
    const words = TIERED[section];
    if (!words) continue;
    for (const [word, alternatives] of Object.entries(words)) {
      const alts = Array.isArray(alternatives) ? (alternatives as readonly string[]) : [];
      if (alts.length === 0) continue;
      // 已在填充/犹豫词表中的词不重复统计（如「感觉」既是犹豫词又是笼统词候选）
      if (FILLER_WORDS.includes(word) || HEDGE_WORDS.includes(word)) continue;
      map[word] = alts;
    }
  }

  // 旧版词表中 tiered 未覆盖的词兜底
  for (const [word, alternatives] of Object.entries(LEGACY_VAGUE_TO_PRECISE)) {
    if (!map[word]) map[word] = alternatives;
  }

  return map;
}

/** 笼统词 → 精准替代词映射（唯一数据源，来自 data/tiered-lexicon.json） */
export const VAGUE_TO_PRECISE: Readonly<Record<string, readonly string[]>> = buildVagueToPrecise();

/** 全部笼统词，按长度降序（正则匹配时优先长词，避免「很」抢先匹配「很好」） */
export const VAGUE_WORDS: readonly string[] = Object.keys(VAGUE_TO_PRECISE).sort(
  (a, b) => b.length - a.length,
);

/** 正则转义（渲染进程构建高亮正则用） */
export function escapeRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

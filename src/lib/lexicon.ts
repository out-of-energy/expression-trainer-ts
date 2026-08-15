/**
 * 词库匹配模块
 * 加载情感词库 JSON，分析文本中的情绪词、填充词、犹豫词。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FILLER_WORDS, HEDGE_WORDS, VAGUE_TO_PRECISE } from '../shared/lexicon-data';
import type {
  AnalysisResult,
  EmotionLexicon,
  EmotionWordHit,
  Suggestion,
  VagueWordHit,
  WordHit,
} from '../shared/types';

let lexiconData: EmotionLexicon = { emotions: {} };

/** 校验 JSON 解析结果是否满足 EmotionLexicon 形状（轻量运行时校验） */
function isEmotionLexicon(value: unknown): value is EmotionLexicon {
  if (typeof value !== 'object' || value === null) return false;
  const emotions = (value as { emotions?: unknown }).emotions;
  return typeof emotions === 'object' && emotions !== null;
}

/**
 * 加载词库
 */
export function loadLexicon(): void {
  const lexiconPath = path.join(__dirname, '..', 'data', 'emotion-lexicon.json');

  if (existsSync(lexiconPath)) {
    const raw: unknown = JSON.parse(readFileSync(lexiconPath, 'utf-8'));
    if (isEmotionLexicon(raw)) {
      lexiconData = raw;
      console.log(`[词库] 加载完成，共 ${Object.keys(raw.emotions).length} 个情绪词`);
    } else {
      console.warn('[词库] emotion-lexicon.json 格式不正确，使用内置词表');
      lexiconData = { emotions: {} };
    }
  } else {
    console.warn('[词库] emotion-lexicon.json 未找到，使用内置词表');
    lexiconData = { emotions: {} };
  }
}

/**
 * 简单中文分词（基于最大正向匹配 + 词表）
 */
function segmentText(text: string): string[] {
  const words: string[] = [];
  let i = 0;
  const maxLen = 6;

  // 构建词表用于匹配
  const dict = new Set<string>([
    ...FILLER_WORDS,
    ...HEDGE_WORDS,
    ...Object.keys(VAGUE_TO_PRECISE),
    ...Object.keys(lexiconData.emotions),
  ]);

  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len >= 2; len--) {
      const word = text.substring(i, i + len);
      if (dict.has(word)) {
        words.push(word);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 单字
      words.push(text[i] ?? '');
      i++;
    }
  }

  return words;
}

/**
 * 分析文本
 */
export function analyzeText(text: string): AnalysisResult | null {
  if (!text || !text.trim()) {
    return null;
  }

  const words = segmentText(text);
  const totalWords = words.length;

  // 检测填充词
  const fillers: WordHit[] = [];
  words.forEach((word, idx) => {
    if (FILLER_WORDS.includes(word)) {
      fillers.push({ word, position: idx });
    }
  });

  // 检测犹豫词
  const hedges: WordHit[] = [];
  words.forEach((word, idx) => {
    if (HEDGE_WORDS.includes(word)) {
      hedges.push({ word, position: idx });
    }
  });

  // 检测笼统词
  const vagueWords: VagueWordHit[] = [];
  words.forEach((word, idx) => {
    const alternatives = VAGUE_TO_PRECISE[word];
    if (alternatives) {
      vagueWords.push({ word, position: idx, alternatives: [...alternatives] });
    }
  });

  // 检测情绪词（来自词库）
  const emotionWords: EmotionWordHit[] = [];
  words.forEach((word, idx) => {
    const entry = lexiconData.emotions[word];
    if (entry) {
      emotionWords.push({ word, position: idx, ...entry });
    }
  });

  // 计算表达密度
  const meaningfulWords = totalWords - fillers.length - hedges.length;
  const density = totalWords > 0 ? (meaningfulWords / totalWords) : 1;

  return {
    totalWords,
    fillers,
    hedges,
    vagueWords,
    emotionWords,
    density: Math.round(density * 100),
    suggestions: generateSuggestions(vagueWords, fillers, hedges),
  };
}

/**
 * 生成替代建议
 */
function generateSuggestions(
  vagueWords: VagueWordHit[],
  fillers: WordHit[],
  hedges: WordHit[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // 笼统词替代
  vagueWords.forEach((item) => {
    const alternatives = item.alternatives.slice(0, 3);
    suggestions.push({
      type: 'vague',
      original: item.word,
      alternatives,
      message: `「${item.word}」→ 试试更精准的：${alternatives.join('、')}`,
    });
  });

  // 填充词提醒
  if (fillers.length >= 3) {
    const topFillers = [...new Set(fillers.map((f) => f.word))].slice(0, 3);
    suggestions.push({
      type: 'filler',
      message: `填充词偏多（${fillers.length}次）：${topFillers.join('、')}。试试用停顿替代`,
    });
  }

  // 犹豫词提醒
  if (hedges.length >= 2) {
    suggestions.push({
      type: 'hedge',
      message: `犹豫表达较多（${hedges.length}次）。试试把「我觉得」改成直接陈述`,
    });
  }

  return suggestions;
}

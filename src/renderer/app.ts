/**
 * 宇宙无敌表达训练系统 — 主界面逻辑（V2）
 */
import MarkdownIt from 'markdown-it';
import { getElement } from './dom';
import { highlightText } from './highlight';
import { FILLER_WORDS, HEDGE_WORDS } from '../shared/lexicon-data';
import type { ASRResult, Suggestion, TrainingRecord, SessionStats } from '../shared/types';

type FeedbackType = 'good' | 'filler' | 'hedge' | 'vague' | 'ai';

/**
 * AudioWorklet 采集器代码（以 Blob URL 注入，免额外文件）。
 * ScriptProcessorNode 已废弃；worklet 累积到 4096 帧（约 256ms @16kHz）再整块发给主进程，
 * 保持与旧实现的 IPC 频率一致。
 */
const CAPTURE_WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._chunkSize = 4096;
  }
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length > 0) {
      const merged = new Float32Array(this._buffer.length + channel.length);
      merged.set(this._buffer, 0);
      merged.set(channel, this._buffer.length);
      this._buffer = merged;
      if (this._buffer.length >= this._chunkSize) {
        this.port.postMessage(this._buffer.slice(0, this._chunkSize));
        this._buffer = this._buffer.slice(this._chunkSize);
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

/** Markdown 渲染器（与 VS Code 同款引擎） */
const md = new MarkdownIt({
  html: false, // 转义输入中的 HTML，防注入
  linkify: true, // 自动识别链接
  breaks: true, // 单换行转 <br>
});

class ExpressionTrainer {
  private isRecording = false;
  private isPaused = false;
  private startTime = 0;
  private pausedTime = 0;
  private pauseStart: number | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private fullText = '';
  private sentences: string[] = [];
  private stats: SessionStats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
  private lastFeedbackText = '';
  /** 当前内容来源：录音 or 粘贴逐字稿（影响报告开头措辞） */
  private source: 'recording' | 'pasted' = 'recording';
  /** 当前会话入库后的记录 id（用于草稿更新/定型/补写报告） */
  private currentRecordId: string | null = null;
  /** 录制中定时保存草稿的计时器 */
  private draftTimer: ReturnType<typeof setInterval> | null = null;

  /** 逐句分析累积（入库用的"分析结果"细节） */
  private analysisAccum = this.newAnalysisAccum();

  private audioContext: AudioContext | null = null;
  private audioProcessor: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;

  private btnStart = getElement<HTMLButtonElement>('btn-start');
  private btnPaste = getElement<HTMLButtonElement>('btn-paste');
  private btnPause = getElement<HTMLButtonElement>('btn-pause');
  private btnResume = getElement<HTMLButtonElement>('btn-resume');
  private btnStop = getElement<HTMLButtonElement>('btn-stop');
  private btnReport = getElement<HTMLButtonElement>('btn-report');
  private btnSettings = getElement<HTMLButtonElement>('btn-settings');
  private btnHistory = getElement<HTMLButtonElement>('btn-history');
  private btnCloseReport = getElement<HTMLButtonElement>('btn-close-report');
  private btnClosePaste = getElement<HTMLButtonElement>('btn-close-paste');
  private btnAnalyzePaste = getElement<HTMLButtonElement>('btn-analyze-paste');
  private btnCopyText = getElement<HTMLButtonElement>('btn-copy-text');
  private btnClear = getElement<HTMLButtonElement>('btn-clear');
  private btnCopyReport = getElement<HTMLButtonElement>('btn-copy-report');
  private pasteModal = getElement('paste-modal');
  private pasteTextarea = getElement<HTMLTextAreaElement>('paste-textarea');
  private timer = getElement('timer');
  private subtitleScroll = getElement('subtitle-scroll');
  private subtitleContainer = getElement('subtitle-container');
  private feedbackContent = getElement('feedback-content');
  private reportModal = getElement('report-modal');
  private reportBody = getElement('report-body');
  private statFillers = getElement('stat-fillers');
  private statHedges = getElement('stat-hedges');
  private statVague = getElement('stat-vague');
  private statDensity = getElement('stat-density');

  constructor() {
    this.bindEvents();
  }

  private bindEvents(): void {
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnSettings.addEventListener('click', () => window.api.openSettings());
    this.btnHistory.addEventListener('click', () => window.api.openHistory());
    getElement<HTMLButtonElement>('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnCopyReport.addEventListener('click', () => {
      const content = getElement('report-content').innerText;
      navigator.clipboard.writeText(content).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      });
    });
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
  }

  // ===== 录制控制 =====

  private async startRecording(): Promise<void> {
    // 立即反馈：异步准备（模型加载/麦克风授权）期间按钮显示「准备中…」
    this.btnStart.disabled = true;
    const label = this.btnStart.querySelector<HTMLElement>('.btn-label');
    const originalLabel = label?.textContent ?? '';
    if (label) label.textContent = '准备中…';

    try {
      const modelStatus = await window.api.getModelStatus();
      if (!modelStatus.installed) {
        this.showError('⚠️ 语音模型未加载，请先在设置页加载');
        window.api.openSettings();
        return;
      }

      // ASR 初始化（主进程加载模型）与麦克风授权互不依赖，并发执行
      const [initResult, stream] = await Promise.all([
        window.api.initASR(),
        navigator.mediaDevices.getUserMedia({ audio: true }),
      ]);
      if (!initResult.success) {
        stream.getTracks().forEach((t) => t.stop());
        this.showError(`语音识别启动失败: ${initResult.error}`);
        return;
      }

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);

      // AudioWorklet 采集（替代已废弃的 ScriptProcessorNode）
      const moduleUrl = URL.createObjectURL(
        new Blob([CAPTURE_WORKLET_CODE], { type: 'application/javascript' }),
      );
      await this.audioContext.audioWorklet.addModule(moduleUrl);
      URL.revokeObjectURL(moduleUrl);

      const workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      workletNode.port.onmessage = (e) => {
        if (!this.isRecording || this.isPaused) return;
        const samples: Float32Array = e.data;
        void window.api.feedAudio(samples).then((result) => {
          if (result) this.handleASRResult(result);
        });
      };
      source.connect(workletNode);
      this.audioProcessor = workletNode;
      this.mediaStream = stream;
    } catch (err) {
      this.showError(`麦克风访问失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      this.btnStart.disabled = false;
      if (label) label.textContent = originalLabel;
    }

    this.isRecording = true;
    this.isPaused = false;
    this.source = 'recording';
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.pauseStart = null;
    this.fullText = '';
    this.sentences = [];
    this.lastFeedbackText = '';
    this.resetStats();
    this.subtitleContainer.innerHTML = '';

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);

    // 录制中每 30 秒自动保存一次草稿（崩溃/误关窗口时最多丢 30 秒内容）
    if (this.draftTimer !== null) clearInterval(this.draftTimer);
    this.draftTimer = setInterval(() => {
      void this.autosaveDraft();
    }, 30000);
  }

  /** 录制中保存草稿：同一条记录反复更新，结束后定型 */
  private async autosaveDraft(): Promise<void> {
    if (!this.isRecording || !this.fullText.trim()) return;

    const record = this.buildTrainingRecord();
    record.draft = true;
    // 时长按当前已录时间计算（stats.duration 只在结束时写入）
    let totalPaused = this.pausedTime;
    if (this.pauseStart !== null) totalPaused += Date.now() - this.pauseStart;
    record.durationSec = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);

    if (this.currentRecordId) {
      const res = await window.api.history.update(this.currentRecordId, record);
      if (!res.success) console.error('[草稿] 更新失败:', res.error);
    } else {
      const res = await window.api.history.add(record);
      if (res.success) this.currentRecordId = res.data;
      else console.error('[草稿] 保存失败:', res.error);
    }
  }

  private pauseRecording(): void {
    this.isPaused = true;
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
  }

  private resumeRecording(): void {
    this.isPaused = false;
    if (this.pauseStart !== null) {
      this.pausedTime += Date.now() - this.pauseStart;
    }
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
  }

  private async stopRecording(): Promise<void> {
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    const { finalText } = await window.api.stopASR();
    this.isRecording = false;
    this.isPaused = false;

    // 补上未确认的尾部文本（说了话但没到断句就点了「结束」）
    if (finalText && !this.fullText.endsWith(finalText)) {
      this.fullText += finalText;
      this.sentences.push(finalText);
      this.renderSubtitle(finalText, true);
      await this.analyzeCurrentSentence(finalText);
    }

    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    // 停止草稿定时器
    if (this.draftTimer !== null) {
      clearInterval(this.draftTimer);
      this.draftTimer = null;
    }
    let totalPaused = this.pausedTime;
    if (this.pauseStart !== null) totalPaused += Date.now() - this.pauseStart;
    this.stats.duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    this.pauseStart = null;

    // UI：显示生成报告按钮，可翻阅字幕
    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.timer.classList.remove('active');

    if (this.fullText.trim()) {
      this.btnReport.classList.remove('hidden');
      this.btnCopyText.classList.remove('hidden');
      this.btnClear.classList.remove('hidden');
    }

    // 会话结束自动入库
    await this.saveToHistory();
  }

  // ===== ASR 结果处理 =====

  private handleASRResult(result: ASRResult): void {
    const { text, isFinal } = result;
    if (isFinal) {
      this.sentences.push(text);
      this.fullText += text;
      this.analyzeCurrentSentence(text);

      // 每 30 字触发一次 AI 反馈（语境化精准词建议）
      if (this.fullText.length - this.lastFeedbackText.length >= 30) {
        this.requestRealtimeFeedback();
      }
    }
    this.renderSubtitle(text, isFinal);
  }

  private renderSubtitle(currentText: string, isFinal: boolean): void {
    if (isFinal) {
      const interim = this.subtitleContainer.querySelector('.interim-line');
      if (interim) interim.remove();

      this.subtitleContainer.querySelectorAll('.subtitle-line:not(.old)').forEach((el) => {
        el.classList.add('old');
      });

      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(currentText);
      this.subtitleContainer.appendChild(line);
    } else {
      let interim = this.subtitleContainer.querySelector('.interim-line');
      if (!interim) {
        interim = document.createElement('div');
        interim.className = 'subtitle-line interim-line';
        this.subtitleContainer.appendChild(interim);
      }
      interim.textContent = currentText;
    }

    this.subtitleScroll.scrollTop = this.subtitleScroll.scrollHeight;
  }

  private highlightText(text: string): string {
    return highlightText(text);
  }

  // ===== 分析 =====

  private async analyzeCurrentSentence(text: string): Promise<void> {
    const analysis = await window.api.analyzeText(text);
    if (!analysis) return;

    this.stats.fillers += analysis.fillers.length;
    this.stats.hedges += analysis.hedges.length;
    this.stats.vagueWords += analysis.vagueWords.length;
    this.stats.totalWords += analysis.totalWords;
    this.updateStatsDisplay();

    // 累积细节（入库用）
    for (const f of analysis.fillers) {
      this.analysisAccum.fillers.set(f.word, (this.analysisAccum.fillers.get(f.word) ?? 0) + 1);
    }
    for (const h of analysis.hedges) {
      this.analysisAccum.hedges.set(h.word, (this.analysisAccum.hedges.get(h.word) ?? 0) + 1);
    }
    for (const v of analysis.vagueWords) {
      const cur = this.analysisAccum.vagueWords.get(v.word);
      this.analysisAccum.vagueWords.set(v.word, {
        count: (cur?.count ?? 0) + 1,
        alternatives: v.alternatives,
      });
    }
    for (const e of analysis.emotionWords) {
      const cur = this.analysisAccum.emotionWords.get(e.word);
      this.analysisAccum.emotionWords.set(e.word, {
        count: (cur?.count ?? 0) + 1,
        category: e.category,
        intensity: e.intensity,
      });
    }
    for (const s of analysis.suggestions) {
      this.analysisAccum.suggestions.set(s.message, s);
    }

    // 碰到笼统词 → 立刻在反馈栏弹出替换建议
    for (const item of analysis.vagueWords) {
      const alts = item.alternatives.slice(0, 3).join(' / ');
      this.addFeedbackItem(`「${item.word}」→ ${alts}`, 'vague');
    }
    // 碰到填充词 → 弹提醒
    if (analysis.fillers.length >= 2) {
      const uniqueFillers = [...new Set(analysis.fillers.map((f) => f.word))].slice(0, 3);
      this.addFeedbackItem(`填充词：${uniqueFillers.join('、')}——试试停顿`, 'filler');
    }
    // 碰到犹豫词 → 弹提醒
    if (analysis.hedges.length >= 1) {
      const uniqueHedges = [...new Set(analysis.hedges.map((h) => h.word))].slice(0, 2);
      this.addFeedbackItem(`「${uniqueHedges.join('」「')}」→ 直接说`, 'hedge');
    }
  }

  private updateStatsDisplay(): void {
    this.statFillers.textContent = String(this.stats.fillers);
    this.statHedges.textContent = String(this.stats.hedges);
    this.statVague.textContent = String(this.stats.vagueWords);
    if (this.stats.totalWords > 0) {
      const density = ((this.stats.totalWords - this.stats.fillers - this.stats.hedges) / this.stats.totalWords * 100).toFixed(0);
      this.statDensity.textContent = density + '%';
    } else {
      this.statDensity.textContent = '--';
    }
  }

  // ===== 实时反馈 =====

  private async requestRealtimeFeedback(): Promise<void> {
    this.lastFeedbackText = this.fullText;
    const result = await window.api.getRealtimeFeedback(this.fullText);
    if (result.success && result.data) {
      const lines = result.data.split('\n').filter((l) => l.trim());
      lines.forEach((line) => {
        const text = line.trim();
        this.addFeedbackItem(text, this.classifyFeedback(text));
      });
    } else if (!result.success) {
      console.error('[实时反馈]', result.error);
      this.addFeedbackItem(`⚠️ AI 反馈失败：${result.error}`, 'ai');
    }
  }

  private classifyFeedback(text: string): FeedbackType {
    if (text === '✓' || text.includes('✓')) return 'good';
    // 填充词相关
    if (FILLER_WORDS.some((w) => text.includes(`「${w}」`))) return 'filler';
    // 犹豫词相关
    if (HEDGE_WORDS.some((w) => text.includes(`「${w}」`))) return 'hedge';
    // 其他精准词替换
    if (text.includes('→')) return 'vague';
    return 'ai';
  }

  private addFeedbackItem(text: string, type: FeedbackType = 'ai'): void {
    // 去重：如果前 3 条已经有相同内容，跳过
    const existing = Array.from(this.feedbackContent.children).slice(0, 3);
    if (existing.some((el) => el.textContent === text)) return;

    const item = document.createElement('div');
    item.className = `feedback-item type-${type}`;
    item.textContent = text;
    this.feedbackContent.insertBefore(item, this.feedbackContent.firstChild);
    while (this.feedbackContent.children.length > 12) {
      this.feedbackContent.removeChild(this.feedbackContent.lastChild!);
    }
  }

  // ===== 报告 =====

  private async generateReport(): Promise<void> {
    this.reportBody.innerHTML = '<p style="text-align:center;color:#9A958A;padding:40px;">正在生成报告...</p>';
    this.reportModal.classList.remove('hidden');

    const result = await window.api.getFinalReport({
      fullText: this.fullText,
      stats: this.stats,
      source: this.source,
    });

    if (result.success) {
      if (!result.data || !result.data.trim()) {
        console.error('[报告] 内容为空');
        this.reportBody.innerHTML = '<p style="color:#B03A2E;">报告内容为空，请重试</p>';
        return;
      }
      // 把报告补写进历史记录
      if (this.currentRecordId) {
        const update = await window.api.history.update(this.currentRecordId, { report: result.data });
        if (!update.success) console.error('[历史] 补写报告失败:', update.error);
      }
      this.renderReport(result.data);
    } else {
      this.reportBody.innerHTML = `<p style="color:#B03A2E;">生成失败: ${result.error}</p>`;
    }
  }

  private renderReport(report: string): void {
    try {
      const html = md.render(report);
      // 报告已自动写进历史记录（历史页可导出完整 Markdown），弹窗内不再提供保存按钮
      this.reportBody.innerHTML = `<div id="report-content">${html}</div>`;
    } catch (error) {
      console.error('[报告渲染] 失败，回退纯文本', error);
      this.reportBody.textContent = report;
    }
  }

  // ===== 工具 =====

  private updateTimer(): void {
    let totalPaused = this.pausedTime;
    if (this.pauseStart !== null) totalPaused += Date.now() - this.pauseStart;
    const elapsed = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    this.timer.textContent = `${minutes}:${seconds}`;
  }

  private resetStats(): void {
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.analysisAccum = this.newAnalysisAccum();
    this.currentRecordId = null;
    this.updateStatsDisplay();
    this.feedbackContent.innerHTML = '';
  }

  private newAnalysisAccum() {
    return {
      fillers: new Map<string, number>(),
      hedges: new Map<string, number>(),
      vagueWords: new Map<string, { count: number; alternatives: string[] }>(),
      emotionWords: new Map<string, { count: number; category: string; intensity: number }>(),
      suggestions: new Map<string, Suggestion>(),
    };
  }

  // ===== 历史记录入库 =====

  private buildTrainingRecord(): Omit<TrainingRecord, 'id' | 'createdAt'> {
    const totalWords = this.stats.totalWords;
    const density =
      totalWords > 0
        ? Math.round(((totalWords - this.stats.fillers - this.stats.hedges) / totalWords) * 100)
        : 0;

    const byCount = (entries: Array<[string, number]>) =>
      entries.map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);

    return {
      source: this.source,
      durationSec: this.stats.duration,
      transcript: this.fullText,
      analysis: {
        totalWords,
        density,
        fillers: byCount([...this.analysisAccum.fillers.entries()]),
        hedges: byCount([...this.analysisAccum.hedges.entries()]),
        vagueWords: [...this.analysisAccum.vagueWords.entries()]
          .map(([word, v]) => ({ word, count: v.count, alternatives: v.alternatives }))
          .sort((a, b) => b.count - a.count),
        emotionWords: [...this.analysisAccum.emotionWords.entries()]
          .map(([word, v]) => ({ word, count: v.count, category: v.category, intensity: v.intensity }))
          .sort((a, b) => b.count - a.count),
        suggestions: [...this.analysisAccum.suggestions.values()],
      },
    };
  }

  /** 会话结束自动入库：已有草稿则定型为正式记录，否则新建（非空文本才存） */
  private async saveToHistory(): Promise<void> {
    if (!this.fullText.trim()) return;

    if (this.currentRecordId) {
      // 录制中已生成草稿（同一 id）→ 定型为正式记录，报告后续也写进这条
      const result = await window.api.history.update(this.currentRecordId, {
        ...this.buildTrainingRecord(),
        draft: false,
      });
      if (!result.success) console.error('[历史] 定型失败:', result.error);
      return;
    }

    const result = await window.api.history.add(this.buildTrainingRecord());
    if (result.success) {
      this.currentRecordId = result.data;
    } else {
      console.error('[历史] 保存失败:', result.error);
    }
  }

  private showError(msg: string): void {
    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.color = '#B03A2E';
    line.textContent = msg;
    this.subtitleContainer.appendChild(line);
  }

  // ===== 复制 & 清空 =====

  private copyOriginalText(): void {
    if (!this.fullText.trim()) return;
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '📋 复制'; }, 1500);
    });
  }

  private clearAll(): void {
    this.fullText = '';
    this.sentences = [];
    this.lastFeedbackText = '';
    this.source = 'recording';
    this.startTime = 0;
    this.pausedTime = 0;
    this.pauseStart = null;
    this.subtitleContainer.innerHTML = '<div class="subtitle-line hint">点击下方按钮开始说话</div>';
    this.feedbackContent.innerHTML = '';
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
  }

  // ===== 粘贴逐字稿分析 =====

  private openPasteModal(): void {
    if (this.isRecording) {
      this.showError('请先结束录制，再粘贴逐字稿');
      return;
    }
    this.pasteTextarea.value = '';
    this.pasteModal.classList.remove('hidden');
    this.pasteTextarea.focus();
  }

  private async analyzePastedText(): Promise<void> {
    const text = this.pasteTextarea.value.trim();
    if (!text) return;

    // 关闭粘贴弹窗
    this.pasteModal.classList.add('hidden');

    // 把文本显示到字幕区（高亮标记）
    this.subtitleContainer.innerHTML = '';
    this.fullText = text;
    this.source = 'pasted';
    this.resetStats();

    // 按句号/问号/感叹号/换行分句
    const sentences = text.split(/(?<=[。！？\n])/g).filter((s) => s.trim());
    this.sentences = sentences;

    for (const sentence of sentences) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.innerHTML = this.highlightText(sentence.trim());
      this.subtitleContainer.appendChild(line);

      // 词库分析
      const analysis = await window.api.analyzeText(sentence);
      if (analysis) {
        this.stats.fillers += analysis.fillers.length;
        this.stats.hedges += analysis.hedges.length;
        this.stats.vagueWords += analysis.vagueWords.length;
        this.stats.totalWords += analysis.totalWords;
      }
    }

    this.stats.duration = 0; // 粘贴模式没有时长
    this.updateStatsDisplay();

    // 显示操作按钮
    this.btnReport.classList.remove('hidden');
    this.btnCopyText.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');

    // 粘贴逐字稿也自动入库（时长 0）
    await this.saveToHistory();

    // 自动生成深度报告：报告弹窗就是本功能的"分析结果页面"
    // （本地词库分析已实时显示在左栏统计与字幕高亮中；不再单独请求短反馈，避免重复 AI 调用）
    await this.generateReport();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ExpressionTrainer();
});

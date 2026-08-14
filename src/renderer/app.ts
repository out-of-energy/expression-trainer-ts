/**
 * 宇宙无敌表达训练系统 — 主界面逻辑（V2）
 */
import { getElement } from './dom';
import type { ASRResult, SessionStats } from '../shared/types';

type FeedbackType = 'good' | 'filler' | 'hedge' | 'vague' | 'ai';

const VAGUE_HIGHLIGHT_WORDS = [
  '开心', '难过', '害怕', '生气', '不舒服', '很好', '很多', '很快', '很大', '很小',
  '好看', '不好', '喜欢', '讨厌', '觉得', '想想',
] as const;

const FILLER_PATTERN = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
const HEDGE_PATTERN = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;

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
  private lastReport = '';

  private audioContext: AudioContext | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;

  private btnStart = getElement<HTMLButtonElement>('btn-start');
  private btnPaste = getElement<HTMLButtonElement>('btn-paste');
  private btnPause = getElement<HTMLButtonElement>('btn-pause');
  private btnResume = getElement<HTMLButtonElement>('btn-resume');
  private btnStop = getElement<HTMLButtonElement>('btn-stop');
  private btnReport = getElement<HTMLButtonElement>('btn-report');
  private btnSettings = getElement<HTMLButtonElement>('btn-settings');
  private btnCloseReport = getElement<HTMLButtonElement>('btn-close-report');
  private btnClosePaste = getElement<HTMLButtonElement>('btn-close-paste');
  private btnAnalyzePaste = getElement<HTMLButtonElement>('btn-analyze-paste');
  private btnCopyText = getElement<HTMLButtonElement>('btn-copy-text');
  private btnSaveText = getElement<HTMLButtonElement>('btn-save-text');
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
    getElement<HTMLButtonElement>('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnCopyReport.addEventListener('click', () => {
      navigator.clipboard.writeText(this.reportBody.innerText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      });
    });
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
  }

  // ===== 录制控制 =====

  private async startRecording(): Promise<void> {
    const initResult = await window.api.initASR();
    if (!initResult.success) {
      this.showError(`语音识别启动失败: ${initResult.error}`);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.audioProcessor.onaudioprocess = async (e) => {
        if (!this.isRecording || this.isPaused) return;
        const samples = e.inputBuffer.getChannelData(0);
        const result = await window.api.feedAudio(samples);
        if (result) this.handleASRResult(result);
      };
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      this.mediaStream = stream;
    } catch (err) {
      this.showError(`麦克风访问失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
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
    await window.api.stopASR();
    this.isRecording = false;
    this.isPaused = false;

    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    let totalPaused = this.pausedTime;
    if (this.pauseStart !== null) totalPaused += Date.now() - this.pauseStart;
    this.stats.duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);

    // UI：显示生成报告按钮，可翻阅字幕
    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.timer.classList.remove('active');

    if (this.fullText.trim()) {
      this.btnReport.classList.remove('hidden');
      this.btnCopyText.classList.remove('hidden');
      this.btnSaveText.classList.remove('hidden');
      this.btnClear.classList.remove('hidden');
    }
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
    let result = text;
    VAGUE_HIGHLIGHT_WORDS.forEach((w) => {
      result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
    });
    result = result.replace(FILLER_PATTERN, '<span class="filler">$1</span>');
    result = result.replace(HEDGE_PATTERN, '<span class="hedge">$1</span>');
    return result;
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
    }
  }

  private classifyFeedback(text: string): FeedbackType {
    if (text === '✓' || text.includes('✓')) return 'good';
    // 填充词相关
    const fillerKeywords = ['嗯', '啊', '呃', '那个', '就是', '然后', '这个', '对吧', '是吧', '反正', '基本上', '所以说'];
    if (fillerKeywords.some((w) => text.includes(`「${w}」`))) return 'filler';
    // 犹豫词相关
    const hedgeKeywords = ['可能', '也许', '大概', '应该', '我觉得', '好像', '似乎', '感觉', '或许'];
    if (hedgeKeywords.some((w) => text.includes(`「${w}」`))) return 'hedge';
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
    });

    if (result.success) {
      this.lastReport = result.data;
      this.renderReport(result.data);
    } else {
      this.reportBody.innerHTML = `<p style="color:#B03A2E;">生成失败: ${result.error}</p>`;
    }
  }

  private renderReport(report: string): void {
    const html = report
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\|(.+)\|/g, (match) => match)
      .replace(/\n/g, '<br>');

    this.reportBody.innerHTML = `
      <div style="text-align:right;margin-bottom:12px;">
        <button id="btn-save-report" style="background:#D97757;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:12px;cursor:pointer;">💾 保存为 Markdown</button>
      </div>
      ${html}
    `;

    getElement<HTMLButtonElement>('btn-save-report').addEventListener('click', () => this.saveReport());
  }

  private async saveReport(): Promise<void> {
    if (!this.lastReport) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练报告\n\n**日期**: ${dateStr}  \n**时长**: ${this.stats.duration}秒  \n**总字数**: ${this.stats.totalWords}  \n\n---\n\n## 完整原文\n\n${this.fullText}\n\n---\n\n${this.lastReport}`;
    const filename = `表达训练-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        const btn = getElement<HTMLButtonElement>('btn-save-report');
        btn.textContent = '✓ 已保存';
        btn.style.background = '#C15F3C';
        setTimeout(() => { btn.textContent = '💾 保存为 Markdown'; btn.style.background = '#D97757'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
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
    this.updateStatsDisplay();
    this.feedbackContent.innerHTML = '';
  }

  private showError(msg: string): void {
    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.color = '#B03A2E';
    line.textContent = msg;
    this.subtitleContainer.appendChild(line);
  }

  // ===== 复制 & 保存原文 & 清空 =====

  private copyOriginalText(): void {
    if (!this.fullText.trim()) return;
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '📋 复制'; }, 1500);
    });
  }

  private async saveOriginalText(): Promise<void> {
    if (!this.fullText.trim()) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练原文\n\n**日期**: ${dateStr}\n\n---\n\n${this.fullText}`;
    const filename = `原文-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        this.btnSaveText.textContent = '✓ 已保存';
        setTimeout(() => { this.btnSaveText.textContent = '💾 保存'; }, 2000);
      }
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private clearAll(): void {
    this.fullText = '';
    this.sentences = [];
    this.lastReport = '';
    this.subtitleContainer.innerHTML = '<div class="subtitle-line hint">点击下方按钮开始说话</div>';
    this.feedbackContent.innerHTML = '';
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
  }

  // ===== 粘贴逐字稿分析 =====

  private openPasteModal(): void {
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
    this.btnSaveText.classList.remove('hidden');
    this.btnClear.classList.remove('hidden');

    // 请求 AI 语境化反馈
    this.requestRealtimeFeedback();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ExpressionTrainer();
});

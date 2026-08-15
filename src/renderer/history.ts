/**
 * 训练历史窗口 — 浏览/查看/导出/删除历史训练记录。
 */
import MarkdownIt from 'markdown-it';
import { getElement } from './dom';
import { highlightText } from './highlight';
import type { TrainingRecord } from '../shared/types';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

class HistoryPage {
  private viewList = getElement('view-list');
  private viewDetail = getElement('view-detail');
  private listEl = getElement('history-list');
  private detailContent = getElement('detail-content');
  private detailTitle = getElement('detail-title');
  private records: TrainingRecord[] = [];
  private current: TrainingRecord | null = null;

  constructor() {
    getElement('btn-refresh').addEventListener('click', () => this.refresh());
    getElement('btn-back').addEventListener('click', () => this.showList());
    getElement('btn-delete').addEventListener('click', () => this.deleteCurrent());
    getElement('btn-export').addEventListener('click', () => this.exportCurrent());
    // 窗口重新聚焦时静默刷新列表（录音结束后回到历史窗口能立刻看到新记录）
    window.addEventListener('focus', () => {
      if (!this.current) this.refresh();
    });
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.records = await window.api.history.list();
    this.renderList();
    this.showList();
  }

  // ===== 列表 =====

  private formatTime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private formatDuration(sec: number): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }

  private renderList(): void {
    if (this.records.length === 0) {
      this.listEl.innerHTML = '<div class="empty">暂无训练记录<br><br>完成一次录音或粘贴逐字稿分析后会自动保存到这里</div>';
      return;
    }

    this.listEl.innerHTML = this.records.map((r) => {
      const a = r.analysis;
      const preview = r.transcript.slice(0, 80) + (r.transcript.length > 80 ? '…' : '');
      return `
        <div class="record-item" data-id="${r.id}">
          <div class="record-head">
            <span class="record-time">${this.formatTime(r.createdAt)}</span>
            <span class="badge ${r.source === 'pasted' ? 'pasted' : ''}">${r.source === 'pasted' ? '📋 逐字稿' : '🎤 录音'}</span>
            ${r.draft ? '<span class="badge">🕘 草稿</span>' : ''}
            ${r.report ? '<span class="badge">📄 有报告</span>' : ''}
          </div>
          <div class="record-stats">
            <span>时长 <b>${this.formatDuration(r.durationSec)}</b></span>
            <span>字数 <b>${a.totalWords}</b></span>
            <span>密度 <b>${a.density}%</b></span>
            <span>填充 <b>${a.fillers.length ? a.fillers.reduce((s, w) => s + w.count, 0) : 0}</b></span>
            <span>犹豫 <b>${a.hedges.length ? a.hedges.reduce((s, w) => s + w.count, 0) : 0}</b></span>
            <span>笼统 <b>${a.vagueWords.length ? a.vagueWords.reduce((s, w) => s + w.count, 0) : 0}</b></span>
          </div>
          <div class="record-preview">${preview.replace(/</g, '&lt;')}</div>
        </div>`;
    }).join('');

    this.listEl.querySelectorAll('.record-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id;
        const record = this.records.find((r) => r.id === id);
        if (record) this.showDetail(record);
      });
    });
  }

  // ===== 详情 =====

  private showList(): void {
    this.viewDetail.classList.add('hidden');
    this.viewList.classList.remove('hidden');
    this.current = null;
  }

  private showDetail(record: TrainingRecord): void {
    this.current = record;
    this.viewList.classList.add('hidden');
    this.viewDetail.classList.remove('hidden');

    const a = record.analysis;
    const fillerTotal = a.fillers.reduce((s, w) => s + w.count, 0);
    const hedgeTotal = a.hedges.reduce((s, w) => s + w.count, 0);
    const vagueTotal = a.vagueWords.reduce((s, w) => s + w.count, 0);

    this.detailTitle.textContent =
      `${this.formatTime(record.createdAt)} · ${record.source === 'pasted' ? '逐字稿' : '录音'} · ${a.totalWords}字${record.draft ? ' · 🕘 草稿（未结束的会话）' : ''}`;

    const chips = (items: Array<{ word: string; count: number }>, cls: string) =>
      items.length
        ? `<div class="word-chips">${items.map((w) => `<span class="chip ${cls}">${w.word} <b>×${w.count}</b></span>`).join('')}</div>`
        : '<span style="color:var(--text-3);font-size:13px;">无</span>';

    const vagueChips = a.vagueWords.length
      ? `<div class="word-chips">${a.vagueWords.map((w) => `
          <span class="chip vague" title="${w.alternatives.join(' / ')}">${w.word} <b>×${w.count}</b> → ${w.alternatives.slice(0, 2).join('、')}</span>`).join('')}</div>`
      : '<span style="color:var(--text-3);font-size:13px;">无</span>';

    const suggestions = a.suggestions.length
      ? a.suggestions.map((s) => `<div class="suggestion-item">${s.message.replace(/</g, '&lt;')}</div>`).join('')
      : '<span style="color:var(--text-3);font-size:13px;">无</span>';

    // 报告渲染（容错：渲染失败回退纯文本）；报告放详情页最顶部，避免被长文本埋到下面
    let reportBody = '';
    if (record.report && record.report.trim()) {
      try {
        reportBody = md.render(record.report);
      } catch (error) {
        console.error('[历史] 报告渲染失败，回退纯文本', error);
        reportBody = `<pre>${record.report.replace(/</g, '&lt;')}</pre>`;
      }
    }
    const reportHtml = reportBody
      ? `<div class="section"><h3>📄 AI 分析报告</h3><div class="report-body">${reportBody}</div></div>`
      : '';

    this.detailContent.innerHTML = `
      ${reportHtml}

      <div class="section">
        <h3>📝 录音文本</h3>
        <div class="transcript">${highlightText(record.transcript)}</div>
      </div>

      <div class="section">
        <h3>📊 统计分析</h3>
        <div class="stat-grid">
          <div class="stat-cell"><div class="label">时长</div><div class="value">${this.formatDuration(record.durationSec)}</div></div>
          <div class="stat-cell"><div class="label">总字数</div><div class="value">${a.totalWords}</div></div>
          <div class="stat-cell"><div class="label">表达密度</div><div class="value green">${a.density}%</div></div>
          <div class="stat-cell"><div class="label">填充词</div><div class="value rose">${fillerTotal}</div></div>
          <div class="stat-cell"><div class="label">犹豫词</div><div class="value amber">${hedgeTotal}</div></div>
          <div class="stat-cell"><div class="label">笼统词</div><div class="value">${vagueTotal}</div></div>
        </div>
      </div>

      <div class="section">
        <h3>🔍 填充词（${fillerTotal}）</h3>${chips(a.fillers, 'filler')}
      </div>
      <div class="section">
        <h3>🟠 犹豫词（${hedgeTotal}）</h3>${chips(a.hedges, 'hedge')}
      </div>
      <div class="section">
        <h3>🟢 笼统词（${vagueTotal}，悬停看替代建议）</h3>${vagueChips}
      </div>
      <div class="section">
        <h3>💡 建议</h3>${suggestions}
      </div>`;
  }

  // ===== 删除 / 导出 =====

  private async deleteCurrent(): Promise<void> {
    if (!this.current) return;
    if (!confirm(`确定删除 ${this.formatTime(this.current.createdAt)} 这条训练记录吗？`)) return;
    const result = await window.api.history.delete(this.current.id);
    if (result.success) {
      this.refresh();
    } else {
      alert(`删除失败: ${result.error}`);
    }
  }

  private async exportCurrent(): Promise<void> {
    if (!this.current) return;
    const r = this.current;
    const a = r.analysis;
    const dateStr = r.createdAt.slice(0, 10);

    const markdown = `# 表达训练记录\n\n**时间**: ${this.formatTime(r.createdAt)}  \n**来源**: ${r.source === 'pasted' ? '粘贴逐字稿' : '录音'}  \n**时长**: ${r.durationSec}秒  \n**总字数**: ${a.totalWords}  \n**表达密度**: ${a.density}%  \n**填充词**: ${a.fillers.map((w) => `${w.word}×${w.count}`).join('、') || '无'}  \n**犹豫词**: ${a.hedges.map((w) => `${w.word}×${w.count}`).join('、') || '无'}  \n**笼统词**: ${a.vagueWords.map((w) => `${w.word}×${w.count}`).join('、') || '无'}  \n\n---\n\n## 完整原文\n\n${r.transcript}\n\n${r.report ? `---\n\n## AI 分析报告\n\n${r.report}\n` : ''}`;

    const filename = `训练记录-${dateStr}-${r.id.slice(-6)}.md`;
    const result = await window.api.saveFile(markdown, filename);
    // 用户取消保存对话框是正常操作，不弹错误
    if (!result.success && result.error !== '已取消') {
      alert(`导出失败: ${result.error}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new HistoryPage();
});

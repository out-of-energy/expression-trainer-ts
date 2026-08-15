/**
 * 历史训练记录存储 — 基于 userData/training-history.json。
 * 读写封装在此模块内部（含 .tmp 原子写入与轻量校验），
 * 未来如需换 SQLite，只需重写本模块，IPC 与界面无需改动。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TrainingRecord } from '../shared/types';

const HISTORY_FILE = 'training-history.json';
/** 保留上限：超出丢弃最旧记录 */
const MAX_RECORDS = 500;

export function historyFilePath(userDataDir: string): string {
  return path.join(userDataDir, HISTORY_FILE);
}

/** 轻量校验单条记录形状（损坏/旧版本数据直接跳过，不阻塞读取） */
function isTrainingRecord(value: unknown): value is TrainingRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.createdAt === 'string' &&
    (v.source === 'recording' || v.source === 'pasted') &&
    typeof v.transcript === 'string' &&
    typeof v.analysis === 'object' &&
    v.analysis !== null
  );
}

function loadRecords(userDataDir: string): TrainingRecord[] {
  const file = historyFilePath(userDataDir);
  if (!existsSync(file)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (Array.isArray(raw)) {
      return raw.filter(isTrainingRecord);
    }
  } catch {
    // 文件损坏：重命名备份后从空开始，避免覆盖用户数据
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // 忽略备份失败
    }
  }
  return [];
}

function saveRecords(userDataDir: string, records: TrainingRecord[]): void {
  mkdirSync(userDataDir, { recursive: true });
  const file = historyFilePath(userDataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
  renameSync(tmp, file);
}

/** 新增一条记录（id / createdAt 由主进程生成），返回完整记录 */
export function addRecord(
  userDataDir: string,
  record: Omit<TrainingRecord, 'id' | 'createdAt'>,
): TrainingRecord {
  const records = loadRecords(userDataDir);
  const full: TrainingRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  records.unshift(full);
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }
  saveRecords(userDataDir, records);
  return full;
}

/** 列出全部记录（新→旧） */
export function listRecords(userDataDir: string): TrainingRecord[] {
  return loadRecords(userDataDir);
}

/** 局部更新（如补写 AI 报告）。记录不存在返回 false */
export function updateRecord(
  userDataDir: string,
  id: string,
  patch: Partial<TrainingRecord>,
): boolean {
  const records = loadRecords(userDataDir);
  const index = records.findIndex((r) => r.id === id);
  if (index < 0) return false;
  const existing = records[index]!;
  // id / createdAt 不可被 patch 覆盖
  records[index] = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  saveRecords(userDataDir, records);
  return true;
}

/** 删除一条记录。记录不存在返回 false */
export function deleteRecord(userDataDir: string, id: string): boolean {
  const records = loadRecords(userDataDir);
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  saveRecords(userDataDir, next);
  return true;
}

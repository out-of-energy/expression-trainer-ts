# 🚀 宇宙无敌表达训练系统 - 本地桌面版

> 👉 **在线版已上线：[exprtrain.online](https://exprtrain.online)**，无需安装，打开浏览器即用。支持中英双语。

一个帮你训练口语表达精准度的本地桌面应用。实时语音识别 → 词库匹配 → AI反馈，其中语音识别与词库分析完全离线。

> 基于 [fxy2311-youyou/expression-trainer](https://github.com/fxy2311-youyou/expression-trainer) 重构（原项目 MIT License，作者 sisi）。

## 功能

- 🎤 **实时语音识别**：基于 Sherpa-ONNX，完全离线，中文优化
- 📝 **全屏字幕显示**：黑底大字，实时显示你说的每一句话
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代
- 🤖 **AI反馈**：支持 OpenAI / DeepSeek / Ollama / 自定义兼容接口多后端
- 📊 **分析报告**：6维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）
- 🕘 **训练历史**：每次训练自动入库（时间/文本/分析结果），独立窗口浏览、导出、删除（存储于 `userData/training-history.json`）

## 安装

### 1. 克隆项目 & 安装依赖

```bash
cd expression-trainer
npm install
```

> **国内网络提示**：`npm install` 时 electron 二进制的下载（走 GitHub release-assets）容易 `read ETIMEDOUT`。改用 npmmirror 镜像：
>
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```
> 若已装好依赖、只是二进制缺失：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
> ```

### 2. 加载语音识别模型

应用使用 Sherpa-ONNX 的 streaming paraformer-large 中文模型（全精度 fp32，约 865 MB）。

**推荐：应用内一键加载** —— 启动后点击右上角 ⚙️ 进入设置页，在「本地离线语音模型」处点击「加载」，应用会自动从国内镜像下载到用户数据目录（`~/Library/Application Support/宇宙无敌表达训练/models/`）。

**备选：手动下载到项目 `models/` 目录**（开发 / 离线部署）：

```bash
cd models && mkdir -p sherpa-onnx-streaming-paraformer-zh && cd sherpa-onnx-streaming-paraformer-zh
BASE="https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-paraformer-zh/resolve/main"
curl -L -C - -o encoder.onnx "$BASE/encoder.onnx"
curl -L -C - -o decoder.onnx "$BASE/decoder.onnx"
curl -L -C - -o tokens.txt "$BASE/tokens.txt"
```

模型就绪后的目录结构（三处文件齐全即视为已加载）：
```
models/
└── sherpa-onnx-streaming-paraformer-zh/
    ├── encoder.onnx
    ├── decoder.onnx
    └── tokens.txt
```
### 3. 启动应用

```bash
npm start
```

### 4. 配置 AI 后端

启动后点击右上角 ⚙️ 进入设置页面。

推荐配置：

| 后端 | 费用 | 速度 | 获取方式 |
|------|------|------|----------|
| DeepSeek | 极低 | 快 | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | 中等 | 快 | [platform.openai.com](https://platform.openai.com) |
| Ollama | 免费 | 取决于硬件 | [ollama.com](https://ollama.com) 本地运行 |

**推荐 deepseek**：生成报告质量高，且成本极低。

## 使用说明

1. **首次使用**：点右上角 ⚙️ → 设置页「本地离线语音模型」→「加载」，下载语音模型（全精度 fp32，约 865MB）
2. **点击「开始录制」** → 对着麦克风说话（若模型未加载，会提示并自动打开设置页）
3. **实时字幕**会在屏幕中央显示你说的内容
4. **左侧面板**实时统计填充词/犹豫词/笼统词
5. **右侧面板**每50字会给出AI实时反馈
6. **说完后点击「结束」** → 可以点「生成报告」获取完整分析
7. **每次训练自动入库**：点「结束」（录音）或粘贴逐字稿分析完成时，时间/文本/分析结果会自动保存到训练历史（🕘 按钮查看），**无需手动保存**；完整记录（含分析报告）可在历史页导出为 Markdown
8. **录制中每 30 秒自动保存草稿**：崩溃/误关窗口最多丢 30 秒内容；草稿在历史中标记「🕘 草稿」，点「结束」后同一条记录自动定型为正式记录，报告也写进这条

## 字幕颜色含义

| 颜色 | 含义 |
|------|------|
| 🟢 绿色虚线 | 笼统词（有精准替代建议） |
| 🔴 赭红波浪线 | 填充词（嗯、啊、那个、然后…） |
| 🟠 琥珀色 | 犹豫词（可能、也许、我觉得…） |

## 技术架构

```
┌─────────────────────────────────────────┐
│ Electron 主进程                          │
│  ├── Sherpa-ONNX (离线语音识别)          │
│  ├── 词库匹配 (emotion-lexicon.json)     │
│  └── AI反馈 (多后端 HTTP API)            │
├─────────────────────────────────────────┤
│ 渲染进程 (Chromium)                      │
│  ├── 全屏字幕显示                        │
│  ├── 实时统计面板                        │
│  └── 分析报告弹窗                        │
└─────────────────────────────────────────┘
```

## 词库说明

词库分两部分，均可修改后重启生效：

- **`data/emotion-lexicon.json`**：情绪词库（基于大连理工 7 大类情感词库精选），146 个情绪词，含分类（喜怒哀惧恶惊）、强度（1-9）与正负极，用于情绪词检测。
- **`data/tiered-lexicon.json`**：笼统词→精准词替换库（9 大类 100 组高频替代），是笼统词检测与字幕高亮的唯一数据源；填充词表（25 个常见口头禅）与犹豫词表（19 个弱化表达）定义在 `src/shared/lexicon-data.ts`，主进程分析与渲染进程高亮共用，杜绝词表漂移。

## 开发

```bash
# 类型检查
npm run typecheck

# 构建（esbuild 打包到 dist/）
npm run build

# 启动（构建 + 运行）
npm start

# 开发模式（带DevTools）
npm run dev
```

目录结构：

```
├── src/
│   ├── main/main.ts        # Electron 主进程
│   ├── preload.ts          # preload 脚本
│   ├── shared/             # 共享类型 + IPC 契约 + 词库数据源
│   ├── lib/                # asr / lexicon / ai-feedback / prompts / model-manager / history
│   └── renderer/           # 渲染进程（app / settings / history / *.html / styles.css）
├── data/
│   ├── emotion-lexicon.json   # 情绪词库（运行时加载）
│   └── tiered-lexicon.json    # 笼统词→精准词替换库（打包进主/渲染进程）
├── build.mjs               # esbuild 构建脚本
├── tsconfig.json
└── models/                 # Sherpa-ONNX 模型（应用内加载，或手动放置）
```

## 系统要求

- macOS 12+ / Windows 10+ / Linux
- Node.js 18+
- 麦克风权限
- （可选）网络连接（用于AI反馈，词库分析可离线）

## TODO

- [x] **语音识别模型优化**：已从「中英双语 int8」模型切换为「纯中文 paraformer-large 全精度 fp32」模型（`sherpa-onnx-streaming-paraformer-zh`，约 865MB，4 线程），中文识别准确率明显提升。如仍遇到错别字/误识别，可继续调研 Whisper / FunASR 等方案替换。

## License

MIT


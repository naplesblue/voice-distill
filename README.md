# voice-distill

从你的文章中提取写作指纹 — Extract your writing voice from articles

## 它能做什么

把你的文章喂进去，跑 15 分钟，拿到一份你的「写作 CT 报告」：

- **词汇指纹**：你常用什么词、回避什么词、标点习惯
- **句法签名**：句子长短节奏、段落模式、过渡风格
- **修辞 DNA**：开头怎么写、结尾怎么收、类比怎么用
- **思维模式**：论证方式、思维跳跃路径、下判断的时机
- **语气人格**：和读者的关系、确定/不确定的表达、情绪边界

输出两个文件：
- `voice-profile.json` — 结构化画像（可喂给 AI 用你的风格写作）
- `voice-exemplars.md` — 标注范文（最能代表你风格的段落）

## 快速开始

```bash
# 安装
git clone https://github.com/yourname/voice-distill.git
cd voice-distill
npm install

# 配置 API Key（二选一）
echo 'DASHSCOPE_API_KEY=your-key-here' > .env    # 阿里通义千问
# 或
echo 'OPENAI_API_KEY=your-key-here' > .env        # OpenAI

# 一键蒸馏（从 Markdown 文件夹）
node scripts/distill.mjs ./my-articles/

# 或从 Bear (熊掌记) 蒸馏
node scripts/distill.mjs --bear
```

## 输入格式

### Markdown 文件夹（推荐）

把你的文章放在一个文件夹里，支持 `.md`、`.txt` 文件，会递归扫描子目录：

```
my-articles/
├── 2024/
│   ├── 为什么看直播.md
│   └── iPhone评测.txt
├── 2025/
│   ├── AI编程体验.md
│   └── ...
└── ...
```

### Bear (熊掌记)

macOS 用户可以直接从 Bear 数据库导入，不需要手动导出：

```bash
node scripts/distill.mjs --bear
```

## 分步执行

如果需要调试或中断后继续：

```bash
# Phase 1: 导入
node scripts/import_folder.mjs ./my-articles/     # 从文件夹
# 或
node scripts/export_bear.mjs                       # 从 Bear

# Phase 2: 计算分析（零 LLM，秒级完成）
node scripts/distill_compute.mjs

# Phase 3: LLM 深度分析（~10 分钟）
node scripts/distill_llm.mjs
node scripts/distill_llm.mjs --resume              # 中断后继续
node scripts/distill_llm.mjs --sample 30            # 改抽样数

# Phase 4: 合成 Voice Profile
node scripts/distill_synthesize.mjs
```

## 环境变量

在 `.env` 文件中配置（或设为系统环境变量）：

| 变量 | 必须 | 说明 |
|------|------|------|
| `LLM_API_KEY` | ✅ | API Key（或用 `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`） |
| `LLM_BASE_URL` | ❌ | API 地址，默认 DashScope |
| `LLM_MODEL` | ❌ | 分析模型（默认 `qwen-plus`） |
| `LLM_MODEL_STRONG` | ❌ | 合成模型（默认同 `LLM_MODEL`） |

### 支持的 LLM 提供商

任何兼容 OpenAI Chat Completions API 的服务都可以，包括：

- **阿里通义千问** (DashScope) — 设置 `DASHSCOPE_API_KEY`
- **OpenAI** — 设置 `OPENAI_API_KEY`
- **DeepSeek** — 设置 `LLM_API_KEY` + `LLM_BASE_URL=https://api.deepseek.com/v1`
- **本地模型** (Ollama, vLLM) — 设置 `LLM_BASE_URL=http://localhost:11434/v1`

## 蒸馏原理

整个流程分 4 步，前两步零 LLM 消耗：

```
Phase 1: 数据导入 → corpus.json
Phase 2: 计算分析（jieba 分词 + 统计）→ 词汇指纹 + 句法签名
Phase 3: LLM 分析（抽样 60 篇 × 2 调用）→ 修辞 + 思维 + 语气
Phase 4: 合成 → voice-profile.json + voice-exemplars.md
```

### 分析维度

| 层 | 方法 | 分析内容 |
|---|---|---|
| L1 词汇指纹 | 纯计算 | 高频词、搭配、标点、人称分布、口语词 |
| L2 句法签名 | 纯计算 | 句长分布、段落节奏、长短句交替模式、段间过渡 |
| L3 修辞 DNA | LLM | 开篇/收尾类型、类比风格、幽默模式、过渡手法 |
| L4 思维模式 | LLM | 论证流向、思维跳跃、判断时机、信息取舍 |
| L5 语气人格 | LLM | 读者关系、确定性表达、情绪范围、权威来源 |

### 成本

- Phase 1-2：¥0（纯计算）
- Phase 3：60 篇 × 2 LLM 调用 ≈ ¥1-2（qwen-plus）
- Phase 4：2 次 LLM 调用 ≈ ¥0.5
- **总计：~¥2-3**

## 输出说明

### voice-profile.json

结构化的写作画像，包含：

- `persona_summary`：一段话描述你的写作人格
- `lexical`：词汇偏好、回避词、连接词、标点习惯
- `rhythm`：句子节奏、段落模式、行文速度
- `rhetoric`：开头/结尾套路、过渡风格、类比和幽默
- `cognition`：论证方式、思维跳跃、判断风格
- `persona`：读者关系、情绪范围、权威来源
- `writing_rules`：10-15 条可操作的写作规则
- `_raw_stats`：原始统计数据

### voice-exemplars.md

5-8 个最能代表你风格的段落，每段标注：
- 体现了哪些 voice profile 特征
- 为什么 AI 写不出这样的文字

## 用 Voice Profile 做什么

1. **让 AI 用你的声音写作**：把 `voice-profile.json` 和几个 exemplar 注入 system prompt
2. **自我认知**：你可能不知道自己 96% 的段落之间从不用过渡词
3. **团队风格对齐**：蒸馏主编风格，让新人快速学会
4. **写作教学**：对比不同作者的 Profile，看到风格差异的量化数据

## 建议文章数量

| 数量 | 效果 |
|------|------|
| < 20 篇 | 统计不可靠，LLM 分析样本太少 |
| 20-50 篇 | 基本可用，能抓到主要特征 |
| 50-200 篇 | 优良，词汇指纹和节奏模式可靠 |
| 200+ 篇 | 极佳，全维度数据充分 |

## License

MIT

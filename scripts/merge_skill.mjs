#!/usr/bin/env node
import './env.mjs';
/**
 * merge_skill.mjs — 合成最终 SKILL.md
 *
 * 读取底盘 voice-profile.json + 多个维度提取文件，
 * 用 LLM 合成一份可操作的 SKILL.md。
 *
 * 用法：
 *   node scripts/merge_skill.mjs \
 *     --base voice-profile.json \
 *     --overlay sources/wangxiaobo/extract-rhythm.json \
 *     --overlay sources/hecaitou/extract-closing.json \
 *     --output SKILL.md
 *
 *   # 最简用法（只用自己的 profile，不加覆盖层）：
 *   node scripts/merge_skill.mjs --base voice-profile.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── 环境 ──
const LLM_API_KEY = process.env.LLM_API_KEY;
if (!LLM_API_KEY) {
  console.error('[ERROR] 未设置 API Key。请设置 LLM_API_KEY, DASHSCOPE_API_KEY, 或 OPENAI_API_KEY');
  process.exit(1);
}
const MODEL = process.env.LLM_MODEL_STRONG || process.env.LLM_MODEL || 'qwen3-max';
const API_URL = `${process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;

function log(msg) { console.error(msg); }

// ── CLI ──
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const basePath = baseIdx >= 0 ? args[baseIdx + 1] : path.join(ROOT, 'voice-profile.json');
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : path.join(ROOT, 'SKILL.md');

// 收集所有 --overlay 参数
const overlays = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--overlay' && args[i + 1]) {
    overlays.push(args[i + 1]);
  }
}

if (!fs.existsSync(basePath)) {
  log(`[ERROR] Base profile 不存在: ${basePath}`);
  log('请先运行 node scripts/distill.mjs --bear 生成你的 voice-profile.json');
  process.exit(1);
}

// ── LLM 调用 ──
async function callLLM(system, user, maxTokens = 4000) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Main ──
async function main() {
  log('═══ SKILL.md 合成 ═══\n');

  // 加载底盘
  const profile = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
  log(`[Base] ${basePath}`);
  log(`[Base] persona: ${profile.persona_summary?.slice(0, 60)}...`);

  // 加载覆盖层
  const overlayData = [];
  for (const overlayPath of overlays) {
    if (!fs.existsSync(overlayPath)) {
      log(`[WARN] Overlay 不存在，跳过: ${overlayPath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(overlayPath, 'utf-8'));
    overlayData.push(data);
    log(`[Overlay] ${data.author}/${data.dimension} (${data.sampleSize} 篇)`);
  }

  // 构建合成输入
  const mergeInput = {
    base_profile: {
      persona_summary: profile.persona_summary,
      lexical: profile.lexical,
      rhythm: profile.rhythm,
      rhetoric: profile.rhetoric,
      cognition: profile.cognition,
      persona: profile.persona,
      writing_rules: profile.writing_rules,
      forbidden_patterns: profile.forbidden_patterns,
    },
    overlays: overlayData.map(o => ({
      author: o.author,
      dimension: o.dimension,
      technique: {
        signature_pattern: o.technique?.signature_pattern,
        rules: o.technique?.rules,
        examples: o.technique?.examples,
      },
    })),
  };

  // 合成 SKILL.md
  const MERGE_PROMPT = `你是一位专业的 AI 提示词工程师。你的任务是将以下写作风格数据合成为一份结构化的 SKILL.md 文件。

这份 SKILL.md 将被用作 AI 写作助手的 system prompt，指导 AI 以特定风格写作。

## 输入说明
1. base_profile：来自作者自己 1283 篇文章的蒸馏结果，是风格底盘
2. overlays：从其他知名作家提取的特定维度技巧，用于增强底盘的特定能力

## 输出要求
生成一份 Markdown 格式的 SKILL.md，包含以下部分：

### 结构
1. **角色定义**：用 2-3 句话定义这个写作角色（基于 persona_summary）
2. **风格底盘**：
   - 词汇规则（signature_words、avoided_words、connectors）
   - 节奏规则（sentence_pattern、paragraph_pattern）
   - 修辞规则（opening、closing、transition、analogy、humor）
   - 认知模式（argument_flow、judgment_style、judgment_tendencies）
3. **技巧覆盖**（如果有 overlays）：
   - 每个 overlay 一个子section
   - 标明来源作者和维度
   - 列出可操作规则
4. **写作规则清单**：从 base writing_rules + overlay rules 合并，去重，按重要性排序
5. **禁令表**：原样保留 forbidden_patterns
6. **质量检查清单**：生成 checklist，包含风格检查 + overlay 覆盖检查

### 风格要求
- 每条规则必须具体、可遵循
- 用"做/不做"格式，避免抽象描述
- 示例用引号包裹

直接输出 Markdown 内容，不要代码块包裹。`;

  log('\n[Merge] 调用 LLM 合成 SKILL.md...');
  const skillContent = await callLLM(MERGE_PROMPT, JSON.stringify(mergeInput, null, 2), 6000);

  fs.writeFileSync(outputPath, skillContent);
  log(`[Merge] → ${outputPath}`);
  log(`[Merge] ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

  log('\n✅ SKILL.md 合成完成');
}

main().catch(e => {
  log(`[FATAL] ${e.message}`);
  process.exit(1);
});

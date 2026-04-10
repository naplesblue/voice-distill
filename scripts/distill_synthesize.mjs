#!/usr/bin/env node
import './env.mjs';
/**
 * distill_synthesize.mjs — 合成 Voice Profile
 *
 * 读取 Phase 2 (compute-profile.json) + Phase 3 (llm-analysis.json)
 * 用 LLM 合成最终的 voice-profile.json + voice-exemplars.md
 *
 * 用法：
 *   node scripts/distill_synthesize.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const VOICE_DIR = path.join(ROOT, 'sources', 'voice');
const COMPUTE_PATH = path.join(VOICE_DIR, 'compute-profile.json');
const LLM_PATH = path.join(VOICE_DIR, 'llm-analysis.json');
const PROFILE_OUTPUT = path.join(ROOT, 'voice-profile.json');
const EXEMPLARS_OUTPUT = path.join(ROOT, 'voice-exemplars.md');

// ── 环境 ──
const LLM_API_KEY = process.env.LLM_API_KEY;
if (!LLM_API_KEY) {
  console.error('[ERROR] 未设置 API Key。请设置 LLM_API_KEY, DASHSCOPE_API_KEY, 或 OPENAI_API_KEY');
  process.exit(1);
}
const MODEL = process.env.LLM_MODEL_STRONG || process.env.LLM_MODEL || 'qwen3-max';
const API_URL = `${process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;

function log(msg) { console.error(msg); }

async function callLLM(system, user, maxTokens = 4000) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LLM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return json.choices?.[0]?.message?.content || '';
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(3, attempt)));
        continue;
      }
      throw new Error(`API ${res.status}`);
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(3, attempt)));
    }
  }
}

function parseJSON(raw) {
  let s = raw;
  s = s.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  s = s.trim();
  const lastBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (lastBrace > 0) s = s.slice(0, lastBrace + 1);
  try { return JSON.parse(s); } catch {}
  const fixed = s.replace(/(?<=: *"(?:[^"\\]|\\.)*)\\n(?=[^"]*")/g, '\\\\n');
  return JSON.parse(fixed);
}

// ── Main ──
async function main() {
  log('═══ Voice Profile 合成 ═══\n');

  // 加载数据
  const compute = JSON.parse(fs.readFileSync(COMPUTE_PATH, 'utf-8'));
  const llmData = JSON.parse(fs.readFileSync(LLM_PATH, 'utf-8'));
  const analyses = llmData.analyses.filter(a => !a.error);

  log(`[Input] 计算分析: ${compute.meta.articlesAnalyzed} 篇`);
  log(`[Input] LLM 分析: ${analyses.length} 篇成功`);

  // ── 汇总 LLM 分析结果 ──
  // 开头分布
  const openingDist = {};
  const closingDist = {};
  const flowDist = {};
  const readerDist = {};
  const allJumps = [];
  const allJudgments = [];
  const allAnalogies = [];
  const allHumor = [];
  const allSignatureExpr = [];
  const allBestParagraphs = [];
  const allAntiAI = [];
  const allCertaintyHigh = [];
  const allCertaintyLow = [];
  const toneDescriptions = [];

  for (const a of analyses) {
    // Structure
    const s = a.structure || {};
    openingDist[s.opening_type] = (openingDist[s.opening_type] || 0) + 1;
    closingDist[s.closing_type] = (closingDist[s.closing_type] || 0) + 1;
    if (s.jumps) allJumps.push(...s.jumps);
    if (s.judgments) allJudgments.push(...s.judgments);
    if (s.analogies) allAnalogies.push(...s.analogies);

    // Style
    const st = a.style || {};
    flowDist[st.argument_flow] = (flowDist[st.argument_flow] || 0) + 1;
    readerDist[st.reader_relationship] = (readerDist[st.reader_relationship] || 0) + 1;
    if (st.humor_instances) allHumor.push(...st.humor_instances);
    if (st.signature_expressions) allSignatureExpr.push(...st.signature_expressions);
    if (st.best_paragraphs) allBestParagraphs.push(...st.best_paragraphs);
    if (st.anti_ai_markers) allAntiAI.push(...st.anti_ai_markers);
    if (st.certainty_high) allCertaintyHigh.push(...st.certainty_high);
    if (st.certainty_low) allCertaintyLow.push(...st.certainty_low);
    if (st.tone_description) toneDescriptions.push(st.tone_description);
  }

  // 去重
  const uniqueExpr = [...new Set(allSignatureExpr)].slice(0, 30);
  const uniqueHumor = [...new Set(allHumor)].slice(0, 20);
  const uniqueAntiAI = [...new Set(allAntiAI)].slice(0, 15);

  // 归一化分布
  function normalizeDist(dist) {
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const result = {};
    for (const [k, v] of Object.entries(dist)) {
      result[k] = `${(v / total * 100).toFixed(0)}%`;
    }
    return result;
  }

  // ── 准备合成 Prompt 输入 ──
  const synthInput = {
    corpus_stats: {
      totalArticles: compute.meta.articlesAnalyzed,
      totalChars: compute.meta.totalChars,
      totalWords: compute.meta.totalWords,
    },
    L1_lexical: {
      topWords_30: compute.L1_lexical.topWords.slice(0, 30).map(w => w.word),
      topBigrams_20: compute.L1_lexical.topBigrams.slice(0, 20).map(b => b.bigram),
      pronounDistribution: compute.L1_lexical.pronounDistribution,
      colloquials_top20: Object.keys(compute.L1_lexical.colloquials).slice(0, 20),
      punctuation_highlights: {
        exclamation_per1000: compute.L1_lexical.punctuation['！']?.per1000chars,
        question_per1000: compute.L1_lexical.punctuation['？']?.per1000chars,
        em_dash_per1000: compute.L1_lexical.punctuation['——']?.per1000chars || compute.L1_lexical.punctuation['—']?.per1000chars,
        ellipsis_per1000: compute.L1_lexical.punctuation['…']?.per1000chars,
      },
    },
    L2_syntactic: {
      sentenceLength: compute.L2_syntactic.sentenceLength,
      paragraphLength: compute.L2_syntactic.paragraphLength,
      sentencesPerParagraph: compute.L2_syntactic.sentencesPerParagraph,
      rhythmPatterns_top5: compute.L2_syntactic.rhythmPatterns.slice(0, 5),
      transitionTypes: compute.L2_syntactic.transitionTypes,
    },
    L3_L4_L5_from_60_articles: {
      openingDistribution: normalizeDist(openingDist),
      closingDistribution: normalizeDist(closingDist),
      argumentFlowDistribution: normalizeDist(flowDist),
      readerRelationshipDistribution: normalizeDist(readerDist),
      jumpPatterns_sample: allJumps.slice(0, 15),
      judgmentPatterns_sample: allJudgments.slice(0, 15),
      analogies_sample: allAnalogies.slice(0, 10),
      humor_sample: uniqueHumor.slice(0, 10),
      signatureExpressions: uniqueExpr,
      antiAI_markers: uniqueAntiAI,
      certainty_high: [...new Set(allCertaintyHigh)].slice(0, 10),
      certainty_low: [...new Set(allCertaintyLow)].slice(0, 10),
      tone_descriptions_sample: toneDescriptions.slice(0, 10),
    },
    best_paragraphs: allBestParagraphs.slice(0, 20),
  };

  // ── 合成 Voice Profile ──
  const SYNTH_PROMPT = `你是语言学家和文体学专家。你的任务是根据对 1282 篇中文公众号文章的多维分析数据，合成一个结构化的「作者声音画像」(Voice Profile)。

这个画像将被用于指导 AI 以这位作者的风格写作。因此，你需要：
1. 从统计数据和 LLM 分析中提炼出**可操作的**写作指令（不是抽象描述）
2. 区分这位作者**独特的**特征和所有中文作者**共有的**特征，只保留独特的
3. 用具体的、有示例的方式描述每个特征，让 AI 写作者能直接遵循

输出 JSON：
{
  "persona_summary": "用 3-5 句话描述这个人的写作人格，像是在向一个代笔人介绍'你要模仿的人是这样的'",
  "lexical": {
    "signature_words": ["这个人常用但大多数人不用的词/短语，至少 15 个"],
    "avoided_words": ["根据数据推断这个人几乎不用的词类型"],
    "connectors_preferred": ["偏好的连接词，带使用频率描述"],
    "punctuation_habits": "标点使用习惯的一句话描述"
  },
  "rhythm": {
    "sentence_pattern": "用具体的描述说这个人的句子节奏是怎样的（如：偏好短句，但每3-4句会插入一个长句做解释）",
    "paragraph_pattern": "段落习惯（如：每段通常2句，段落偏短，快速切换话题）",
    "pacing": "整体行文节奏描述"
  },
  "rhetoric": {
    "opening_moves": ["这个人最常用的 3 种开头方式，每种带一个概括性描述"],
    "closing_moves": ["最常用的 3 种结尾方式"],
    "transition_style": "段间怎么连接——根据数据，这个人几乎从不用过渡词，直接硬切",
    "analogy_style": "这个人用类比的方式和偏好",
    "humor_style": "幽默风格描述"
  },
  "cognition": {
    "argument_flow": "论证方式的描述（演绎/归纳/意识流各占多少，什么时候用哪种）",
    "jump_patterns": ["思维跳跃的典型模式，至少 3 种"],
    "judgment_style": "什么时候下判断、怎么引入判断、判断的力度如何",
    "information_priority": "面对一堆信息时，这个人会先说什么、详写什么、略掉什么"
  },
  "persona": {
    "reader_relationship": "和读者的关系定位",
    "certainty_expression": "如何表达确定和不确定",
    "emotional_range": "情绪范围和边界",
    "authority_source": "靠什么让人信服"
  },
  "writing_rules": [
    "从以上分析中提炼出 10-15 条最具操作性的写作规则，按重要性排序。每条规则要具体到可以直接遵循，而不是抽象原则。例如：'段落之间直接硬切，不用"但是""然而""所以"等过渡词' 而不是 '过渡要自然'"
  ]
}

只输出 JSON。`;

  log('\n[Synth] 合成 Voice Profile (MODEL_STRONG)...');
  const profileRaw = await callLLM(SYNTH_PROMPT, JSON.stringify(synthInput, null, 2), 5000);
  const profile = parseJSON(profileRaw);

  // 加入元信息
  profile.meta = {
    source: `Bear notes, ${compute.meta.articlesAnalyzed} articles`,
    sourceSpan: '2018-2026',
    sampledAt: new Date().toISOString(),
    sampleSize: analyses.length,
    models: { compute: 'nodejieba + statistics', llm: MODEL },
  };

  // 注入计算指标（Profile 里保留原始数据供参考）
  profile._raw_stats = {
    sentenceLength: compute.L2_syntactic.sentenceLength,
    paragraphLength: compute.L2_syntactic.paragraphLength,
    rhythmPatterns: compute.L2_syntactic.rhythmPatterns.slice(0, 10),
    transitionTypes: compute.L2_syntactic.transitionTypes,
    pronounDistribution: compute.L1_lexical.pronounDistribution,
  };

  fs.writeFileSync(PROFILE_OUTPUT, JSON.stringify(profile, null, 2));
  log(`[Synth] → ${PROFILE_OUTPUT}`);

  // ── 生成 Exemplars Markdown ──
  log('[Synth] 生成 voice-exemplars.md...');

  const EXEMPLAR_PROMPT = `你是文体学编辑。从以下候选段落中选出 5-8 个最能代表这位作者独特风格的段落。

选择标准：
1. 这个段落包含了这位作者的典型特征（思维跳跃、判断方式、幽默、节奏）
2. 这个段落是 AI 写不出来的
3. 选出的段落之间要有差异性，展示作者风格的不同面
4. 段落来源多样化，覆盖不同话题

对每个选出的段落，写出：
1. 原文（≤150字）
2. 这个段落展示了作者的哪些特征（对照 voice profile）
3. 为什么 AI 写不出这样的文字

输出 Markdown 格式：

## Exemplar 1: [一句话标签]

> [原文]

**风格特征**: [列出体现的特征]

**Anti-AI**: [为什么 AI 写不出]

---

依此类推。`;

  const exemplarInput = `Voice Profile 摘要：\n${profile.persona_summary}\n\n候选段落：\n${JSON.stringify(allBestParagraphs.slice(0, 30), null, 2)}\n\n补充 — 签名表达：\n${uniqueExpr.join('\n')}\n\n幽默实例：\n${uniqueHumor.slice(0, 10).join('\n')}`;

  const exemplarMd = await callLLM(EXEMPLAR_PROMPT, exemplarInput, 3000);

  // 加 header
  const fullExemplars = `# Voice Exemplars — 风格范文

> 从 ${analyses.length} 篇分析样本中选出的代表性段落。
> 每段标注了对应的 voice profile 特征和 AI 无法复制的原因。
> 本文件与 voice-profile.json 配合使用。

---

${exemplarMd}
`;

  fs.writeFileSync(EXEMPLARS_OUTPUT, fullExemplars);
  log(`[Synth] → ${EXEMPLARS_OUTPUT}`);

  log(`\n✅ Voice Profile 合成完成`);
  log(`   Profile: ${PROFILE_OUTPUT}`);
  log(`   Exemplars: ${EXEMPLARS_OUTPUT}`);
}

main().catch(e => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});

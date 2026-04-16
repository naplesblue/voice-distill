#!/usr/bin/env node
import './env.mjs';
/**
 * distill_llm.mjs — LLM 深度分析（L3 修辞 + L4 思维 + L5 语气）
 *
 * 从语料中抽样 60 篇，每篇 2 次 LLM 调用。
 *
 * 用法：
 *   node scripts/distill_llm.mjs                   # 抽样 60 篇分析
 *   node scripts/distill_llm.mjs --sample 20       # 改抽样数
 *   node scripts/distill_llm.mjs --verbose          # 显示每篇结果
 *   node scripts/distill_llm.mjs --resume           # 从上次中断处继续
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const authorIdx = process.argv.indexOf('--author');
const AUTHOR = authorIdx >= 0 ? process.argv[authorIdx + 1] : 'voice';
const CORPUS_PATH = path.join(ROOT, 'sources', AUTHOR, 'corpus.json');
const OUTPUT_PATH = path.join(ROOT, 'sources', AUTHOR, 'llm-analysis.json');

// ── 环境 ──
const LLM_API_KEY = process.env.LLM_API_KEY;
if (!LLM_API_KEY) {
  console.error('[ERROR] 未设置 API Key。请设置 LLM_API_KEY, DASHSCOPE_API_KEY, 或 OPENAI_API_KEY');
  process.exit(1);
}

const MODEL = process.env.LLM_MODEL || 'qwen-plus';
const API_URL = `${process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
const CONCURRENCY = 3;

// ── CLI ──
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const resume = args.includes('--resume');
const sampleIdx = args.indexOf('--sample');
const SAMPLE_PER_BUCKET = sampleIdx >= 0 ? Math.ceil(parseInt(args[sampleIdx + 1], 10) / 3) : 20;

function log(msg) { console.error(msg); }

// ── LLM ──
async function callLLM(system, user, maxTokens = 2000) {
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
      throw new Error(`API ${res.status}: ${await res.text()}`);
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
  try { return JSON.parse(fixed); } catch {}
  // last resort: strip problematic fields
  const s3 = s.replace(/"(text|paragraph|example)":\s*"[^}]*?",?/g, '"$1": "...",');
  return JSON.parse(s3);
}

// ── 抽样策略 ──
function sampleArticles(corpus) {
  // 按长度分 3 档
  const buckets = {
    medium: corpus.filter(a => a.charCount >= 500 && a.charCount < 1500),
    long: corpus.filter(a => a.charCount >= 1500 && a.charCount < 3000),
    extra: corpus.filter(a => a.charCount >= 3000),
  };

  const sampled = [];
  for (const [bucket, articles] of Object.entries(buckets)) {
    // 按 timeWeight 加权随机抽样
    const weighted = articles.map(a => ({
      ...a,
      _sortKey: Math.random() * (a.timeWeight || 1), // 时间权重越大，被选中概率越高
    }));
    weighted.sort((a, b) => b._sortKey - a._sortKey);
    const picked = weighted.slice(0, SAMPLE_PER_BUCKET);
    for (const p of picked) {
      delete p._sortKey;
      sampled.push({ ...p, _bucket: bucket });
    }
    log(`[Sample] ${bucket}: ${picked.length}/${articles.length} 篇`);
  }

  return sampled;
}

// ── 分析 Prompt ──
const STRUCTURE_PROMPT = `你是文学评论家，专业分析中文非虚构写作的结构与修辞特征。

分析以下文章的结构和修辞手法。这是一位公众号作者的原创文章，风格偏意识流、个人化，不是新闻稿。

请输出 JSON：
{
  "opening_type": "scene|judgment|question|fact|anecdote|dialogue",
  "opening_technique": "用一句话描述开头怎么抓注意力的",
  "sections": [
    {
      "position": "开头|中段|结尾",
      "goal": "这段在做什么",
      "technique": "用了什么手法（如：铺场景、下判断、举反例、自嘲、转折）",
      "transition_from_prev": "hard_cut|causal|contrast|association|temporal|none"
    }
  ],
  "closing_type": "fact|observation|open|callback|judgment|self_deprecation",
  "closing_technique": "结尾怎么收的",
  "jumps": [
    { "from": "话题A", "to": "话题B", "bridge": "什么触发了这个跳跃" }
  ],
  "judgments": [
    {
      "position": "第几段",
      "content": "作者判断的内容摘要",
      "signal": "引入判断时用的信号词或句式",
      "type": "direct|hedged|implied|rhetorical",
      "target_category": "tech_product|company|person|trend|culture|self|other",
      "valence": "positive|negative|mixed|ironic"
    }
  ],
  "analogies": ["文中使用的类比或比喻，原文摘录"]
}
只输出 JSON。`;

const STYLE_PROMPT = `你是文学风格分析专家，专注中文文体学。

分析以下公众号文章的文体风格特征。关注作者的个人印记——是什么让这篇文章读起来像"一个特定的人写的"而不是任何人都能写的。

请输出 JSON：
{
  "tone_description": "用 2-3 句话描述这篇文章的整体语气",
  "humor_instances": ["具体的幽默/讽刺/自嘲段落，原文摘录（最多 3 个）"],
  "signature_expressions": ["只有这个作者会这样说的表达方式（最多 5 个），摘录原文"],
  "certainty_high": ["作者表达强确定性时的用词/句式（最多 3 个）"],
  "certainty_low": ["作者表达不确定时的用词/句式（最多 3 个）"],
  "reader_relationship": "friend|mentor|peer|observer|storyteller",
  "argument_flow": "deductive|inductive|mixed|stream_of_consciousness",
  "emotional_range": "从什么到什么（如：冷静调侃到克制的不满）",
  "best_paragraphs": [
    {
      "text": "最能代表作者风格的段落原文（最多 3 段，每段 ≤100 字）",
      "why": "为什么这段代表作者风格"
    }
  ],
  "anti_ai_markers": ["这篇文章中哪些特征是 AI 写不出来的（最多 3 个）"]
}
只输出 JSON。`;

const TOPIC_PROMPT = `对以下中文文章做话题分类。只输出一个 JSON：
{
  "primary_topic": "review|essay|tutorial|opinion|story|news_commentary",
  "topic_confidence": 0.0-1.0
}
只输出 JSON。`;

// ── 单篇分析 ──
async function analyzeOne(article, index, total) {
  const tag = `[${index + 1}/${total}]`;
  const title = article.title?.slice(0, 20) || '?';

  // 截断过长的文章，保留核心（取前 2500 字 + 后 500 字）
  let bodyForLLM = article.body;
  if (bodyForLLM.length > 3000) {
    bodyForLLM = bodyForLLM.slice(0, 2500) + '\n\n[...中间省略...]\n\n' + bodyForLLM.slice(-500);
  }

  const userContent = `标题：${article.title}\n\n${bodyForLLM}`;

  try {
    // Call 0: 话题分类（轻量）
    log(`${tag} "${title}" 话题分类...`);
    let topic = 'unknown';
    try {
      const topicRaw = await callLLM(TOPIC_PROMPT, userContent, 100);
      const topicResult = parseJSON(topicRaw);
      topic = topicResult.primary_topic || 'unknown';
    } catch {
      // 话题分类失败不影响主分析
      topic = 'unknown';
    }

    // Call 1: 结构拆解
    log(`${tag} "${title}" 结构分析...`);
    const structRaw = await callLLM(STRUCTURE_PROMPT, userContent, 1500);
    const structure = parseJSON(structRaw);

    // Call 2: 风格特征
    log(`${tag} "${title}" 风格分析...`);
    const styleRaw = await callLLM(STYLE_PROMPT, userContent, 1500);
    const style = parseJSON(styleRaw);

    log(`${tag} ✅ "${title}" [${topic}] — ${structure.opening_type}开头, ${structure.closing_type}结尾, ${style.argument_flow}`);

    return {
      id: article.id,
      title: article.title,
      topic,
      bucket: article._bucket,
      charCount: article.charCount,
      timeWeight: article.timeWeight,
      createdAt: article.createdAt,
      structure,
      style,
    };
  } catch (e) {
    log(`${tag} ❌ "${title}" — ${e.message}`);
    return {
      id: article.id,
      title: article.title,
      error: e.message,
    };
  }
}

// ── Main ──
async function main() {
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));
  log(`[LLM] 语料: ${corpus.length} 篇`);
  log(`[LLM] 模型: ${MODEL}`);
  log(`[LLM] 每档抽样: ${SAMPLE_PER_BUCKET} 篇\n`);

  // 加载已有结果（用于 resume）
  let existing = [];
  if (resume && fs.existsSync(OUTPUT_PATH)) {
    const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    existing = prev.analyses || [];
    log(`[LLM] 恢复模式: 已有 ${existing.length} 篇分析结果`);
  }
  const doneIds = new Set(existing.filter(a => !a.error).map(a => a.id));

  // 抽样
  let sampled = sampleArticles(corpus);
  // 过滤已完成的
  if (doneIds.size > 0) {
    const before = sampled.length;
    sampled = sampled.filter(a => !doneIds.has(a.id));
    log(`[LLM] 跳过已分析: ${before - sampled.length} 篇，剩余 ${sampled.length} 篇`);
  }

  log(`\n═══ 开始 LLM 分析 (${sampled.length} 篇) ═══\n`);

  // 并发分析
  const results = [...existing.filter(a => !a.error)];
  for (let i = 0; i < sampled.length; i += CONCURRENCY) {
    const batch = sampled.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((a, j) => analyzeOne(a, i + j, sampled.length))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
      if (r.status === 'rejected') {
        log(`[ERROR] ${r.reason?.message}`);
      }
    }

    // 增量保存（防中断丢数据）
    const output = {
      analyzedAt: new Date().toISOString(),
      model: MODEL,
      totalSampled: results.length,
      analyses: results,
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  }

  // 汇总统计
  const successful = results.filter(r => !r.error);
  const openingDist = {};
  const closingDist = {};
  const flowDist = {};
  const readerDist = {};

  for (const r of successful) {
    const ot = r.structure?.opening_type || '?';
    const ct = r.structure?.closing_type || '?';
    const af = r.style?.argument_flow || '?';
    const rr = r.style?.reader_relationship || '?';
    openingDist[ot] = (openingDist[ot] || 0) + 1;
    closingDist[ct] = (closingDist[ct] || 0) + 1;
    flowDist[af] = (flowDist[af] || 0) + 1;
    readerDist[rr] = (readerDist[rr] || 0) + 1;
  }

  log(`\n═══ 汇总 ═══`);
  log(`成功: ${successful.length}/${results.length}`);
  log(`开头分布: ${JSON.stringify(openingDist)}`);
  log(`结尾分布: ${JSON.stringify(closingDist)}`);
  log(`论证流向: ${JSON.stringify(flowDist)}`);
  log(`读者关系: ${JSON.stringify(readerDist)}`);

  log(`\n✅ LLM 分析完成 → ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});

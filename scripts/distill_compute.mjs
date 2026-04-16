#!/usr/bin/env node
/**
 * distill_compute.mjs — 纯计算分析（L1 词汇指纹 + L2 句法签名）
 *
 * 零 LLM 调用。对全量语料做统计分析。
 *
 * 用法：
 *   node scripts/distill_compute.mjs
 *   node scripts/distill_compute.mjs --verbose    # 输出详细中间数据
 */
import fs from 'node:fs';
import path from 'node:path';
import nodejieba from 'nodejieba';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const authorIdx = args.indexOf('--author');
const AUTHOR = authorIdx >= 0 ? args[authorIdx + 1] : 'voice';
const CORPUS_PATH = path.join(ROOT, 'sources', AUTHOR, 'corpus.json');
const OUTPUT_PATH = path.join(ROOT, 'sources', AUTHOR, 'compute-profile.json');
const verbose = args.includes('--verbose');

function log(msg) { console.error(msg); }

// ── 通用中文停用词 ──
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '被', '对', '吗', '什么', '让',
  '把', '我们', '很', '大', '来', '还', '个', '中', '从', '但', '与', '这个',
  '能', '出', '为', '如果', '而', '里', '下', '可以', '就是', '因为', '所以',
  '然后', '之', '此', '其', '或', '以', '及', '等', '又', '所', '地',
  '得', '过', '做', '已经', '可能', '知道', '时候', '没', '想', '这样',
  '其实', '不是', '这种', '那个', '那些', '这些', '怎么', '多', '为什么',
  '啊', '呢', '吧', '嘛', '哦', '呀', '么',
]);

// ── 加载语料 ──
log('[L1+L2] 加载语料...');
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));
log(`[L1+L2] ${corpus.length} 篇文章`);

// ══════════════════════════════════════
//  L1: 词汇指纹
// ══════════════════════════════════════
log('\n═══ L1: 词汇指纹 ═══');

// 1. 分词 + 词频统计
const wordFreq = new Map();
const bigramFreq = new Map(); // 2-gram
let totalWords = 0;
let totalChars = 0;

for (const article of corpus) {
  const words = nodejieba.cut(article.body);
  const weight = article.timeWeight || 1;

  let prevWord = null;
  for (const w of words) {
    const trimmed = w.trim();
    if (trimmed.length === 0) continue;
    // 跳过纯标点和数字
    if (/^[\d\s.,;:!?。，；：！？""''（）\-—…·、》《\n\r]+$/.test(trimmed)) continue;

    totalWords++;
    wordFreq.set(trimmed, (wordFreq.get(trimmed) || 0) + weight);

    // bigram
    if (prevWord) {
      const bg = `${prevWord}+${trimmed}`;
      bigramFreq.set(bg, (bigramFreq.get(bg) || 0) + weight);
    }
    prevWord = trimmed;
  }
  totalChars += article.body.length;
}

log(`[L1] 总词数: ${totalWords}，去重词汇: ${wordFreq.size}`);

// 2. 高频词 top 200（去停用词）
const sortedWords = [...wordFreq.entries()]
  .filter(([w]) => !STOP_WORDS.has(w) && w.length >= 2)
  .sort((a, b) => b[1] - a[1]);
const topWords = sortedWords.slice(0, 200).map(([word, freq]) => ({
  word,
  weightedFreq: Math.round(freq * 10) / 10,
  perMille: Math.round(freq / totalWords * 10000) / 10,
}));

// 3. 高频 bigram（可能包含独特搭配）
const sortedBigrams = [...bigramFreq.entries()]
  .filter(([bg]) => {
    const [a, b] = bg.split('+');
    return a.length >= 2 && b.length >= 2 && !STOP_WORDS.has(a) && !STOP_WORDS.has(b);
  })
  .sort((a, b) => b[1] - a[1]);
const topBigrams = sortedBigrams.slice(0, 100).map(([bg, freq]) => ({
  bigram: bg.replace('+', ''),
  parts: bg.split('+'),
  weightedFreq: Math.round(freq * 10) / 10,
}));

// 4. 人称代词统计
const pronouns = { '我': 0, '你': 0, '他': 0, '她': 0, '我们': 0, '大家': 0, '他们': 0, '咱': 0, '咱们': 0 };
for (const [w, freq] of wordFreq) {
  if (w in pronouns) pronouns[w] = Math.round(freq);
}
const totalPronouns = Object.values(pronouns).reduce((a, b) => a + b, 0);
const pronounRatios = {};
for (const [p, cnt] of Object.entries(pronouns)) {
  pronounRatios[p] = `${(cnt / totalPronouns * 100).toFixed(1)}%`;
}

// 5. 标点统计
const punctuation = {};
const punctMarks = ['。', '，', '！', '？', '；', '：', '…', '——', '—', '、', '"', '"', '（', '）'];
for (const mark of punctMarks) {
  let count = 0;
  for (const article of corpus) {
    const matches = article.body.match(new RegExp(mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    count += (matches?.length || 0) * (article.timeWeight || 1);
  }
  punctuation[mark] = {
    total: Math.round(count),
    per1000chars: Math.round(count / totalChars * 10000) / 10,
  };
}

// 6. 语气词/口头禅（特征性功能词）
const colloquials = [
  '其实', '说白了', '说实话', '简单说', '换句话', '反正', '总之', '当然',
  '毕竟', '说到底', '坦白说', '至少', '显然', '果然', '居然', '竟然',
  '无非', '不过', '倒是', '话说', '但凡', '甭管', '甭说', '别提',
  '索性', '干脆', '到头来', '压根', '死活', '好歹', '怎么说', '凭什么',
  '理所当然', '想当然', '回过头', '归根结底', '一句话',
  '有意思', '扯淡', '靠谱', '不靠谱', '吹牛', '瞎说', '没辙',
];
const colloquialFreq = {};
for (const c of colloquials) {
  let count = 0;
  for (const article of corpus) {
    const matches = article.body.match(new RegExp(c, 'g'));
    count += (matches?.length || 0) * (article.timeWeight || 1);
  }
  if (count > 0) {
    colloquialFreq[c] = {
      total: Math.round(count),
      per1000chars: Math.round(count / totalChars * 10000) / 10,
    };
  }
}
// 按频率排序
const sortedColloquials = Object.entries(colloquialFreq).sort((a, b) => b[1].total - a[1].total);

log(`[L1] 高频词 top 10: ${topWords.slice(0, 10).map(w => w.word).join('、')}`);
log(`[L1] 人称分布: ${Object.entries(pronounRatios).map(([p, r]) => `${p}:${r}`).join(' ')}`);
log(`[L1] 口语词 top 10: ${sortedColloquials.slice(0, 10).map(([w]) => w).join('、')}`);

// 7. AI 八股检测（反向禁令）
// AI 最常用但人类作者往往不用的表达——用于构建 forbidden_patterns
const AI_CLICHES = [
  // 过渡八股
  '总而言之', '综上所述', '值得一提的是', '不得不说', '众所周知',
  '毋庸置疑', '不可否认', '毫无疑问', '显而易见', '由此可见',
  '换言之', '简而言之', '总的来说', '归根到底',
  // 强调八股
  '非常重要的是', '关键在于', '核心问题是', '本质上来说',
  '从某种意义上说', '从根本上说', '在很大程度上',
  // 让步八股
  '诚然', '固然', '尽管如此', '话虽如此',
  // 结尾八股
  '让我们拭目以待', '未来可期', '任重道远', '道阻且长',
  '希望本文能够', '以上就是', '感谢阅读',
  // 情感八股
  '令人惊叹', '令人深思', '发人深省', '引人深思', '耐人寻味',
  '不禁让人', '让人不禁',
  // 修辞八股
  '就像一把双刃剑', '是一个硬币的两面', '站在巨人的肩膀上',
  '打开了潘多拉的盒子', '是一片蓝海',
];

const aiClicheFreq = {};
let authorAvoidsCount = 0;
let authorUsesCount = 0;

for (const cliche of AI_CLICHES) {
  let count = 0;
  for (const article of corpus) {
    const escaped = cliche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = article.body.match(new RegExp(escaped, 'g'));
    count += (matches?.length || 0);
  }
  aiClicheFreq[cliche] = {
    totalOccurrences: count,
    per1000chars: Math.round(count / totalChars * 10000) / 10,
    status: count === 0 ? 'never' : count <= 2 ? 'rare' : 'used',
  };
  if (count === 0) authorAvoidsCount++;
  else authorUsesCount++;
}

// 分类汇总
const aiForbidden = Object.entries(aiClicheFreq)
  .filter(([, v]) => v.status === 'never')
  .map(([word]) => word);
const aiRare = Object.entries(aiClicheFreq)
  .filter(([, v]) => v.status === 'rare')
  .map(([word]) => word);
const aiActuallyUsed = Object.entries(aiClicheFreq)
  .filter(([, v]) => v.status === 'used')
  .map(([word, v]) => ({ word, count: v.totalOccurrences }));

log(`[L1] AI 八股：${authorAvoidsCount} 个从不使用，${aiRare.length} 个极少使用，${authorUsesCount} 个偶有使用`);

// ══════════════════════════════════════
//  L2: 句法签名
// ══════════════════════════════════════
log('\n═══ L2: 句法签名 ═══');

const allSentenceLengths = [];
const allParagraphLengths = [];
const allParagraphSentCounts = [];
const openingSentences = []; // 每篇的首句
const closingSentences = []; // 每篇的末句
const sentenceLengthSequences = []; // 每篇的句长序列（用于模式分析）

for (const article of corpus) {
  const body = article.body;

  // 分句
  const sentences = body.split(/[。！？；\n]+/).filter(s => s.trim().length > 0);
  const sentLengths = sentences.map(s => s.trim().length);
  allSentenceLengths.push(...sentLengths);

  if (sentLengths.length >= 3) {
    sentenceLengthSequences.push({
      weight: article.timeWeight || 1,
      lengths: sentLengths,
    });
  }

  // 首句末句
  if (sentences.length > 0) {
    openingSentences.push({ text: sentences[0].trim().slice(0, 60), weight: article.timeWeight || 1 });
  }
  if (sentences.length > 1) {
    closingSentences.push({ text: sentences[sentences.length - 1].trim().slice(0, 60), weight: article.timeWeight || 1 });
  }

  // 分段
  const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 0);
  for (const p of paragraphs) {
    allParagraphLengths.push(p.trim().length);
    const pSents = p.split(/[。！？]+/).filter(s => s.trim().length > 0);
    allParagraphSentCounts.push(pSents.length);
  }
}

// 句长统计
function computeStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const median = sorted[Math.floor(n / 2)];
  const p10 = sorted[Math.floor(n * 0.1)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];
  const p90 = sorted[Math.floor(n * 0.9)];
  return {
    count: n,
    mean: Math.round(mean * 10) / 10,
    std: Math.round(std * 10) / 10,
    median,
    p10, p25, p75, p90,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

const sentenceStats = computeStats(allSentenceLengths);
const paragraphStats = computeStats(allParagraphLengths);
const paraSentStats = computeStats(allParagraphSentCounts);

log(`[L2] 句长: μ=${sentenceStats.mean} σ=${sentenceStats.std} 中位=${sentenceStats.median}`);
log(`[L2] 段长: μ=${paragraphStats.mean} σ=${paragraphStats.std}`);
log(`[L2] 每段句数: μ=${paraSentStats.mean} 中位=${paraSentStats.median}`);

// 句长节奏模式分析
// 将句子分为短(S)、中(M)、长(L)，统计 3-gram 模式
function categorizeSentLength(len, mean, std) {
  if (len < mean - std * 0.5) return 'S';
  if (len > mean + std * 0.5) return 'L';
  return 'M';
}

const rhythmPatterns = new Map();
for (const seq of sentenceLengthSequences) {
  const cats = seq.lengths.map(l => categorizeSentLength(l, sentenceStats.mean, sentenceStats.std));
  for (let i = 0; i < cats.length - 2; i++) {
    const pattern = `${cats[i]}-${cats[i + 1]}-${cats[i + 2]}`;
    rhythmPatterns.set(pattern, (rhythmPatterns.get(pattern) || 0) + seq.weight);
  }
}
const sortedRhythms = [...rhythmPatterns.entries()].sort((a, b) => b[1] - a[1]);
const topRhythms = sortedRhythms.slice(0, 15).map(([pattern, freq]) => ({
  pattern,
  freq: Math.round(freq),
  pct: `${(freq / sortedRhythms.reduce((a, [, f]) => a + f, 0) * 100).toFixed(1)}%`,
}));

log(`[L2] 节奏 top 5: ${topRhythms.slice(0, 5).map(r => `${r.pattern}(${r.pct})`).join(' ')}`);

// 段间过渡分析
const transitionWords = {
  '但': 0, '但是': 0, '不过': 0, '然而': 0, '可是': 0, // 转折
  '所以': 0, '因此': 0, '于是': 0, '结果': 0,           // 因果
  '而且': 0, '同时': 0, '另外': 0, '此外': 0,           // 递进
  '比如': 0, '例如': 0, '就像': 0,                       // 举例
  '后来': 0, '接着': 0, '然后': 0, '最后': 0,             // 时序
};
// 统计段首出现的过渡词
for (const article of corpus) {
  const paragraphs = article.body.split(/\n\n+/).filter(p => p.trim().length > 0);
  for (let i = 1; i < paragraphs.length; i++) {
    const firstChars = paragraphs[i].trim().slice(0, 10);
    for (const tw of Object.keys(transitionWords)) {
      if (firstChars.startsWith(tw)) {
        transitionWords[tw] += (article.timeWeight || 1);
      }
    }
  }
}
// 分类汇总
const transitionCategories = {
  contrast: ['但', '但是', '不过', '然而', '可是'],
  causal: ['所以', '因此', '于是', '结果'],
  additive: ['而且', '同时', '另外', '此外'],
  example: ['比如', '例如', '就像'],
  temporal: ['后来', '接着', '然后', '最后'],
};
const transitionSummary = {};
let totalTransitions = 0;
for (const [cat, words] of Object.entries(transitionCategories)) {
  const sum = words.reduce((a, w) => a + (transitionWords[w] || 0), 0);
  transitionSummary[cat] = Math.round(sum);
  totalTransitions += sum;
}
// 无过渡词的段落 = 硬切
const totalParagraphTransitions = corpus.reduce((a, article) => {
  return a + article.body.split(/\n\n+/).filter(p => p.trim().length > 0).length - 1;
}, 0);
transitionSummary.hard_cut = totalParagraphTransitions - totalTransitions;

const transitionRatios = {};
for (const [cat, cnt] of Object.entries(transitionSummary)) {
  transitionRatios[cat] = `${(cnt / totalParagraphTransitions * 100).toFixed(1)}%`;
}

log(`[L2] 段间过渡: ${Object.entries(transitionRatios).map(([c, r]) => `${c}:${r}`).join(' ')}`);

// ══════════════════════════════════════
//  组装输出
// ══════════════════════════════════════
const profile = {
  meta: {
    analyzedAt: new Date().toISOString(),
    articlesAnalyzed: corpus.length,
    totalChars,
    totalWords,
  },
  L1_lexical: {
    topWords: topWords.slice(0, 100),
    topBigrams: topBigrams.slice(0, 50),
    pronounDistribution: pronounRatios,
    pronounCounts: pronouns,
    punctuation,
    colloquials: Object.fromEntries(sortedColloquials.slice(0, 30)),
    aiClicheAnalysis: {
      forbidden: aiForbidden,
      rare: aiRare,
      actuallyUsed: aiActuallyUsed,
      avoidanceRate: `${(authorAvoidsCount / AI_CLICHES.length * 100).toFixed(0)}%`,
    },
  },
  L2_syntactic: {
    sentenceLength: sentenceStats,
    paragraphLength: paragraphStats,
    sentencesPerParagraph: paraSentStats,
    rhythmPatterns: topRhythms,
    transitionTypes: transitionRatios,
    transitionCounts: transitionSummary,
  },
  // 用于 Phase 3 采样参考的开头/结尾句
  _samples: verbose ? {
    openings: openingSentences.slice(0, 30),
    closings: closingSentences.slice(0, 30),
  } : undefined,
};

// 清理 undefined
const cleanProfile = JSON.parse(JSON.stringify(profile));

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cleanProfile, null, 2));
log(`\n✅ 计算分析完成 → ${OUTPUT_PATH}`);

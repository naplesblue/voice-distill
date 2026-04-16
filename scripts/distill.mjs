#!/usr/bin/env node
/**
 * distill.mjs — 一键蒸馏入口
 *
 * 用法：
 *   node scripts/distill.mjs ./my-articles/          # 从 Markdown 文件夹蒸馏
 *   node scripts/distill.mjs --bear                   # 从 Bear (熊掌记) 蒸馏
 *   node scripts/distill.mjs ./articles/ --sample 30  # 改 LLM 抽样数
 *   node scripts/distill.mjs ./articles/ --skip-llm   # 只做计算分析，不调 LLM
 *   node scripts/distill.mjs --resume                 # 从上次中断处继续 LLM 分析
 */
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

function log(msg) { console.error(msg); }

// ── CLI ──
const args = process.argv.slice(2);
const useBear = args.includes('--bear');
const skipLLM = args.includes('--skip-llm');
const resume = args.includes('--resume');
const sampleIdx = args.indexOf('--sample');
const sampleN = sampleIdx >= 0 ? args[sampleIdx + 1] : '60';
const authorIdx = args.indexOf('--author');
const AUTHOR = authorIdx >= 0 ? args[authorIdx + 1] : 'voice';
const authorArgs = AUTHOR !== 'voice' ? ['--author', AUTHOR] : [];
const inputPath = args.find(a => !a.startsWith('-') && a !== sampleN && a !== AUTHOR);

if (useBear && AUTHOR !== 'voice') {
  log('[ERROR] --bear 只能用于自己的语料，不能与 --author 同时使用');
  process.exit(1);
}

if (!useBear && !inputPath && !resume) {
  log(`
voice-distill — 从你的文章中提取写作指纹

用法：
  node scripts/distill.mjs ./my-articles/                          # 从 Markdown/TXT 文件夹
  node scripts/distill.mjs --bear                                  # 从 Bear (熊掌记)
  node scripts/distill.mjs ./wangxiaobo/ --author wangxiaobo       # 分析外部作家
  node scripts/distill.mjs ./articles/ --sample 30                 # 改 LLM 抽样数
  node scripts/distill.mjs ./articles/ --skip-llm                  # 只做计算分析
  node scripts/distill.mjs --resume                                # 从上次中断处继续

环境变量：
  LLM_API_KEY     API Key（必须，支持 DashScope / OpenAI 兼容接口）
  LLM_BASE_URL    API 地址（默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
  LLM_MODEL       模型名（默认 qwen-plus）
`);
  process.exit(1);
}

function run(script, extraArgs = []) {
  const scriptPath = path.join(ROOT, 'scripts', script);
  execFileSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
}

log('');
log('╔══════════════════════════════════════╗');
log('║     voice-distill — 写作指纹蒸馏     ║');
log('╚══════════════════════════════════════╝');
log('');

try {
  // Phase 1: 数据导入
  if (!resume) {
    if (useBear) {
      log('▸ Phase 1: 从 Bear (熊掌记) 导入...\n');
      run('export_bear.mjs');
    } else if (inputPath) {
      log(`▸ Phase 1: 从 ${inputPath} 导入${AUTHOR !== 'voice' ? ` (作者: ${AUTHOR})` : ''}...\n`);
      run('import_folder.mjs', [inputPath, ...authorArgs]);
    }
    log('');

    // Phase 2: 计算分析
    log('▸ Phase 2: 词汇指纹 + 句法签名（零 LLM）...\n');
    run('distill_compute.mjs', authorArgs);
    log('');
  }

  if (skipLLM) {
    log('▸ 跳过 LLM 分析 (--skip-llm)\n');
    log('✅ 计算分析完成。LLM 分析可稍后运行：');
    log('   node scripts/distill_llm.mjs');
    log('   node scripts/distill_synthesize.mjs');
    process.exit(0);
  }

  // Phase 3: LLM 深度分析
  log('▸ Phase 3: LLM 深度分析（修辞 + 思维 + 语气）...\n');
  const llmArgs = ['--sample', sampleN, ...authorArgs];
  if (resume) llmArgs.push('--resume');
  run('distill_llm.mjs', llmArgs);
  log('');

  // Phase 4: 合成
  log('▸ Phase 4: 合成 Voice Profile...\n');
  run('distill_synthesize.mjs', authorArgs);
  log('');

  log('╔══════════════════════════════════════╗');
  log('║           ✅ 蒸馏完成！              ║');
  log('╚══════════════════════════════════════╝');
  log('');
  log(`  Profile:   ${path.join(ROOT, 'voice-profile.json')}`);
  log(`  Exemplars: ${path.join(ROOT, 'voice-exemplars.md')}`);
  log('');
} catch (e) {
  log(`\n[FATAL] ${e.message}`);
  process.exit(1);
}

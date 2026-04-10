/**
 * env.mjs — 环境变量加载 + LLM 配置
 *
 * 支持两种配置方式：
 * 1. LLM_API_KEY + LLM_BASE_URL + LLM_MODEL（通用）
 * 2. DASHSCOPE_API_KEY（兼容 DashScope）
 * 3. OPENAI_API_KEY（兼容 OpenAI）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');

if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// ── LLM 配置标准化 ──
// 优先级: LLM_API_KEY > DASHSCOPE_API_KEY > OPENAI_API_KEY
if (!process.env.LLM_API_KEY) {
  if (process.env.DASHSCOPE_API_KEY) {
    process.env.LLM_API_KEY = process.env.DASHSCOPE_API_KEY;
    if (!process.env.LLM_BASE_URL) {
      process.env.LLM_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    }
    if (!process.env.LLM_MODEL) {
      process.env.LLM_MODEL = process.env.DASHSCOPE_MODEL_FAST || 'qwen-plus';
    }
    if (!process.env.LLM_MODEL_STRONG) {
      process.env.LLM_MODEL_STRONG = process.env.DASHSCOPE_MODEL_STRONG || 'qwen3-max';
    }
  } else if (process.env.OPENAI_API_KEY) {
    process.env.LLM_API_KEY = process.env.OPENAI_API_KEY;
    if (!process.env.LLM_BASE_URL) {
      process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    }
    if (!process.env.LLM_MODEL) {
      process.env.LLM_MODEL = 'gpt-4o-mini';
    }
    if (!process.env.LLM_MODEL_STRONG) {
      process.env.LLM_MODEL_STRONG = 'gpt-4o';
    }
  }
}

// 默认值
if (!process.env.LLM_BASE_URL) {
  process.env.LLM_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
}
if (!process.env.LLM_MODEL) {
  process.env.LLM_MODEL = 'qwen-plus';
}
if (!process.env.LLM_MODEL_STRONG) {
  process.env.LLM_MODEL_STRONG = process.env.LLM_MODEL;
}

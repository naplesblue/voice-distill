#!/usr/bin/env node
/**
 * import_folder.mjs — 从 Markdown/TXT 文件夹导入文章
 *
 * 支持 .md, .txt, .markdown 文件
 * 递归扫描子目录
 *
 * 用法：
 *   node scripts/import_folder.mjs ./my-articles/
 *   node scripts/import_folder.mjs ./my-articles/ --min-chars 300
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUPPORTED_EXT = new Set(['.md', '.txt', '.markdown', '.text']);

// ── CLI ──
const args = process.argv.slice(2);
const authorIdx = args.indexOf('--author');
const AUTHOR = authorIdx >= 0 ? args[authorIdx + 1] : 'voice';
const OUTPUT_DIR = path.join(ROOT, 'sources', AUTHOR);
const minCharsIdx = args.indexOf('--min-chars');
const MIN_CHARS = minCharsIdx >= 0 ? parseInt(args[minCharsIdx + 1], 10) : 500;
const inputDir = args.find(a => !a.startsWith('-') && !(minCharsIdx >= 0 && args[minCharsIdx + 1] === a) && !(authorIdx >= 0 && args[authorIdx + 1] === a));

if (!inputDir || !fs.existsSync(inputDir)) {
  console.error('用法: node scripts/import_folder.mjs <文件夹路径> [--min-chars N]');
  process.exit(1);
}

function log(msg) { console.error(msg); }

// ── 递归收集文件 ──
function collectFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过隐藏目录和 node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...collectFiles(fullPath));
    } else if (SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Markdown 清洗 ──
function cleanMarkdown(text) {
  let s = text;
  // 去掉 YAML front matter
  s = s.replace(/^---\n[\s\S]*?\n---\n/, '');
  // 去掉图片 ![](...)
  s = s.replace(/!\[.*?\]\(.*?\)/g, '');
  // 去掉链接，保留文字 [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 去掉 HTML 标签
  s = s.replace(/<[^>]+>/g, '');
  // 去掉多余空行
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ── 提取标题 ──
function extractTitle(text, filename) {
  // 优先取第一个 # 标题
  const match = text.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  // 否则用文件名
  return path.basename(filename, path.extname(filename));
}

// ── Main ──
const files = collectFiles(path.resolve(inputDir));
log(`[Import] 扫描 ${inputDir} → ${files.length} 个文件`);

const articles = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf-8');
  const title = extractTitle(raw, file);
  // 去掉标题行（如果第一行是 # 开头）
  const bodyRaw = raw.replace(/^#\s+.+\n+/, '');
  const body = cleanMarkdown(bodyRaw);

  if (body.length < MIN_CHARS) continue;

  // 尝试从文件修改时间获取时间信息
  const stat = fs.statSync(file);
  const createdAt = stat.birthtime.toISOString();
  const modifiedAt = stat.mtime.toISOString();

  // 时间权重：近 2 年 1.0，2-4 年 0.7，4-6 年 0.5，6+ 年 0.3
  const ageYears = (Date.now() - stat.mtime.getTime()) / (365.25 * 24 * 3600 * 1000);
  let timeWeight = 0.3;
  if (ageYears <= 2) timeWeight = 1.0;
  else if (ageYears <= 4) timeWeight = 0.7;
  else if (ageYears <= 6) timeWeight = 0.5;

  articles.push({
    id: `file-${articles.length}`,
    title,
    body,
    charCount: body.length,
    createdAt,
    modifiedAt,
    timeWeight,
    sourcePath: path.relative(path.resolve(inputDir), file),
  });
}

log(`[Import] 过滤后保留 ${articles.length} 篇 (>= ${MIN_CHARS} 字)`);

// 长度分布
const buckets = { short: 0, medium: 0, long: 0, extra: 0 };
for (const a of articles) {
  if (a.charCount < 500) buckets.short++;
  else if (a.charCount < 1500) buckets.medium++;
  else if (a.charCount < 3000) buckets.long++;
  else buckets.extra++;
}
log(`[Import] 分布: 短${buckets.short} 中${buckets.medium} 长${buckets.long} 超长${buckets.extra}`);

// 导出
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const corpusPath = path.join(OUTPUT_DIR, 'corpus.json');
fs.writeFileSync(corpusPath, JSON.stringify(articles, null, 2));
log(`[Import] → ${corpusPath} (${(fs.statSync(corpusPath).size / 1024 / 1024).toFixed(1)} MB)`);

const manifest = {
  exportedAt: new Date().toISOString(),
  source: `Folder: ${path.resolve(inputDir)}`,
  total: articles.length,
  minChars: MIN_CHARS,
  buckets,
  corpusFile: 'corpus.json',
};
fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

log(`\n✅ 导入完成: ${articles.length} 篇 → ${OUTPUT_DIR}`);

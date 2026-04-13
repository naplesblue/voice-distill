#!/usr/bin/env node
/**
 * export_bear.mjs — 从 Bear (熊掌记) 导出文章用于 Voice Distillation
 *
 * 用法：
 *   node scripts/export_bear.mjs                    # 导出到 sources/voice/
 *   node scripts/export_bear.mjs --min-chars 800    # 最低字数门槛
 *   node scripts/export_bear.mjs --stats             # 只输出统计，不导出
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const BEAR_DB = path.join(
  process.env.HOME,
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
);
const OUTPUT_DIR = path.join(ROOT, 'sources', 'voice');

// ── CLI ──
const args = process.argv.slice(2);
const statsOnly = args.includes('--stats');
const minCharsIdx = args.indexOf('--min-chars');
const MIN_CHARS = minCharsIdx >= 0 ? parseInt(args[minCharsIdx + 1], 10) : 500;

// ── Bear Markdown 清洗 ──
function cleanBearMarkdown(text) {
  let s = text;
  // 去掉第一行的标题（Bear 会把标题也放在 ZTEXT 里）
  s = s.replace(/^# .+\n+/, '');
  // 去掉公众号摘要（标题下的第一行通常是文章摘要，不是正文）
  s = s.replace(/^[^\n]+\n+/, '');
  // 去掉 Bear 标签 #tag# 和 #tag/subtag#
  s = s.replace(/#[^\s#]+#/g, '');
  // 去掉图片 ![](...)
  s = s.replace(/!\[.*?\]\(.*?\)/g, '');
  // 去掉 Bear 文件附件 [file:...]
  s = s.replace(/\[file:.*?\]/g, '');
  // 去掉 Markdown 链接，保留文字 [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 去掉多余空行（3+ 连续换行 → 2 个）
  s = s.replace(/\n{3,}/g, '\n\n');
  // 去掉行首尾空白
  s = s.trim();
  return s;
}

// ── Core Data timestamp → ISO string ──
// Core Data 使用 2001-01-01 00:00:00 UTC 为纪元
function coreDataToISO(timestamp) {
  if (!timestamp) return null;
  const CORE_DATA_EPOCH = new Date('2001-01-01T00:00:00Z').getTime();
  return new Date(CORE_DATA_EPOCH + timestamp * 1000).toISOString();
}

// ── Main ──
function main() {
  if (!fs.existsSync(BEAR_DB)) {
    console.error(`[ERROR] Bear 数据库不存在: ${BEAR_DB}`);
    process.exit(1);
  }

  const db = new Database(BEAR_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT Z_PK, ZTITLE, ZTEXT, ZCREATIONDATE, ZMODIFICATIONDATE, LENGTH(ZTEXT) as charCount
    FROM ZSFNOTE
    WHERE ZTRASHED = 0 AND ZTEXT IS NOT NULL AND LENGTH(ZTEXT) > ?
    ORDER BY ZCREATIONDATE DESC
  `).all(MIN_CHARS);
  db.close();

  console.error(`[Bear] 读取 ${rows.length} 篇文章 (>= ${MIN_CHARS} 字)`);

  // 计算时间范围
  const dates = rows
    .map(r => coreDataToISO(r.ZCREATIONDATE))
    .filter(Boolean)
    .sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  console.error(`[Bear] 时间范围: ${earliest?.slice(0, 10)} → ${latest?.slice(0, 10)}`);

  // 清洗并构建文章列表
  const articles = rows.map((r, i) => {
    const body = cleanBearMarkdown(r.ZTEXT || '');
    const createdAt = coreDataToISO(r.ZCREATIONDATE);
    const modifiedAt = coreDataToISO(r.ZMODIFICATIONDATE);

    // 时间权重：近 2 年权重 1.0，2-4 年 0.7，4-6 年 0.5，6+ 年 0.3
    const now = Date.now();
    const ageYears = createdAt
      ? (now - new Date(createdAt).getTime()) / (365.25 * 24 * 3600 * 1000)
      : 99;
    let timeWeight = 0.3;
    if (ageYears <= 2) timeWeight = 1.0;
    else if (ageYears <= 4) timeWeight = 0.7;
    else if (ageYears <= 6) timeWeight = 0.5;

    return {
      id: `bear-${r.Z_PK}`,
      title: r.ZTITLE || '(无标题)',
      body,
      charCount: body.length,
      createdAt,
      modifiedAt,
      timeWeight,
    };
  }).filter(a => a.charCount >= MIN_CHARS); // 清洗后再过滤一次

  console.error(`[Bear] 清洗后保留 ${articles.length} 篇`);

  // 长度分档统计
  const buckets = { short: 0, medium: 0, long: 0, extra: 0 };
  for (const a of articles) {
    if (a.charCount < 500) buckets.short++;
    else if (a.charCount < 1500) buckets.medium++;
    else if (a.charCount < 3000) buckets.long++;
    else buckets.extra++;
  }
  console.error(`[Bear] 分布: 短${buckets.short} 中${buckets.medium} 长${buckets.long} 超长${buckets.extra}`);

  // 时间分布
  const yearBuckets = {};
  for (const a of articles) {
    const year = a.createdAt?.slice(0, 4) || '?';
    yearBuckets[year] = (yearBuckets[year] || 0) + 1;
  }
  console.error(`[Bear] 年份: ${Object.entries(yearBuckets).map(([y, n]) => `${y}:${n}`).join(' ')}`);

  if (statsOnly) {
    console.log(JSON.stringify({ total: articles.length, buckets, yearBuckets, earliest, latest }, null, 2));
    return;
  }

  // 导出
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 单篇文件（只导出 manifest，不单独写文件——太多了）
  // 全量数据写入一个 corpus 文件
  const corpusPath = path.join(OUTPUT_DIR, 'corpus.json');
  fs.writeFileSync(corpusPath, JSON.stringify(articles, null, 2));
  console.error(`[Bear] → ${corpusPath} (${(fs.statSync(corpusPath).size / 1024 / 1024).toFixed(1)} MB)`);

  // Manifest
  const manifest = {
    exportedAt: new Date().toISOString(),
    source: 'Bear (熊掌记)',
    database: BEAR_DB,
    total: articles.length,
    minChars: MIN_CHARS,
    buckets,
    yearBuckets,
    timeRange: { earliest, latest },
    corpusFile: 'corpus.json',
  };
  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.error(`[Bear] → ${manifestPath}`);

  console.error(`\n✅ 导出完成: ${articles.length} 篇 → ${OUTPUT_DIR}`);
}

main();

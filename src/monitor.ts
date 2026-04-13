// monitor.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import "dotenv/config";

import { fetchMockListings } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";
import { loadRules, buildFilterPrompt, applyHardFilters } from "./rules.js";
import { filterListing, MODEL } from "./filter.js";
import { notify, notifyDailyReport } from "./notify.js";

const USE_REAL_DATA = true;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "300000");
const CACHE_DIR = join(process.cwd(), ".cache");
const SEEN_FILE = join(CACHE_DIR, "seen_items.json");
const STATS_FILE = join(CACHE_DIR, "daily_stats.json");
const SEEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;   // seen 记录 7 天过期
const FRESHNESS_MS = 24 * 60 * 60 * 1000;           // 只通知 24 小时内发布的商品
const REPORT_HOUR = 22;                              // 每天 22:00 推送日报

// ─── 日报统计类型 ─────────────────────────────────────────────────────

export interface MatchedItem {
  title: string;
  price: number;
  url: string;
  reason: string;
}

export interface DailyStats {
  date: string;                  // "2026-04-13"
  checkCount: number;
  totalFetched: number;
  newCount: number;
  matchCount: number;
  skipReasons: {
    noPublishTime: number;
    notFresh: number;
    hardFilter: number;
    llmReject: number;
  };
  matchedItems: MatchedItem[];
  priceRange: { min: number; max: number } | null;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyStats(date: string): DailyStats {
  return {
    date,
    checkCount: 0,
    totalFetched: 0,
    newCount: 0,
    matchCount: 0,
    skipReasons: { noPublishTime: 0, notFresh: 0, hardFilter: 0, llmReject: 0 },
    matchedItems: [],
    priceRange: null,
  };
}

function loadDailyStats(): DailyStats {
  const today = todayDateStr();
  try {
    if (existsSync(STATS_FILE)) {
      const data = JSON.parse(readFileSync(STATS_FILE, "utf-8")) as DailyStats;
      if (data.date === today) return data;
    }
  } catch {}
  return emptyStats(today);
}

function saveDailyStats(stats: DailyStats): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

/** seen_items.json 格式: { "id": timestamp, ... } */
function loadSeenIds(): Map<string, number> {
  try {
    if (existsSync(SEEN_FILE)) {
      const raw = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));

      // 兼容旧格式（纯数组 → 转为 Map，时间设为 now）
      if (Array.isArray(raw)) {
        const now = Date.now();
        return new Map(raw.map((id: string) => [id, now]));
      }

      // 新格式：对象 { id: timestamp }，加载时清理过期条目
      const now = Date.now();
      const map = new Map<string, number>();
      for (const [id, ts] of Object.entries(raw)) {
        if (now - (ts as number) < SEEN_EXPIRY_MS) {
          map.set(id, ts as number);
        }
      }
      return map;
    }
  } catch {}
  return new Map();
}

function saveSeenIds(ids: Map<string, number>): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const obj: Record<string, number> = {};
  for (const [id, ts] of ids) {
    obj[id] = ts;
  }
  writeFileSync(SEEN_FILE, JSON.stringify(obj, null, 2));
}

async function checkOnce(): Promise<void> {
  const timestamp = new Date().toLocaleString("zh-CN");
  const config = loadRules();
  const systemPrompt = buildFilterPrompt(config);
  const now = Date.now();
  const isFirstRun = !existsSync(SEEN_FILE);

  // 加载当日统计
  const stats = loadDailyStats();
  stats.checkCount++;

  console.log(`\n[${timestamp}] 开始检查...`);

  const listings = USE_REAL_DATA
    ? await fetchRealListings(config.keyword)
    : fetchMockListings();
  console.log(`  获取到 ${listings.length} 条商品`);
  stats.totalFetched += listings.length;

  const seenIds = loadSeenIds();

  // 首次运行：静默建基线，不发通知
  if (isFirstRun) {
    console.log("  首次运行，建立基线（不发送通知）...");
    for (const listing of listings) {
      seenIds.set(listing.id, now);
    }
    saveSeenIds(seenIds);
    saveDailyStats(stats);
    console.log(`  已记录 ${listings.length} 条商品作为基线`);
    return;
  }

  const newListings = listings.filter((item) => !seenIds.has(item.id));
  console.log(`  其中 ${newListings.length} 条是新的`);
  stats.newCount += newListings.length;

  if (newListings.length === 0) {
    console.log("  没有新商品，跳过");
    saveDailyStats(stats);
    return;
  }

  let matchCount = 0;
  for (const listing of newListings) {
    // 无发布时间 → 跳过
    if (!listing.publishTime) {
      console.log(`  ⏭️ 无发布时间，跳过: ${listing.title.slice(0, 30)}...`);
      stats.skipReasons.noPublishTime++;
      seenIds.set(listing.id, now);
      continue;
    }

    // 超过 24 小时 → 跳过
    if (now - listing.publishTime > FRESHNESS_MS) {
      console.log(`  ⏭️ 非近期上新: ${listing.title.slice(0, 30)}...`);
      stats.skipReasons.notFresh++;
      seenIds.set(listing.id, now);
      continue;
    }

    // Hard filters first (price, region)
    const hardResult = applyHardFilters(listing, config.filters);
    if (!hardResult.pass) {
      console.log(`  ⏭️ 硬过滤跳过: ${listing.title.slice(0, 30)}... → ${hardResult.reason}`);
      stats.skipReasons.hardFilter++;
      seenIds.set(listing.id, now);
      continue;
    }

    const result = await filterListing(listing, systemPrompt);

    if (result.match) {
      matchCount++;
      stats.matchCount++;
      stats.matchedItems.push({
        title: listing.title,
        price: listing.price,
        url: listing.url,
        reason: result.reason,
      });
      // 更新价格区间
      if (!stats.priceRange) {
        stats.priceRange = { min: listing.price, max: listing.price };
      } else {
        stats.priceRange.min = Math.min(stats.priceRange.min, listing.price);
        stats.priceRange.max = Math.max(stats.priceRange.max, listing.price);
      }
      await notify(listing, result.reason);
    } else {
      stats.skipReasons.llmReject++;
    }

    seenIds.set(listing.id, now);
  }

  saveSeenIds(seenIds);
  saveDailyStats(stats);
  console.log(`  本轮完成: ${matchCount} 条命中, ${newListings.length - matchCount} 条跳过`);
}

export async function runMonitor(): Promise<void> {
  const config = loadRules();

  console.log("========================================");
  console.log("  闲鱼商品监控 Agent");
  console.log("========================================");
  console.log(`  关键词: ${config.keyword}`);
  console.log(`  模型: ${MODEL}`);
  console.log(`  间隔: ${CHECK_INTERVAL / 1000}s`);
  console.log(`  规则: ${config.rules.length} 条`);
  console.log(`  日报: 每天 ${REPORT_HOUR}:00 推送`);
  console.log(`  数据源: ${USE_REAL_DATA ? "闲鱼真实数据（Puppeteer）" : "mock（开发模式）"}`);
  console.log("========================================");

  process.on("SIGINT", async () => {
    console.log("\n正在关闭浏览器...");
    await closeBrowser();
    process.exit(0);
  });

  await checkOnce();

  console.log(`\n定时监控已启动，每 ${CHECK_INTERVAL / 1000} 秒检查一次...`);
  console.log("按 Ctrl+C 退出\n");
  setInterval(checkOnce, CHECK_INTERVAL);

  // 日报定时检查：每 60 秒看一次是否到推送时间
  let lastReportDate = "";
  setInterval(async () => {
    const now = new Date();
    const today = todayDateStr();
    if (now.getHours() === REPORT_HOUR && lastReportDate !== today) {
      lastReportDate = today;
      const stats = loadDailyStats();
      console.log(`\n[${now.toLocaleString("zh-CN")}] 推送每日监控日报...`);
      await notifyDailyReport(stats);
      // 重置统计
      saveDailyStats(emptyStats(today));
      console.log("  日报已推送，统计已重置");
    }
  }, 60_000);
}

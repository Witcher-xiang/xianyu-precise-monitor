// monitor.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import "dotenv/config";

import { fetchMockListings, type Listing } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";
import { loadRules, buildFilterPrompt, applyHardFilters } from "./rules.js";
import { filterListing, MODEL } from "./filter.js";
import { notify } from "./notify.js";

const USE_REAL_DATA = true;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "300000");
const CACHE_DIR = join(process.cwd(), ".cache");
const SEEN_FILE = join(CACHE_DIR, "seen_items.json");

function loadSeenIds(): Set<string> {
  try {
    if (existsSync(SEEN_FILE)) {
      const data = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
      return new Set(data);
    }
  } catch {}
  return new Set();
}

function saveSeenIds(ids: Set<string>): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...ids], null, 2));
}

async function checkOnce(): Promise<void> {
  const timestamp = new Date().toLocaleString("zh-CN");
  const config = loadRules();
  const systemPrompt = buildFilterPrompt(config);

  console.log(`\n[${timestamp}] 开始检查...`);

  const listings = USE_REAL_DATA
    ? await fetchRealListings(config.keyword)
    : fetchMockListings();
  console.log(`  获取到 ${listings.length} 条商品`);

  const seenIds = loadSeenIds();
  const newListings = listings.filter((item) => !seenIds.has(item.id));
  console.log(`  其中 ${newListings.length} 条是新的`);

  if (newListings.length === 0) {
    console.log("  没有新商品，跳过");
    return;
  }

  let matchCount = 0;
  for (const listing of newListings) {
    // Hard filters first (price, region)
    const hardResult = applyHardFilters(listing, config.filters);
    if (!hardResult.pass) {
      console.log(`  ⏭️ 硬过滤跳过: ${listing.title.slice(0, 30)}... → ${hardResult.reason}`);
      seenIds.add(listing.id);
      continue;
    }

    const result = await filterListing(listing, systemPrompt);

    if (result.match) {
      matchCount++;
      await notify(listing, result.reason);
    }

    seenIds.add(listing.id);
  }

  saveSeenIds(seenIds);
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
}

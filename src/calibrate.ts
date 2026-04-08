// calibrate.ts
import * as readline from "readline";
import "dotenv/config";

import { fetchMockListings, type Listing } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";
import {
  loadRules,
  saveRules,
  buildFilterPrompt,
  applyHardFilters,
  type TestCase,
} from "./rules.js";
import { filterListing, optimizeRules, type Correction } from "./filter.js";

const USE_REAL_DATA = true;

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

interface CalibrateItem {
  listing: Listing;
  matched: boolean;
  reason: string;
  hardFiltered: boolean;
  hardReason?: string;
}

export async function runCalibrate(): Promise<void> {
  const config = loadRules();
  const systemPrompt = buildFilterPrompt(config);

  console.log("\n========================================");
  console.log("  规则校准模式");
  console.log("========================================\n");

  // 1. Fetch sample data
  console.log(`🔍 正在抓取"${config.keyword}"的商品数据...`);
  let listings: Listing[];
  try {
    listings = USE_REAL_DATA
      ? await fetchRealListings(config.keyword)
      : fetchMockListings();
  } catch (e: any) {
    console.error(`❌ 抓取失败: ${e.message}`);
    return;
  }

  if (listings.length === 0) {
    console.log("未获取到商品数据，请检查网络或登录状态");
    return;
  }

  console.log(`获取到 ${listings.length} 条商品，用当前规则筛选中...\n`);

  // 2. Filter each listing
  const results: CalibrateItem[] = [];
  for (const listing of listings) {
    const hardResult = applyHardFilters(listing, config.filters);
    if (!hardResult.pass) {
      results.push({
        listing,
        matched: false,
        reason: hardResult.reason!,
        hardFiltered: true,
        hardReason: hardResult.reason,
      });
      continue;
    }

    const filterResult = await filterListing(listing, systemPrompt);
    results.push({
      listing,
      matched: filterResult.match,
      reason: filterResult.reason,
      hardFiltered: false,
    });
  }

  // 3. Display results
  console.log("");
  results.forEach((r, i) => {
    const icon = r.matched ? "✅ 命中" : "❌ 跳过";
    const prefix = r.hardFiltered ? "🔧 硬过滤" : icon;
    const title = r.listing.title.slice(0, 40);
    console.log(
      `  ${i + 1}. ${prefix} | ${title}  ¥${r.listing.price}  → ${r.reason}`
    );
  });

  // 4. User corrections
  const rl = createRL();
  console.log(
    '\n有判断错误的吗？输入序号和原因（如 "1 这个是拼装件不是成品"），输入 done 结束:'
  );

  const corrections: Correction[] = [];
  const correctedIndices: Set<number> = new Set();

  while (true) {
    const input = await ask(rl, "> ");
    if (input.toLowerCase() === "done" || input === "") break;

    const match = input.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      console.log('  格式：序号 + 原因，如 "1 这个是拼装件不是成品" 或 "3 这个应该命中，品牌和比例都对"');
      continue;
    }

    const idx = parseInt(match[1]) - 1;
    if (idx < 0 || idx >= results.length) {
      console.log(`  序号超出范围 (1-${results.length})`);
      continue;
    }

    const r = results[idx];
    const userFeedback = match[2];
    corrections.push({
      title: r.listing.title,
      price: r.listing.price,
      currentResult: r.matched,
      expected: !r.matched,
      reason: r.reason,
      userFeedback,
    });
    correctedIndices.add(idx);
    console.log(
      `  已记录: "${r.listing.title.slice(0, 30)}..." ${r.matched ? "命中→跳过" : "跳过→命中"} | 原因: ${userFeedback}`
    );
  }

  // 5. Save corrected items as test cases
  const newTestCases: TestCase[] = [];
  for (const idx of correctedIndices) {
    const r = results[idx];
    newTestCases.push({
      title: r.listing.title,
      price: String(r.listing.price),
      description: r.listing.description,
      seller: r.listing.seller,
      expectedMatch: !r.matched, // flipped since user said it was wrong
      addedAt: new Date().toISOString().split("T")[0],
    });
  }

  if (corrections.length === 0) {
    console.log("\n✅ 所有判断正确，规则无需调整");
    rl.close();
    if (USE_REAL_DATA) await closeBrowser();
    return;
  }

  // 6. LLM optimize rules
  console.log(`\n📝 已记录 ${corrections.length} 条修正，正在让 LLM 优化规则...`);
  const optimized = await optimizeRules(config.rules, corrections);

  if (optimized.changes.length === 0) {
    console.log("  LLM 未建议修改");
  } else {
    console.log("\nLLM 建议修改：");
    for (const change of optimized.changes) {
      console.log(`  规则 ${change.index + 1}: "${config.rules[change.index] || "(新增)"}"`);
      console.log(`    → "${optimized.rules[change.index]}"`);
      console.log(`    理由: ${change.reason}`);
    }

    const answer = await ask(rl, "\n接受优化？(y/n/手动编辑): ");

    if (answer.toLowerCase() === "y") {
      config.rules = optimized.rules;
      console.log("✅ 规则已更新");
    } else if (answer.toLowerCase() === "n") {
      console.log("⏭️ 保持原规则不变");
    } else {
      // Manual edit mode
      console.log("输入新规则（每行一条，空行结束）:");
      const manualRules: string[] = [];
      while (true) {
        const line = await ask(rl, `  ${manualRules.length + 1}. `);
        if (!line) break;
        manualRules.push(line);
      }
      if (manualRules.length > 0) {
        config.rules = manualRules;
        console.log("✅ 规则已手动更新");
      }
    }
  }

  // 7. Save test cases and rules
  config.testCases = [...config.testCases, ...newTestCases];
  saveRules(config);

  console.log(`✅ ${newTestCases.length} 条修正已加入测试用例（共 ${config.testCases.length} 条）`);

  if (config.testCases.length > 30) {
    console.log(`⚠️ 测试用例已有 ${config.testCases.length} 条，建议清理旧的以节省 token`);
  }

  rl.close();
  if (USE_REAL_DATA) await closeBrowser();
}

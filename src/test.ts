// test.ts
import "dotenv/config";
import {
  loadRules,
  buildFilterPrompt,
  applyHardFilters,
  type TestCase,
} from "./rules.js";
import { filterListing } from "./filter.js";
import type { Listing } from "./mock_data.js";

function testCaseToListing(tc: TestCase): Listing {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: tc.title,
    price: parseFloat(tc.price) || 0,
    description: tc.description,
    seller: tc.seller,
    url: "https://www.goofish.com/item?id=test",
  };
}

export async function runTest(): Promise<void> {
  const config = loadRules();

  console.log("\n========================================");
  console.log("  规则测试模式");
  console.log("========================================\n");

  if (config.testCases.length === 0) {
    console.log("暂无测试用例。运行 npx tsx agent.ts calibrate 可以积累测试用例。");
    return;
  }

  const systemPrompt = buildFilterPrompt(config);
  console.log(`🧪 运行 ${config.testCases.length} 条测试用例...\n`);

  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < config.testCases.length; i++) {
    const tc = config.testCases[i];
    const listing = testCaseToListing(tc);

    // Hard filters
    const hardResult = applyHardFilters(listing, config.filters);
    let actualMatch: boolean;
    let reason: string;

    if (!hardResult.pass) {
      actualMatch = false;
      reason = hardResult.reason!;
    } else {
      const filterResult = await filterListing(listing, systemPrompt);
      actualMatch = filterResult.match;
      reason = filterResult.reason;
    }

    const pass = actualMatch === tc.expectedMatch;
    if (pass) {
      passCount++;
      const expectText = tc.expectedMatch ? "命中" : "跳过";
      console.log(
        `  ${i + 1}. ✅ PASS | ${tc.title.slice(0, 40)} → 期望${expectText}，实际${expectText}`
      );
    } else {
      failCount++;
      const expectText = tc.expectedMatch ? "命中" : "跳过";
      const actualText = actualMatch ? "命中" : "跳过";
      console.log(
        `  ${i + 1}. ❌ FAIL | ${tc.title.slice(0, 40)} → 期望${expectText}，实际${actualText} (${reason})`
      );
    }
  }

  console.log(`\n结果: ${passCount}/${config.testCases.length} 通过，${failCount} 条失败`);

  if (failCount > 0) {
    console.log("\n💡 运行 npx tsx agent.ts calibrate 可以调整规则");
  }
}

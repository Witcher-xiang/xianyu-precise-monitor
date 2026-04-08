// setup.ts
import * as readline from "readline";
import { loadRules, saveRules, type RulesConfig } from "./rules.js";

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

export async function runSetup(): Promise<void> {
  const rl = createRL();
  const existing = loadRules();

  console.log("\n========================================");
  console.log("  商品监控规则配置");
  console.log("========================================\n");

  // Keyword
  const keyword = await ask(rl, `搜索关键词 [${existing.keyword}]: `);
  const finalKeyword = keyword || existing.keyword;

  // Description
  const desc = await ask(
    rl,
    `用一句话描述你想找什么商品${existing.description ? ` [${existing.description}]` : ""}: `
  );
  const finalDesc = desc || existing.description;

  // Rules
  console.log("\n输入筛选规则（每行一条，空行结束）:");
  if (existing.rules.length > 0) {
    console.log("当前规则:");
    existing.rules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    console.log('（直接按回车保留现有规则，或输入新规则覆盖）\n');
  }

  const newRules: string[] = [];
  while (true) {
    const line = await ask(rl, `  ${newRules.length + 1}. `);
    if (!line) break;
    newRules.push(line);
  }
  const finalRules = newRules.length > 0 ? newRules : existing.rules;

  // Filters
  console.log("\n价格和地区过滤（可选）:");

  const minPriceStr = await ask(
    rl,
    `最低价格（留空不限）${existing.filters.minPrice != null ? ` [${existing.filters.minPrice}]` : ""}: `
  );
  const minPrice = minPriceStr
    ? parseFloat(minPriceStr)
    : minPriceStr === "" && existing.filters.minPrice != null
      ? existing.filters.minPrice
      : null;

  const maxPriceStr = await ask(
    rl,
    `最高价格（留空不限）${existing.filters.maxPrice != null ? ` [${existing.filters.maxPrice}]` : ""}: `
  );
  const maxPrice = maxPriceStr
    ? parseFloat(maxPriceStr)
    : maxPriceStr === "" && existing.filters.maxPrice != null
      ? existing.filters.maxPrice
      : null;

  const regionStr = await ask(
    rl,
    `地区过滤（逗号分隔，留空不限）${existing.filters.regions?.length ? ` [${existing.filters.regions.join(",")}]` : ""}: `
  );
  const regions = regionStr
    ? regionStr.split(",").map((s) => s.trim()).filter(Boolean)
    : regionStr === "" && existing.filters.regions?.length
      ? existing.filters.regions
      : [];

  rl.close();

  const config: RulesConfig = {
    keyword: finalKeyword,
    description: finalDesc,
    rules: finalRules,
    filters: { minPrice, maxPrice, regions },
    testCases: existing.testCases, // preserve existing test cases
  };

  saveRules(config);

  console.log("\n✅ 规则已保存到 .cache/rules.json");
  console.log(`  关键词: ${config.keyword}`);
  console.log(`  描述: ${config.description}`);
  console.log(`  规则: ${config.rules.length} 条`);
  if (minPrice != null) console.log(`  最低价: ¥${minPrice}`);
  if (maxPrice != null) console.log(`  最高价: ¥${maxPrice}`);
  if (regions.length > 0) console.log(`  地区: ${regions.join(", ")}`);
  console.log("\n💡 运行 npx tsx agent.ts calibrate 可以抓取样本数据校准规则");
}

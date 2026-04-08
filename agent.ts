#!/usr/bin/env npx tsx
/**
 * agent.ts - 闲鱼商品监控 Agent 入口
 *
 * 子命令：
 *   (无参数)    正常监控模式
 *   setup       交互式配置筛选规则
 *   calibrate   抓取样本数据校准规则
 *   test        运行测试用例回归验证
 */

import "dotenv/config";

const command = process.argv[2];

switch (command) {
  case "setup": {
    const { runSetup } = await import("./src/setup.js");
    await runSetup();
    break;
  }
  case "calibrate": {
    const { runCalibrate } = await import("./src/calibrate.js");
    await runCalibrate();
    break;
  }
  case "test": {
    const { runTest } = await import("./src/test.js");
    await runTest();
    break;
  }
  default: {
    const { runMonitor } = await import("./src/monitor.js");
    await runMonitor();
    break;
  }
}

# 飞鸟轨迹与多器械版本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 严格区分胸部飞鸟轨迹，补全反向飞鸟版本，并让动作库能按肌群和器械找到这些动作。

**Architecture:** 保留“动作—器械版本”两层模型，在动作层按轨迹拆分类群和肌群系数。通过现有迁移入口修正已保存的错误动作—版本组合，搜索只读扩展，不改计划分化模板。

**Tech Stack:** React 19、Vite、Node 原生测试、Playwright。

## Global Constraints

- 不修改训练分化模板。
- 保留现有器械版本 id，避免无谓的数据失效。
- 肌群百分比仍为动作系数的归一化估算。
- Git 提交须获得用户当次确认。

---

### Task 1: 按轨迹拆分动作并迁移旧数据

**Files:**
- Modify: `src/data/exercises.js`
- Modify: `src/engine/planner.js`
- Modify: `src/App.jsx`
- Test: `src/engine/planner.test.js`

**Interfaces:**
- Produces: `high-to-low-fly`、`chest-fly`、`low-cable-fly` 三类拉力线动作，保留水平轨迹的独立动作 `pec-deck-fly`。
- Preserves: `migrateLegacyPlan(plan)`、`migrateLegacyLogs(logs)` 的现有签名。

- [x] 写失败测试：断言高位下夹的 `lowerChest` 为 1，水平夹胸和蝴蝶机夹胸的 `midChest` 为 1，低位上夹的 `upperChest` 为 1；断言 `crossover-fly` 只属于高位下夹。
- [x] 运行 `npm test`，确认因高位下夹动作不存在而失败。
- [x] 在 `exercises.js` 拆分轨迹，设置 `fly: '水平内收（夹胸）'`，让水平飞鸟仅包含 `db-fly`、`cable-fly`，保留独立 `pec-deck-fly`，高位动作包含 `crossover-fly` 与绳索高位版本。
- [x] 在 `migrateLegacyEntry` 中将 `movementId === 'chest-fly' && variantId === 'crossover-fly'` 规范为 `high-to-low-fly`，并在 App 加载 v2 计划与记录时调用现有迁移函数。
- [x] 添加旧组合迁移测试并运行 `npm test`，确认全部通过。

### Task 2: 补全反向飞鸟和动作库搜索

**Files:**
- Modify: `src/data/exercises.js`
- Modify: `src/pages/LibraryPage.jsx`
- Test: `src/engine/planner.test.js`
- Test: `tests/browser-smoke.mjs`

**Interfaces:**
- Consumes: 现有 `reverse-fly`、`rearFly` 和 `getAvailableVariants(movement, equipment, attachments)`。
- Produces: `reverse-pec`、`db-reverse-fly`、`cable-reverse-fly`、`crossover-reverse-fly` 四个版本。

- [x] 写失败测试：断言上述四个版本均属于 `reverse-fly`，且默认器械下均可用，主导肌群仅为 `rearDelt`。
- [x] 运行 `npm test`，确认因版本缺失而失败。
- [x] 添加俯身哑铃、绳索和十字机反向飞鸟，保留蝴蝶机反向版本及后束肌群系数。
- [x] 扩展 `LibraryPage` 搜索文本，拼接主次肌群名、版本名、版本提示及所需器械名。
- [x] 在浏览器测试中加入“后束”和“蝴蝶机”搜索，确认均能找到“反向飞鸟”，打开详情可见“蝴蝶机反向飞鸟”。
- [x] 运行 `npm test` 和 `node tests/browser-smoke.mjs`，确认通过。

### Task 3: 完整回归

**Files:**
- Verify only; 不修改分化模板。

- [x] 运行 `npm test`，确认 0 失败。
- [x] 运行 `npm run build`，确认生产构建成功。
- [x] 运行 `node tests/browser-smoke.mjs`，确认浏览器 0 错误、移动端无横向溢出。
- [x] 检查生成的计划和动作库截图，确认名称与分类清晰。

import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7101', '--strictPort'], { cwd: root, stdio: 'pipe' });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
const errors = [];
try {
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch('http://127.0.0.1:7101')).ok) { ready = true; break; } } catch {}
    await pause(200);
  }
  if (!ready) throw new Error('本机开发服务未启动');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.goto('http://127.0.0.1:7101', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本周训练计划' }).waitFor();
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('form-plans-v1')));
  const draft = async () => { const state = await store(); return state.plans.find((entry) => entry.id === state.activePlanId).draft; };
  const originalId = (await store()).activePlanId;
  const originalOrder = (await draft()).days[0].exercises.map((item) => item.id);

  // Mouse grip drag persists, keyboard grip can restore the original order.
  const source = await page.locator('.drag-handle').first().boundingBox();
  const destination = await page.locator('.drag-handle').last().boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((first) => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises.at(-1).id === first, originalOrder[0]);
  await page.reload({ waitUntil: 'networkidle' });
  if ((await draft()).days[0].exercises.at(-1).id !== originalOrder[0]) throw new Error('拖拽顺序未持久保存');
  const grip = page.locator('.drag-handle').last();
  await grip.focus(); await grip.press('Space');
  for (let i = 1; i < originalOrder.length; i += 1) await grip.press('ArrowUp');
  await grip.press('Enter');
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].id === id, originalOrder[0]);
  if (await page.getByRole('button', { name: '上移', exact: true }).count()) throw new Error('仍显示旧上移按钮');

  // Named plans, immutable versions, preview and restore, duplication and trash.
  await page.getByRole('button', { name: '计划管理', exact: true }).click();
  await page.getByLabel('计划名称').fill('主训练计划');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('新版本备注').fill('动作顺序确认');
  await page.getByRole('button', { name: '保存版本', exact: true }).last().click();
  await page.getByRole('button', { name: '关闭计划管理' }).click();
  const originalSets = (await draft()).days[0].exercises[0].sets;
  await page.locator('.plan-exercise').first().locator('.mini-stepper button').last().click();
  const versionCount = (await store()).plans.find((item) => item.id === originalId).revisions.length;
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: '保存计划版本', exact: true });
  await saveDialog.getByLabel('版本名称／备注').fill('不保存此名称');
  await saveDialog.getByRole('button', { name: '取消', exact: true }).click();
  if ((await store()).plans.find((item) => item.id === originalId).revisions.length !== versionCount) throw new Error('取消命名仍创建了版本');
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  await saveDialog.getByLabel('版本名称／备注').fill('组数调整');
  await saveDialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByRole('button', { name: '计划管理', exact: true }).click();
  await page.getByRole('button', { name: '修改 v3 名称', exact: true }).click();
  await page.getByLabel('v3名称或备注', { exact: true }).fill('组数与休息确认');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.locator('.version-item').filter({ hasText: 'v3 · 组数与休息确认' }).waitFor();
  if ((await store()).plans.find((item) => item.id === originalId).revisions.length !== versionCount + 1) throw new Error('版本改名错误地创建了新版本');
  await page.locator('.version-item').filter({ hasText: 'v2 · 动作顺序确认' }).getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '恢复此版本', exact: true }).click();
  if ((await draft()).days[0].exercises[0].sets !== originalSets) throw new Error('版本恢复未恢复组数');
  await page.getByRole('button', { name: '复制当前计划', exact: true }).click();
  await page.getByLabel('计划名称').fill('出差计划');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('button', { name: '删除当前计划', exact: true }).click();
  if ((await store()).activePlanId !== originalId) throw new Error('删除当前计划未切换');
  await page.locator('.program-trash summary').click();
  await page.locator('.program-trash').getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '新建计划', exact: true }).click();
  if ((await store()).plans.filter((entry) => !entry.deletedAt).length !== 3) throw new Error('新建、复制或恢复计划失败');
  await page.locator('.program-choice').filter({ hasText: '主训练计划' }).click();
  if (await page.getByLabel('计划名称').inputValue() !== '主训练计划') throw new Error('切换计划后名称仍为上一计划');
  await page.screenshot({ path: `${root}/artifacts/versions-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭计划管理' }).click();

  // Delete directly in the library, undo, persist the deletion, restore via management.
  await page.getByRole('button', { name: '我的健身房', exact: true }).click();
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('器械名称（必填）').fill('错误测试器械');
  await page.getByRole('button', { name: '保存器械', exact: true }).click();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByLabel('动作名称（必填）').fill('可删除测试动作');
  await page.getByLabel('所需器械（必选）').selectOption({ label: '错误测试器械' });
  await page.getByRole('button', { name: '保存动作', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '动作库', exact: true }).click();
  await page.getByRole('button', { name: '删除动作可删除测试动作', exact: true }).click();
  if (await page.locator('.library-row-main').filter({ hasText: '可删除测试动作' }).count()) throw new Error('删除后动作仍在动作库');
  await page.getByRole('button', { name: '撤销删除', exact: true }).click();
  await page.getByRole('button', { name: '删除动作可删除测试动作', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除动作可删除测试动作', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '动作库', exact: true }).click();
  if (await page.locator('.library-row-main').filter({ hasText: '可删除测试动作' }).count()) throw new Error('删除未跨刷新保存');
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByRole('button', { name: /已添加/ }).click();
  await page.getByRole('button', { name: '恢复动作', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '删除动作可删除测试动作', exact: true }).waitFor();

  // Logs retain actual sets, the pre-training version and movement definitions.
  await page.getByRole('button', { name: '本周计划', exact: true }).click();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByPlaceholder('搜索动作名称或提示').fill('可删除测试动作');
  await page.getByRole('dialog').locator('.picker-list button').first().click();
  const plannedSets = (await draft()).days[0].exercises[0].sets;
  await page.getByRole('button', { name: '开始训练', exact: true }).click();
  await page.locator('.log-card').first().getByRole('button', { name: '删除这一组', exact: true }).last().click();
  await page.getByLabel('训练前恢复').selectOption('good');
  await page.getByRole('checkbox', { name: '我已核对，以上是实际完成数据', exact: true }).check();
  await page.getByRole('button', { name: '完成并保存训练', exact: true }).click();
  await page.getByRole('heading', { name: '最佳工作组重量' }).waitFor();
  const savedRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('form-logs-v2'))[0]);
  if (!savedRecord.verified || savedRecord.planId !== originalId || !savedRecord.revisionId || !savedRecord.budgetSnapshot) throw new Error('训练记录缺少核对、预算或版本关联');
  if (savedRecord.exercises[0].sets.length !== plannedSets - 1 || (await draft()).days[0].exercises[0].sets !== plannedSets) throw new Error('实际组数覆盖了计划目标组数');
  await page.getByRole('button', { name: '动作库', exact: true }).click();
  await page.getByRole('button', { name: '删除动作可删除测试动作', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  if (!(await draft()).days[0].exercises.some((item) => item.movementId === savedRecord.exercises.at(-1).movementId)) throw new Error('删除动作破坏已有计划');

  // Manual budget creates a restorable version but leaves prescribed sets intact.
  await page.getByRole('button', { name: '本周计划', exact: true }).click();
  const beforeBudget = await draft();
  await page.getByRole('button', { name: '训练量', exact: true }).click();
  const chest = page.locator('.volume-budget-item').filter({ hasText: '胸部（合计）' });
  await chest.getByRole('button', { name: '调整预算', exact: true }).click();
  await page.getByRole('spinbutton', { name: '胸部（合计）周预算', exact: true }).fill('12');
  await chest.getByRole('button', { name: '保存预算', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).targets.midChest === 12);
  if (JSON.stringify((await draft()).days) !== JSON.stringify(beforeBudget.days)) throw new Error('调整预算意外修改了动作处方');
  await page.getByRole('button', { name: '训练记录建议', exact: true }).click();
  if (await page.getByRole('button', { name: /应用建议/ }).count()) throw new Error('无记录却出现调整建议');
  await page.getByRole('button', { name: '关闭训练量', exact: true }).click();

  // Synthetic history in this isolated test context: three complete weeks of plateau.
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('form-plans-v1'));
    const entry = store.plans.find((item) => item.id === store.activePlanId);
    const today = new Date(); today.setHours(12, 0, 0, 0); today.setDate(today.getDate() - (today.getDay() + 6) % 7);
    const records = [3, 2, 1].map((weeks, index) => {
      const date = new Date(today); date.setDate(date.getDate() - weeks * 7 + 1);
      return { id: `review-${index}`, date: date.toISOString(), planId: entry.id, muscleModelVersion: entry.draft.muscleModelVersion, verified: true, recovery: 'good', budgetSnapshot: { chest: 12 }, exercises: [{ movementId: 'flat-bench-press', variantId: 'db-bench', sets: Array.from({ length: 12 }, () => ({ weight: 20, reps: 10, rir: 2 })) }] };
    });
    localStorage.setItem('form-logs-v2', JSON.stringify([...records, ...JSON.parse(localStorage.getItem('form-logs-v2'))]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '训练量', exact: true }).click();
  await page.getByRole('button', { name: '训练记录建议', exact: true }).click();
  await page.getByRole('button', { name: '应用建议：12 → 13 组／周', exact: true }).waitFor();
  if ((await draft()).targets.midChest !== 12) throw new Error('建议未经应用已改预算');
  await page.screenshot({ path: `${root}/artifacts/volume-review-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '应用建议：12 → 13 组／周', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).targets.midChest === 13);
  if (await page.getByRole('button', { name: /应用建议/ }).count()) throw new Error('相同证据重复建议加量');
  await page.getByRole('button', { name: '关闭训练量', exact: true }).click();

  // Backup round-trip includes all plans, versions and custom definitions.
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadEvent;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  if (backup.version !== 3 || backup.planStore.plans.length !== 3 || !backup.custom.movements.length) throw new Error('备份未包含多计划、版本或自定义动作');
  await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).targets.midChest === 13);
  if ((await store()).activePlanId !== originalId) throw new Error('导入丢失当前计划选择');

  // Actual touch events against the grip, on the narrow layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.drag-handle').first().scrollIntoViewIfNeeded();
  const mobileOrder = (await draft()).days[0].exercises.map((item) => item.id);
  const touchSource = await page.locator('.drag-handle').first().boundingBox();
  const touchTarget = await page.locator('.drag-handle').nth(1).boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const x = touchSource.x + touchSource.width / 2; const y = touchSource.y + touchSource.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 10; step += 1) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (touchTarget.y + touchTarget.height / 2 - y) * step / 10, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[1].id === id, mobileOrder[0]);
  await page.screenshot({ path: `${root}/artifacts/management-mobile.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('新增界面造成移动端横向溢出');
  await page.getByRole('button', { name: '计划管理', exact: true }).click();
  await page.screenshot({ path: `${root}/artifacts/versions-mobile.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('版本管理移动端横向溢出');
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('新增功能验证通过：鼠标、键盘与触屏排序；动作删除、撤销、恢复；多计划、版本恢复、备份往返；周预算与记录建议。');
} catch (error) {
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

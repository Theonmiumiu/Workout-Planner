import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7102', '--strictPort'], { cwd: root, stdio: 'pipe' });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
const errors = [];
try {
  let ready = false;
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch('http://127.0.0.1:7102')).ok) { ready = true; break; } } catch {}
    await pause(200);
  }
  if (!ready) throw new Error('本机开发服务未启动');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.goto('http://127.0.0.1:7102', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '动作库', exact: true }).click();
  await page.getByPlaceholder('搜索动作').fill('提踵');
  await page.locator('.library-row-main').filter({ hasText: '提踵' }).click();
  await page.getByLabel('查看器械参数').selectOption('standing-calf');
  const row = page.locator('.region-table > div').filter({ hasText: '腓肠肌内侧头' });
  if (!(await row.innerText()).includes('1 组')) throw new Error('伸膝参数不正确');
  await page.getByLabel('查看器械参数').selectOption('seated-calf');
  if (!(await row.innerText()).includes('0.25 组')) throw new Error('切换器械没有改变区域参与参数');
  if (!(await page.locator('.detail-stats').innerText()).includes('12–20')) throw new Error('切换器械没有改变次数范围');
  if (await page.locator('.section-note, .muscle-bookkeeping, .budget-explanation, .method-note').count()) throw new Error('仍有解释性小字');
  await page.screenshot({ path: `${root}/artifacts/calf-variant-parameters.png`, fullPage: true });
  await page.locator('.modal-close').click();
  await page.getByRole('button', { name: '训练参数', exact: true }).click();
  await page.getByLabel('体重（kg）', { exact: true }).fill('70');
  await page.locator('.region-preferences summary').click();
  await page.getByLabel('臀中肌区域偏好', { exact: true }).selectOption('priority');
  await page.getByRole('button', { name: '去计划页生成' }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')));
  if (!plan.days.some((day) => day.exercises.some((item) => item.movementId === 'hip-abduction'))) throw new Error('区域目标未进入动作分配');
  const exercise = page.locator('.plan-exercise').first();
  await exercise.getByRole('combobox').selectOption('db-bench');
  await exercise.getByRole('spinbutton', { name: /计划重量/ }).fill('20');
  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByLabel('本次体重（kg）').waitFor();
  if (await page.getByLabel('本次体重（kg）').inputValue() !== '70') throw new Error('本次体重未带入');
  const card = page.locator('.log-card').first();
  const sets = card.locator('.set-row:not(.set-head)');
  await sets.first().waitFor();
  const count = await sets.count();
  for (let index = 0; index < count; index += 1) {
    const inputs = sets.nth(index).locator('input');
    await inputs.nth(0).fill('20'); await inputs.nth(1).fill('10'); await inputs.nth(2).fill('2');
  }
  await sets.first().getByRole('combobox').selectOption('warmup');
  if (count > 2) await sets.nth(1).locator('input').nth(2).fill('5');
  const matched = count - (count > 2 ? 2 : 1);
  const completed = count - 1;
  await page.waitForFunction(({ completed, count, matched }) => {
    const text = document.querySelector('.log-card .session-metrics')?.textContent;
    return text?.includes(`完成 ${completed} / ${count} 组`) && text.includes(`次数达成 ${completed} 组`) && text.includes(`负荷匹配 ${matched} 组`);
  }, { completed, count, matched });
  if (!(await card.locator('.session-metrics').innerText()).includes('估算 1RM')) throw new Error('缺少重量、次数与 RIR 综合表现');
  await page.getByLabel('训练前恢复').selectOption('good');
  await page.getByRole('checkbox', { name: '我已核对，以上是实际完成数据' }).check();
  await page.screenshot({ path: `${root}/artifacts/workload-log-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '完成并保存训练' }).click();
  await page.getByRole('heading', { name: '最佳工作组重量', exact: true }).waitFor();
  await page.getByRole('button', { name: '训练容量', exact: true }).click();
  if (!(await page.locator('.trend-chart').innerText()).includes('kg·次')) throw new Error('容量趋势未按当前版本显示');
  await page.getByRole('button', { name: '估算 1RM', exact: true }).click();
  if (!(await page.locator('.trend-chart').innerText()).includes('28kg')) throw new Error('估算力量未使用重量、次数与 RIR');
  await page.screenshot({ path: `${root}/artifacts/workload-trend-desktop.png`, fullPage: true });
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem('form-logs-v2'))[0]);
  if (record.bodyWeight !== 70 || record.exercises[0].sets[0].kind !== 'warmup' || record.doseModelVersion !== 2) throw new Error('新记录字段未持久保存');
  await page.getByRole('button', { name: '本周计划', exact: true }).click();
  await page.getByRole('button', { name: '训练量', exact: true }).click();
  await page.getByRole('button', { name: '实际完成', exact: true }).click();
  const chest = page.locator('.volume-budget-item').filter({ hasText: '胸部（合计）' });
  if (!(await chest.innerText()).includes(`完成 ${completed}`) || !(await chest.innerText()).includes(`负荷匹配 ${matched}`)) throw new Error('周完成量和匹配组数未分开');
  await page.getByRole('button', { name: '区域分布', exact: true }).click();
  await page.locator('.volume-modal > .segmented-tabs:not(.volume-tabs)').getByRole('button', { name: '实际完成', exact: true }).click();
  if (!(await page.locator('.regional-volume-list').innerText()).includes('上胸')) throw new Error('区域分布缺少形体区域');
  await page.screenshot({ path: `${root}/artifacts/regional-volume-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭训练量', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '训练记录', exact: true }).last().click();
  await page.locator('.set-table').first().waitFor();
  await page.screenshot({ path: `${root}/artifacts/workload-log-mobile.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('移动端训练记录横向溢出');

  const scenario = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  scenario.on('pageerror', (error) => errors.push(error.message));
  await scenario.goto('http://127.0.0.1:7102', { waitUntil: 'networkidle' });
  await scenario.getByRole('heading', { name: '本周训练计划', exact: true }).waitFor();
  await scenario.evaluate(async () => {
    const { movementById } = await import('/src/engine/planner.js');
    const movement = movementById('hip-abduction');
    const store = JSON.parse(localStorage.getItem('form-plans-v1'));
    const draft = store.plans.find((item) => item.id === store.activePlanId).draft;
    draft.days[0].focus = 'legs';
    draft.days[0].exercises = [{ id: 'screenshot-hip', movementId: movement.id, variantId: 'machine-abduction', movementSnapshot: structuredClone(movement), sets: 4, weight: 45, repRange: [12, 20], rir: 1.5, rest: 75 }];
    localStorage.setItem('form-plans-v1', JSON.stringify(store));
    localStorage.setItem('form-plan-v2', JSON.stringify(draft));
  });
  await scenario.reload({ waitUntil: 'networkidle' });
  await scenario.getByRole('button', { name: '开始训练', exact: true }).click();
  const hip = scenario.locator('.log-card').first();
  const hipRows = hip.locator('.set-row:not(.set-head)');
  const fillHip = async (reps, rir) => {
    for (let index = 0; index < 4; index++) {
      const inputs = hipRows.nth(index).locator('input');
      await inputs.nth(1).fill(String(reps)); await inputs.nth(2).fill(String(rir));
    }
  };
  await fillHip(16, 4);
  const metrics = await hip.locator('.session-metrics').innerText();
  for (const expected of ['完成 4 / 4 组', '次数达成 4 组', '负荷匹配 0 组', '偏轻 4 组', '2880 kg·次']) if (!metrics.includes(expected)) throw new Error(`截图场景未显示 ${expected}`);
  if (!(await hip.locator('.advice-badge.up').innerText()).includes('47.5 kg')) throw new Error('各组轻松完成未建议加重');
  if (await scenario.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].weight) !== 45) throw new Error('建议自动修改了计划重量');
  await hip.screenshot({ path: `${root}/artifacts/completion-progress-desktop.png` });
  await fillHip(21, 2);
  if (!(await hip.locator('.session-metrics').innerText()).includes('次数达成 4 组')) throw new Error('超额次数丢失完成量');
  if (!(await hip.locator('.advice-badge.up').innerText()).includes('47.5 kg')) throw new Error('超过次数上限未建议进阶');
  await hipRows.last().locator('input').nth(2).fill('0');
  if (await hip.locator('.advice-badge.down').count()) throw new Error('个别力竭误建议减重');
  await fillHip(16, 2);
  for (let index = 1; index < 4; index++) {
    await hipRows.nth(index).locator('input').nth(1).fill('10');
    await hipRows.nth(index).locator('input').nth(2).fill('1');
  }
  if (!(await hip.locator('.advice-badge.down').innerText()).includes('42.5 kg')) throw new Error('多数组偏重未建议减重');
  await fillHip(16, 4);
  await scenario.getByRole('button', { name: '完成并保存训练', exact: true }).click();
  await scenario.getByRole('heading', { name: '最佳工作组重量', exact: true }).waitFor();
  await scenario.getByRole('button', { name: '本周计划', exact: true }).click();
  await scenario.getByRole('button', { name: '训练量', exact: true }).click();
  await scenario.getByRole('button', { name: '实际完成', exact: true }).click();
  const glutes = scenario.locator('.volume-budget-item').filter({ hasText: '臀部（多肌合并）' });
  if (!(await glutes.innerText()).includes('完成 4 / 目标 8 组') || !(await glutes.innerText()).includes('50%')) throw new Error('偏轻的实际工作组未计入周完成量');
  await scenario.getByRole('button', { name: '关闭训练量', exact: true }).click();
  await scenario.getByRole('button', { name: 'Docs', exact: true }).click();
  await scenario.getByRole('navigation', { name: 'Docs 目录' }).getByRole('button', { name: '进阶规则与负重校准', exact: true }).click();
  if (!(await scenario.locator('.docs-article').innerText()).includes('47.5 kg') || !(await scenario.locator('.docs-article').innerText()).includes('过半')) throw new Error('Docs 未更新新进阶规则');
  await scenario.getByRole('navigation', { name: 'Docs 目录' }).getByRole('button', { name: '训练记录、重量与次数', exact: true }).click();
  if (!(await scenario.locator('.docs-article').innerText()).includes('完成 4／4 组')) throw new Error('Docs 缺少截图场景的完成量解释');
  await scenario.screenshot({ path: `${root}/artifacts/completion-docs-desktop.png`, fullPage: true });
  await scenario.setViewportSize({ width: 390, height: 844 });
  await scenario.getByRole('button', { name: '训练记录', exact: true }).last().click();
  await fillHip(16, 4);
  await scenario.locator('.log-card').first().screenshot({ path: `${root}/artifacts/completion-progress-mobile.png` });
  if (await scenario.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('新进阶文案或完成指标造成手机横向溢出');
  await scenario.close();
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('训练量浏览器验证通过：完成与负荷匹配分离、截图场景加重、超次数、个别力竭、合理减重、周完成量、Docs、记录保存与移动端。');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

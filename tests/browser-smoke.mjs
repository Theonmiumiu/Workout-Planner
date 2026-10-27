import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { isMovementAllowedForFocus } from '../src/engine/training.js';
import { movementById, estimateDay } from '../src/engine/planner.js';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7100', '--strictPort'], { cwd: root, stdio: 'pipe' });
let browser;
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    try { const response = await fetch('http://127.0.0.1:7100'); if (response.ok) { ready = true; break; } } catch { /* wait for Vite */ }
    await sleep(200);
  }
  if (!ready) throw new Error('开发服务器未能启动');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.goto('http://127.0.0.1:7100', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本周训练计划' }).waitFor();
  if (await page.locator('.plan-exercise').count() < 3) throw new Error('默认计划动作不足');
  await page.screenshot({ path: `${root}/artifacts/plan-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: '我的健身房' }).click();
  await page.getByRole('heading', { name: '你的健身房' }).waitFor();
  await page.getByRole('button', { name: '添加杠铃', exact: true }).click();
  await page.getByRole('button', { name: '移除杠铃', exact: true }).waitFor();
  await page.screenshot({ path: `${root}/artifacts/equipment-desktop.png`, fullPage: true });

  // 自定义器械与动作：填表保存后立即出现在动作库。
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('器械名称（必填）').fill('测试推胸机');
  await page.getByRole('button', { name: '保存器械' }).click();
  await page.getByRole('dialog').getByText('测试推胸机', { exact: true }).waitFor();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByLabel('动作名称（必填）').fill('测试卧推');
  await page.getByLabel('所需器械（必选）').selectOption({ label: '测试推胸机' });
  await page.getByRole('button', { name: '保存动作' }).click();
  await page.getByRole('dialog').getByText('测试卧推', { exact: true }).waitFor();
  await page.screenshot({ path: `${root}/artifacts/custom-manage.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '动作库' }).click();
  await page.getByText('测试卧推').waitFor();

  // 后束和器械名称都应能检索到蝴蝶机反坐等全部版本。
  const librarySearch = page.getByPlaceholder('搜索动作');
  const reverseFlyRow = page.locator('.library-row-main').filter({ hasText: '反向飞鸟' });
  await librarySearch.fill('后束');
  await reverseFlyRow.waitFor();
  await librarySearch.fill('蝴蝶机');
  await reverseFlyRow.waitFor();
  await reverseFlyRow.click();
  await page.getByRole('dialog', { name: '反向飞鸟', exact: true }).waitFor();
  await page.getByLabel('查看器械参数').selectOption('reverse-pec');
  if ((await page.locator('.muscle-roles .muscle-tags').innerText()).includes('%')) throw new Error('肌群参与仍显示未实测的百分比');
  if (!(await page.locator('.region-table').innerText()).includes('斜方肌中束')) throw new Error('未显示细分肌群');
  if (await page.locator('.section-note, .muscle-bookkeeping, .budget-explanation').count()) throw new Error('界面仍有解释性小字');
  await page.screenshot({ path: `${root}/artifacts/muscle-audit-desktop.png`, fullPage: true });
  await page.screenshot({ path: `${root}/artifacts/library-reverse-fly.png`, fullPage: true });
  await page.getByRole('dialog').locator('.modal-close').click();
  await librarySearch.fill('');

  await page.getByRole('button', { name: '训练参数' }).click();
  await page.getByLabel('训练分化').selectOption('full');
  await page.getByRole('button', { name: '去计划页生成' }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  if (!(await page.locator('.focus-summary').innerText()).includes('全身')) throw new Error('全身训练选择未生效');
  await page.getByRole('button', { name: '训练参数' }).click();
  await page.getByLabel('训练分化').selectOption('focused');
  await page.getByRole('button', { name: '肩中束重点补强' }).click();
  await page.getByRole('button', { name: '去计划页生成' }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('heading', { name: '本周训练计划' }).waitFor();
  if (!(await page.locator('.focus-summary').innerText()).includes('胸部＋三头')) throw new Error('部位分化选择未生效');
  const generated = await page.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')));
  if (!generated.days.every((day) => day.exercises.every((item) => isMovementAllowedForFocus(movementById(item.movementId), day.focus)))) throw new Error('分化日混入无关动作');
  await page.getByRole('button', { name: '训练量', exact: true }).click();
  await page.getByRole('dialog', { name: '估算训练量' }).waitFor();
  if (!(await page.locator('.volume-list').innerText()).includes('胸部（合计）')) throw new Error('胸部未合并核算');
  await page.getByRole('dialog').locator('.icon-button').first().click();
  if (await page.getByRole('button', { name: /锁定动作|解锁动作/ }).count()) throw new Error('仍显示锁定按钮');
  const rowAlignment = await page.locator('.exercise-row').first().evaluate((row) => {
    const centers = [...row.children].map((element) => { const box = element.getBoundingClientRect(); return box.y + box.height / 2; });
    return Math.max(...centers) - Math.min(...centers);
  });
  if (rowAlignment > 2) throw new Error('动作参数未排在同一行');
  if (await page.locator('.exercise-row-scroll').first().evaluate((row) => row.scrollWidth > row.clientWidth)) throw new Error('桌面动作行出现横向滚动');
  await page.locator('.plan-exercise').first().getByRole('button', { name: '替换动作', exact: true }).click();
  const replacement = page.getByRole('dialog').locator('.picker-list button:not([disabled])').first();
  const replacementName = await replacement.locator('strong').innerText();
  await replacement.click();
  if (await page.locator('.exercise-name > strong').first().innerText() !== replacementName) throw new Error('替换动作未更新动作快照');

  // 自定义目标次数：计划、本地保存和训练记录使用同一范围。
  const firstExercise = page.locator('.plan-exercise').first();
  if (await firstExercise.locator('.exercise-detail').count()) throw new Error('动作参数验证前详情意外展开');
  const deleteAll = async (input) => {
    await input.focus();
    await input.press('End');
    const length = (await input.inputValue()).length;
    for (let index = 0; index < length; index++) await input.press('Backspace');
    if (await input.inputValue() !== '') throw new Error('删除最后一位后数值框自动回填，无法清空');
  };
  const low = firstExercise.getByRole('spinbutton', { name: /目标下限/ });
  const high = firstExercise.getByRole('spinbutton', { name: /目标上限/ });
  await deleteAll(low);
  await low.pressSequentially('9');
  await low.press('Tab');
  await deleteAll(high);
  await high.pressSequentially('1');
  if (await high.inputValue() !== '1') throw new Error('次数输入中途被限制值覆盖');
  await high.pressSequentially('4');
  await high.press('Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).days.some((day) => day.exercises.some((item) => item.repRange?.[0] === 9 && item.repRange?.[1] === 14)));
  await high.fill('');
  await high.press('Tab');
  if (await high.inputValue() !== '14') throw new Error('必填数值留空离开后未恢复原值');

  const rest = firstExercise.getByRole('spinbutton', { name: /组间休息/ });
  const minutesWithRest = async (seconds) => {
    const day = await page.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')).days[0]);
    day.exercises[0].rest = seconds;
    return estimateDay(day);
  };
  const checkMinutes = async (minutes) => {
    if (!(await page.locator('.sheet-heading').innerText()).includes(`预计 ${minutes} /`)) throw new Error('用时总计与当前休息不一致');
    if (!(await page.locator('.day-tabs button.active').innerText()).includes(`约 ${minutes} 分钟`)) throw new Error('训练日标签与用时总计不一致');
  };
  await rest.fill('90');
  await checkMinutes(await minutesWithRest(90));
  await rest.press('Enter');
  await deleteAll(rest);
  if (await page.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].rest) !== 90) throw new Error('清空编辑中的数值污染了已保存处方');
  await rest.pressSequentially('120');
  const previewMinutes = await minutesWithRest(120);
  await checkMinutes(previewMinutes);
  await rest.press('Tab');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].rest === 120);
  await checkMinutes(previewMinutes);
  await rest.fill('9999');
  if (await rest.inputValue() !== '9999') throw new Error('休息输入尚未完成就被截断');
  await rest.press('Tab');
  if (await rest.inputValue() !== '900') throw new Error('离开数值框后未校验休息上限');
  await deleteAll(rest);
  await rest.pressSequentially('0');
  await rest.press('Enter');
  if (await rest.inputValue() !== '0') throw new Error('合法的零秒休息被清空');
  await rest.fill('');
  await rest.press('Tab');
  if (await rest.inputValue() !== '0') throw new Error('必填留空未恢复零值');
  await rest.fill('120');
  await rest.press('Tab');

  const planWeight = firstExercise.getByRole('spinbutton', { name: /计划重量/ });
  await planWeight.fill('20.5');
  await planWeight.press('Enter');
  if (await planWeight.inputValue() !== '20.5') throw new Error('重量小数被错误取整');
  await deleteAll(planWeight);
  await planWeight.press('Tab');
  if (await planWeight.inputValue() !== '') throw new Error('可选重量无法保持空值');
  await planWeight.fill('0');
  await planWeight.press('Enter');
  if (await planWeight.inputValue() !== '0') throw new Error('重量零值被错误渲染为空');

  // 手动添加动作：选择器里挑一个未安排的动作，计划行数应增加。
  const beforeAdd = await page.locator('.plan-exercise').count();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByRole('dialog').locator('.picker-list button:not([disabled])').first().click();
  if (await page.locator('.plan-exercise').count() !== beforeAdd + 1) throw new Error('手动添加动作失败');
  await page.locator('.plan-exercise').last().getByRole('button', { name: '删除动作', exact: true }).click();
  if (await page.locator('.plan-exercise').count() !== beforeAdd) throw new Error('动作行删除图标未移除动作');
  await firstExercise.getByRole('button', { name: '展开详情', exact: true }).click();
  if (await firstExercise.locator('.exercise-detail input').count()) throw new Error('详情中仍有重复编辑控件');
  await firstExercise.screenshot({ path: `${root}/artifacts/exercise-row-desktop.png` });

  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByRole('button', { name: '按计划填入' }).click();
  if (!(await page.locator('.log-card-header p').first().innerText()).includes('9–14')) throw new Error('训练记录未使用自定义次数范围');
  const weightInput = page.locator('.set-row input').first();
  await weightInput.fill('20');
  await page.getByRole('button', { name: '完成并保存训练' }).click();
  await page.getByRole('heading', { name: '最佳工作组重量' }).waitFor();
  if (await page.locator('.history-list details').count() !== 1) throw new Error('训练记录未保存');
  await page.screenshot({ path: `${root}/artifacts/history-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('heading', { name: 'Docs', exact: true }).waitFor();
  if (await page.locator('.section-note, .method-note').count()) throw new Error('进阶页仍有解释性小字');
  await page.screenshot({ path: `${root}/artifacts/rules-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '计划', exact: true }).click();
  await page.getByRole('heading', { name: '本周训练计划' }).waitFor();
  await page.screenshot({ path: `${root}/artifacts/plan-mobile.png`, fullPage: true });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (horizontalOverflow) throw new Error('移动端存在横向溢出');
  await page.getByRole('button', { name: '训练参数', exact: true }).last().click();
  await page.getByLabel('训练分化').waitFor();
  await page.screenshot({ path: `${root}/artifacts/profile-mobile.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('移动端分化设置横向溢出');

  // Existing plans remain reviewable until the user explicitly regenerates.
  await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem('form-plan-v2'));
    delete plan.algorithmVersion;
    localStorage.setItem('form-plan-v2', JSON.stringify(plan));
    const store = JSON.parse(localStorage.getItem('form-plans-v1'));
    store.plans.find((entry) => entry.id === store.activePlanId).draft = plan;
    localStorage.setItem('form-plans-v1', JSON.stringify(store));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本周训练计划', exact: true }).waitFor();
  if (await page.getByText('旧规则版本', { exact: true }).count()) throw new Error('仍显示旧规则版本注释');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  if (await page.locator('.legacy-plan-status').count()) throw new Error('重新生成后仍显示旧规则提示');
  if (await page.evaluate(() => JSON.parse(localStorage.getItem('form-logs-v2')).length) !== 1) throw new Error('重新生成丢失训练历史');

  // v2 历史数据中的通用十字机飞鸟也要自动归到高位下夹。
  await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem('form-plan-v2'));
    Object.assign(plan.days[0].exercises[0], { movementId: 'chest-fly', variantId: 'crossover-fly' });
    localStorage.setItem('form-plan-v2', JSON.stringify(plan));
    const store = JSON.parse(localStorage.getItem('form-plans-v1'));
    store.plans.find((entry) => entry.id === store.activePlanId).draft = plan;
    localStorage.setItem('form-plans-v1', JSON.stringify(store));
    const logs = JSON.parse(localStorage.getItem('form-logs-v2'));
    Object.assign(logs[0].exercises[0], { movementId: 'chest-fly', variantId: 'crossover-fly' });
    localStorage.setItem('form-logs-v2', JSON.stringify(logs));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本周训练计划' }).waitFor();
  const migrated = await page.evaluate(() => ({
    plan: JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].movementId,
    log: JSON.parse(localStorage.getItem('form-logs-v2'))[0].exercises[0].movementId,
  }));
  if (migrated.plan !== 'high-to-low-fly' || migrated.log !== 'high-to-low-fly') throw new Error('旧十字机飞鸟数据未迁移');
  if (errors.length) throw new Error(`浏览器错误：${errors.join(' | ')}`);
  console.log('浏览器验证通过：单行动作参数、图标替换与删除、分化选择、部位约束、合并训练量、器械、训练记录、规则说明、移动端和旧计划升级。');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

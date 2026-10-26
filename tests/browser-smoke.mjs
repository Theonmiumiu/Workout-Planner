import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { isMovementAllowedForFocus } from '../src/engine/training.js';
import { movementById } from '../src/engine/planner.js';

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
  await page.getByText('测试推胸机').waitFor();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByLabel('动作名称（必填）').fill('测试卧推');
  await page.getByLabel('所需器械（必选）').selectOption({ label: '测试推胸机' });
  await page.getByRole('button', { name: '保存动作' }).click();
  await page.getByText('测试卧推').waitFor();
  await page.screenshot({ path: `${root}/artifacts/custom-manage.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '动作库' }).click();
  await page.getByText('测试卧推').waitFor();

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
  await page.locator('.plan-exercise').first().getByRole('button', { name: '锁定动作，重新生成时保留' }).click();
  await page.locator('.plan-exercise').first().getByRole('button', { name: '展开详情' }).click();
  await page.locator('.plan-exercise').first().getByRole('button', { name: '替换', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').locator('.icon-button').first().click();

  // 自定义目标次数：计划、本地保存和训练记录使用同一范围。
  const firstExercise = page.locator('.plan-exercise').first();
  await firstExercise.getByRole('spinbutton', { name: /目标下限/ }).fill('9');
  await firstExercise.getByRole('spinbutton', { name: /目标上限/ }).fill('14');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).days.some((day) => day.exercises.some((item) => item.repRange?.[0] === 9 && item.repRange?.[1] === 14)));

  // 手动添加动作：选择器里挑一个未安排的动作，计划行数应增加。
  const beforeAdd = await page.locator('.plan-exercise').count();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByRole('dialog').locator('.picker-list button:not([disabled])').first().click();
  if (await page.locator('.plan-exercise').count() !== beforeAdd + 1) throw new Error('手动添加动作失败');

  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByRole('button', { name: '按计划填入' }).click();
  if (!(await page.locator('.log-card-header p').first().innerText()).includes('9–14')) throw new Error('训练记录未使用自定义次数范围');
  const weightInput = page.locator('.set-row input').first();
  await weightInput.fill('20');
  await page.getByRole('button', { name: '完成并保存训练' }).click();
  await page.getByRole('heading', { name: '最佳工作组重量' }).waitFor();
  if (await page.locator('.history-list details').count() !== 1) throw new Error('训练记录未保存');
  await page.screenshot({ path: `${root}/artifacts/history-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: '进阶规则' }).click();
  await page.getByRole('heading', { name: '计划背后的规则' }).waitFor();
  if (!(await page.locator('.rules-page').innerText()).includes('尚未通过实际训练试验验证')) throw new Error('缺少算法验证边界');
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
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '当前是旧规则生成的计划' }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  if (await page.locator('.legacy-plan-note').count()) throw new Error('重新生成后仍显示旧规则提示');
  if (await page.evaluate(() => JSON.parse(localStorage.getItem('form-logs-v2')).length) !== 1) throw new Error('重新生成丢失训练历史');
  if (errors.length) throw new Error(`浏览器错误：${errors.join(' | ')}`);
  console.log('浏览器验证通过：分化选择、部位约束、合并训练量、器械、锁定与替换、训练记录、规则说明、移动端和旧计划升级。');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

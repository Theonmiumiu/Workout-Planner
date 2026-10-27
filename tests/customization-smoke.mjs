import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { isMovementAllowedForFocus } from '../src/engine/training.js';
import { movementForEntry, getVolumeSources } from '../src/engine/planner.js';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7103', '--strictPort'], { cwd: root, stdio: 'pipe' });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
const errors = [];
try {
  let ready = false;
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch('http://127.0.0.1:7103')).ok) { ready = true; break; } } catch {}
    await pause(200);
  }
  if (!ready) throw new Error('本机开发服务未启动');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.goto('http://127.0.0.1:7103', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '本周训练计划', exact: true }).waitFor();
  const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem('form-plan-v2')));
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('form-plans-v1'));
    const entry = store.plans.find((item) => item.id === store.activePlanId);
    entry.draft.algorithmVersion = 1;
    localStorage.setItem('form-plans-v1', JSON.stringify(store));
  });
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.getByText('旧规则版本', { exact: true }).count()) throw new Error('旧规则版本标记未移除');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('heading', { name: 'Docs', exact: true }).waitFor();
  await page.getByRole('navigation', { name: 'Docs 目录' }).getByRole('button', { name: '肌群偏好与区域形体偏好', exact: true }).click();
  const article = page.locator('.docs-article');
  if (!(await article.innerText()).includes('9.6 组') || !(await article.innerText()).includes('不另建一份完整的周总量配额')) throw new Error('Docs 未解释两类偏好的实际作用');
  await page.screenshot({ path: `${root}/artifacts/docs-preferences-desktop.png`, fullPage: true });
  await page.getByLabel('搜索 Docs').fill('加重 档位');
  await page.getByRole('navigation', { name: 'Docs 目录' }).getByRole('button', { name: '进阶规则与负重校准', exact: true }).click();
  if (!(await article.innerText()).includes('减少一个辅助档位')) throw new Error('Docs 缺少现有进阶规则');
  await page.getByLabel('搜索 Docs').fill('');

  await page.getByRole('button', { name: '训练参数', exact: true }).click();
  await page.locator('.stepper-buttons').getByRole('button', { name: /^7\s*练$/ }).click();
  await page.getByLabel('训练分化').selectOption('custom');
  const settings = [['周一', 'chest'], ['周二', 'legs'], ['周三', 'arms'], ['周四', 'shoulders'], ['周五', 'chest'], ['周六', 'back'], ['周日', 'legs']];
  for (const [day, focus] of settings) await page.getByLabel(`${day}套用部位`).selectOption(focus);
  const monday = page.getByRole('region', { name: '周一训练部位', exact: true });
  await monday.getByRole('button', { name: '背阔肌', exact: true }).click();
  await monday.getByRole('button', { name: '上背（斜方／菱形）', exact: true }).click();
  await page.getByLabel('默认组间休息').selectOption('custom');
  await page.getByLabel('默认休息秒数').fill('120');
  await page.getByLabel('默认休息秒数').blur();
  const defaultRest = page.getByLabel('默认休息秒数');
  await defaultRest.focus();
  await defaultRest.press('ControlOrMeta+A');
  await defaultRest.press('Delete');
  if (await defaultRest.inputValue() !== '') throw new Error('默认休息无法通过 Delete 清空');
  await defaultRest.pressSequentially('120');
  await defaultRest.press('Enter');
  await page.screenshot({ path: `${root}/artifacts/custom-schedule-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '去计划页生成' }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).days.length === 7);
  const generated = await plan();
  if (await page.locator('.day-tabs button').count() !== 7) throw new Error('计划未显示七个训练日');
  if (!generated.days.find((day) => day.weekday === 1).muscles.includes('lats')) throw new Error('胸背混合选择未保留');
  if (!generated.days.find((day) => day.weekday === 0).muscles.includes('quads')) throw new Error('周日部位被重新排序');
  if (!generated.days.every((day) => day.exercises.every((entry) => isMovementAllowedForFocus(movementForEntry(entry), day) && entry.rest === 120))) throw new Error('自定义分化或默认休息未进入生成');

  const first = page.locator('.plan-exercise').first();
  const restInput = first.getByRole('spinbutton', { name: /组间休息/ });
  if (await restInput.inputValue() !== '120') throw new Error('计划未展示默认休息');
  const beforeTime = await page.locator('.sheet-heading').innerText();
  await restInput.fill('240');
  const previewHeading = await page.locator('.sheet-heading').innerText();
  if (beforeTime === previewHeading) throw new Error('输入有效休息时用时没有即时预览');
  await restInput.blur();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('form-plan-v2')).days[0].exercises[0].rest === 240);
  if (beforeTime === await page.locator('.sheet-heading').innerText()) throw new Error('修改休息没有重算时长');
  await page.getByRole('button', { name: '保存版本', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: '保存计划版本', exact: true });
  await saveDialog.getByLabel('版本名称／备注').fill('七练休息240秒');
  await saveDialog.screenshot({ path: `${root}/artifacts/save-version-desktop.png` });
  await saveDialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  if (!(await page.locator('.active-program-bar').innerText()).includes('七练休息240秒')) throw new Error('自定义版本名称未持久保存');
  if (await page.locator('.sheet-heading').innerText() !== previewHeading) throw new Error('确认与刷新后的时长不同于输入预览');
  if (await page.locator('.plan-exercise').first().getByRole('spinbutton', { name: /组间休息/ }).inputValue() !== '240') throw new Error('自定义休息未持久保存');

  await page.getByRole('button', { name: '训练量', exact: true }).click();
  await page.getByRole('button', { name: '查看胸部（合计）动作来源', exact: true }).click();
  const sourcePanel = page.getByLabel('胸部（合计）动作来源', { exact: true });
  await sourcePanel.waitFor();
  const sources = getVolumeSources((await plan()).days, 'chest');
  if (await sourcePanel.locator('.volume-source-item').count() !== sources.length) throw new Error('来源动作条目不一致');
  const expected = Math.round(sources.reduce((sum, source) => sum + source.contribution, 0) * 10) / 10;
  if (await sourcePanel.locator('.volume-source-total').innerText() !== `合计 ${expected} 组`) throw new Error('来源合计与计算不一致');
  await page.screenshot({ path: `${root}/artifacts/volume-sources-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: '查看肱三头肌动作来源', exact: true }).click();
  if (!(await page.getByLabel('肱三头肌动作来源', { exact: true }).innerText()).includes('辅助')) throw new Error('动作来源未展示辅助贡献');
  await page.getByRole('button', { name: '关闭训练量', exact: true }).click();
  await page.getByRole('button', { name: '开始训练', exact: true }).click();
  await page.locator('.log-card').first().waitFor();
  if (!(await page.locator('.log-card-header p').first().innerText()).includes('240 秒')) throw new Error('休息未进入训练记录');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Docs', exact: true }).last().click();
  await page.getByLabel('搜索 Docs').fill('休息');
  await page.getByRole('navigation', { name: 'Docs 目录' }).getByRole('button', { name: '休息时间与时长计算', exact: true }).click();
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('移动端 Docs 横向溢出');
  await page.screenshot({ path: `${root}/artifacts/docs-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: '训练参数', exact: true }).last().click();
  await page.getByRole('region', { name: '周日训练部位', exact: true }).waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('移动端自定义星期横向溢出');
  await page.screenshot({ path: `${root}/artifacts/custom-schedule-mobile.png`, fullPage: false });
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('自定义功能浏览器验证通过：Docs、七练、固定星期混合部位、默认及单条休息、动作来源、持久化和移动端。');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

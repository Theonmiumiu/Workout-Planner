import React from 'react';
import { MoonStar, Scale, ShieldCheck } from 'lucide-react';

export default function RulesPage() {
  return <div className="page rules-page">
    <header className="page-header"><h1>计划背后的规则</h1><p className="page-summary">本地规则算法生成可调整的训练起点；尚未通过实际训练试验验证，不能预测个人增肌效果。</p></header>

    <section className="form-section"><div className="section-content">
      <div className="section-title"><h2>先确定每天练什么，再分配训练量</h2><Scale size={20} /></div>
      <div className="algorithm-steps">
        <div><span>1</span><h3>明确分化</h3><p>部位分化的 4 练为胸＋三头、背＋二头、腿＋核心、肩。也可选择上下肢或全身。主导目标必须属于当天部位；卧推等动作的辅助肌群参与是正常现象。</p></div>
        <div><span>2</span><h3>先安排基础动作</h3><p>先为当天的主要动作类型安排至少 2 个工作组，再考虑补量。例如背日先安排垂直拉、划船，再安排二头。这是可调整的模板，不能代表已经练够。</p></div>
        <div><span>3</span><h3>按剩余预算补充</h3><p>在部位与时长限制内，优先补充当天和全周的训练量缺口。复合动作排在孤立动作之前。时间或器械不足时显示缺口；锁定动作超时也会提示。</p></div>
        <div><span>4</span><h3>百分比只是记账</h3><p>胸部各区域合并为一个预算，背部同理，同一组对同一肌群最多计 1 组。展示主导动作组数和折算量；辅助系数来自动作库的估算，100% 不是效果评分。</p></div>
      </div>
    </div></section>

    <section className="form-section"><div className="section-content">
      <div className="section-title"><h2>哪些有依据，哪些仍是人为规则</h2></div>
      <div className="algorithm-steps">
        <div><span>1</span><h3>分化服从偏好与安排</h3><p>等训练量时，分化与全身训练在增肌、力量方面未显示明确差异。集中练某些部位是合理选择；全身训练同样有效。<a href="https://pubmed.ncbi.nlm.nih.gov/38595233/" target="_blank" rel="noreferrer">2024 系统综述</a></p></div>
        <div><span>2</span><h3>训练量需要逐步校准</h3><p>ACSM 将每肌群每周约 10 组作为增肌的一般参考。项目按水平设置 6／8／10 组起始预算，再按偏好调整；这些具体档位不是经过验证的个人最佳量。<a href="https://acsm.org/resistance-training-guidelines-update-2026/" target="_blank" rel="noreferrer">ACSM 2026 指南解读</a></p></div>
        <div><span>3</span><h3>折算有用途，也有误差</h3><p>研究支持区分直接与间接训练量，但并未验证本动作库中每一个系数；不同技术、器械版本和努力程度会改变参与情况。<a href="https://pubmed.ncbi.nlm.nih.gov/41343037/" target="_blank" rel="noreferrer">训练量剂量反应研究</a></p></div>
        <div><span>4</span><h3>规则通过不等于效果验证</h3><p>算法按缺口逐步分配，并非保证最优的数学求解器。每动作自动最多 4 组、每肌群单日主导动作最多 10 组是产品约束。它没有根据睡眠、疼痛或训练历史自动学习，也没有个体效果验证。</p></div>
      </div>
    </div></section>

    <section className="form-section"><div className="section-content">
      <div className="section-title"><h2>双进阶：先加次数，再小幅加重</h2></div>
      <div className="algorithm-steps">
        <div><span>1</span><h3>记录真实余力</h3><p>RIR 2 表示动作规范的前提下，大约还能完成 2 次。大多数组可先保留 1–3 次余力，无需每组力竭。预填数据只是记录起点，需要改为实际完成值。</p></div>
        <div><span>2</span><h3>固定工作重量</h3><p>在同一工作重量下，所有组达到次数上限、且每组至少保留 1 次余力，再考虑小幅加重。建议由记录触发，不自动替你加重。</p></div>
        <div><span>3</span><h3>结合趋势调整</h3><p>连续观察次数、重量和动作质量。表现持续下降或恢复不足时先减量；完成当前预算后依然进步，就无需为百分比继续加组。</p></div>
        <div><span>4</span><h3>热身单独安排</h3><p>预留渐进热身与器械转换时间，热身不计工作组。预计时长按每组约 45 秒加休息计算，不包含排队，实际用时可能更长。</p></div>
      </div>
    </div></section>

    <section className="form-section"><div className="section-content">
      <div className="section-title"><h2>恢复要看个人表现</h2><MoonStar size={20} /></div>
      <p className="section-note">算法尽量减少间隔不足 48 小时的同部位负荷重叠，并检查周日到下周一。48 小时是排程参考，不保证已经恢复；无法避开时会显示提示。低频部位分化也会提示每周仅练一次的取舍。</p>
    </div></section>
    <div className="safety-banner"><ShieldCheck /><div><h3>适用范围</h3><p>当前针对一般增肌训练提供可调整的起点。持续疼痛或明显关节不适时，应停止相关动作并寻求专业评估。</p></div></div>
  </div>;
}

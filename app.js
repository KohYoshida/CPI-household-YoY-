// ===============================
// 設定値
// ===============================
const PX = { w: 520, h: 220, m: { top: 22, right: 42, bottom: 30, left: 46 } };
PX.iw = PX.w - PX.m.left - PX.m.right; // inner width
PX.ih = PX.h - PX.m.top - PX.m.bottom; // inner height

const colors = {
  index: getComputedStyle(document.documentElement).getPropertyValue('--accent1').trim() || '#4aa3ff',
  yoy_q: getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ffd166',
  yoy_e: getComputedStyle(document.documentElement).getPropertyValue('--accent3').trim() || '#ef476f',
};

const grid = d3.select('#grid');
const empty = d3.select('#empty');
const filterInput = document.querySelector('#filter');

// ===============================
// UI イベント
// ===============================
document.querySelector('#loadBtn').addEventListener('click', () => {
  const name = document.querySelector('#csvName').value.trim();
  if (!name) return;
  loadAndRender(name);
});

filterInput.addEventListener('input', () => {
  const q = filterInput.value.trim().toLowerCase();
  d3.selectAll('.card').style('display', function () {
    const item = this.getAttribute('data-item')?.toLowerCase() || '';
    return item.includes(q) ? null : 'none';
  });
  const visible = d3.selectAll('.card').filter(function () { return this.style.display !== 'none'; }).size();
  empty.style('display', visible ? 'none' : null);
});

// 初期読み込み
window.addEventListener('DOMContentLoaded', () => {
  loadAndRender(document.querySelector('#csvName').value.trim());
});

// ===============================
// 読み込み＆描画
// ===============================
async function loadAndRender(csvUrl) {
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : +v);
  const parseRow = (d) => {
    // 型整形
    const row = Object.assign({}, d);
    // date: ISO 文字列 -> Date
    row.date = new Date(d.date);
    // 数値化
    row.index = num(d.index);
    row.yoy_q_pct_chg = num(d.yoy_q_pct_chg);
    row.yoy_e_pct_chg = num(d.yoy_e_pct_chg);
    row.level_kakei = +d.level_kakei; // 階層レベル
    row.code_cpi = +d.code_cpi;
    return row;
  };

  let data;
  try {
    const raw = await d3.csv(csvUrl, parseRow);
    // 必須列あり & 有効な日付のみ
    data = raw.filter((r) => r.item && r.date instanceof Date && !isNaN(r.date));
  } catch (e) {
    console.error(e);
    grid.html('');
    empty.style('display', null).text(`CSVの読み込みに失敗しました: ${e.message}`);
    return;
  }

  // 品目ごとにグルーピング
  const byItem = d3.group(data, (d) => d.item);

  // 並び順：level_kakei=3 を先頭 → 同グループ内で code_cpi 昇順 → さらに item 名昇順
  const rankLevel = (v) => (v === 3 ? 0 : 1);
  const items = Array.from(byItem, ([key, arr]) => ({
    item: key,
    // その品目の代表 level（最大）
    lvl: d3.max(arr, (d) => +d.level_kakei || 0),
    // その品目の代表 code_cpi（最小）
    cpi: d3.min(arr, (d) => +d.code_cpi || Number.POSITIVE_INFINITY),
  }))
    .sort(
      (a, b) =>
        rankLevel(a.lvl) - rankLevel(b.lvl) ||
        d3.ascending(a.cpi, b.cpi) ||
        d3.ascending(a.item, b.item)
    );

  // 画面初期化
  grid.html('');

  // 各品目カードを描画
  for (const { item } of items) {
    const series = byItem
      .get(item)
      .filter(
        (d) =>
          !isNaN(d.index) ||
          !isNaN(d.yoy_q_pct_chg) ||
          !isNaN(d.yoy_e_pct_chg)
      )
      .sort((a, b) => d3.ascending(a.date, b.date));

    if (series.length === 0) continue;

    const card = grid.append('div').attr('class', 'card').attr('data-item', item);
    const title = card.append('div').attr('class', 'title');
    title.append('div').text(item);

    const legend = card.append('div').attr('class', 'legend');
    legend.html(`
      <span><span class="swatch sw1"></span>index</span>
      <span><span class="swatch sw2"></span>YoY 数量(%)</span>
      <!-- <span><span class="swatch sw3"></span>YoY 支出</span> -->
    `);

    const svg = card
      .append('svg')
      .attr('viewBox', `0 0 ${PX.w} ${PX.h}`)
      .attr('preserveAspectRatio', 'xMinYMin meet');

    const g = svg.append('g').attr('transform', `translate(${PX.m.left},${PX.m.top})`);

    // スケール
    const x = d3.scaleUtc()
    .domain(d3.extent(series, (d) => d.date))
    .range([0, PX.iw]);

    const idxVals = series.map((d) => d.index).filter((v) => !isNaN(v));
    const yoyVals = series
    .flatMap((d) => [d.yoy_q_pct_chg, d.yoy_e_pct_chg])
    .filter((v) => !isNaN(v));

    // 左Y軸（index）
    const yL = d3.scaleLinear()
    .domain(d3.extent(idxVals.length ? idxVals : [0, 1]))
    .nice()
    .range([PX.ih, 0]);

    // ---- ここからがポイント： yL(100) と yR(0) を揃える ----

    // 右軸用のデータ最小最大（0% を含める範囲にしておく）
    const dMin = Math.min(0, d3.min(yoyVals.length ? yoyVals : [0]));
    const dMax = Math.max(0, d3.max(yoyVals.length ? yoyVals : [0]));

    // 左軸での「index=100」のピクセル位置
    let y0 = yL(100);
    // 極端な位置での数値発散を避けるため僅かにクランプ
    y0 = Math.max(1, Math.min(PX.ih - 1, y0));

    // yR は range([PX.ih, 0]) の線形スケール。
    // 線形スケールの性質より、domain を [rMin, rMax] とすると
    // t = (0 - rMin) / (rMax - rMin) で、yR(0) = PX.ih*(1 - t) = y0 となる。
    // これを満たす rMin, rMax の関係式： rMin = (alpha/(alpha - 1)) * rMax
    // ただし alpha = 1 - y0/PX.ih
    const alpha = 1 - y0 / PX.ih;

    // alpha が 0 や 1 に極端に近い場合のガード
    const EPS = 1e-6;
    const safeAlpha = Math.min(1 - EPS, Math.max(EPS, alpha));

    // rMin と rMax を求めつつ、必ず [dMin, dMax] を内包するよう調整
    function solveAlignedDomain(dMin, dMax, alpha) {
    // まず rMax をデータ上限から置いて rMin を計算
    let rMax = Math.max(dMax, EPS);
    let rMin = (alpha / (alpha - 1)) * rMax; // 関係式

    // もしこれで rMin がデータ下限をカバーできなければ、rMin を固定して rMax を再計算
    if (rMin > dMin) {
        rMin = dMin;
        rMax = ((alpha - 1) / alpha) * rMin;
    }

    // 再計算後に rMax がデータ上限を下回っていたら、今度は rMax 固定で rMin を再調整
    if (rMax < dMax) {
        rMax = dMax;
        rMin = (alpha / (alpha - 1)) * rMax;
    }

    // 最終ガード：0 が必ず domain 内に入るように（理論上入るはずだが念のため）
    rMin = Math.min(rMin, 0);
    rMax = Math.max(rMax, 0);

    // rMin==rMax の退避
    if (Math.abs(rMax - rMin) < EPS) {
        rMin -= 1;
        rMax += 1;
    }

    return [rMin, rMax];
    }

    const [rMin, rMax] = solveAlignedDomain(dMin, dMax, safeAlpha);

    // 右Y軸（YoY%）：0% が yL(100) と同じ高さになる domain
    const yR = d3.scaleLinear()
    .domain([rMin, rMax])
    .range([PX.ih, 0]);

    // 軸
    const xAxis = d3.axisBottom(x)
    .ticks(d3.timeYear.every(1))
    .tickFormat(d3.timeFormat('%Y'));
    const yAxisL = d3.axisLeft(yL).ticks(5);
    const yAxisR = d3.axisRight(yR).ticks(5).tickFormat((d) => `${d}%`);

    // X グリッド（縦罫線）
    g.append('g')
      .attr('class', 'grid xgrid')
      .attr('transform', `translate(0,${PX.ih})`)
      .call(xAxis.tickSize(-PX.ih))
      .call((g) => g.selectAll('.tick line').attr('class', 'gridline'))
      .call((g) => g.select('.domain').remove());

    // 左 Y 軸
    g.append('g').attr('class', 'axis y left').call(yAxisL);
    // 右 Y 軸
    g.append('g').attr('class', 'axis y right').attr('transform', `translate(${PX.iw},0)`).call(yAxisR);

    // 0% ライン（右軸基準）
    g.append('line')
      .attr('x1', 0)
      .attr('x2', PX.iw)
      .attr('y1', yR(0))
      .attr('y2', yR(0))
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1)  
      .attr('stroke-dasharray', '6,3')
      .attr('opacity', 0.9);        

    // ラインジェネレーター
    const lineL = d3.line()
      .defined((d) => !isNaN(d.index))
      .x((d) => x(d.date))
      .y((d) => yL(d.index));

    const lineYQ = d3.line()
      .defined((d) => !isNaN(d.yoy_q_pct_chg))
      .x((d) => x(d.date))
      .y((d) => yR(d.yoy_q_pct_chg));

    const lineYE = d3.line()
      .defined((d) => !isNaN(d.yoy_e_pct_chg))
      .x((d) => x(d.date))
      .y((d) => yR(d.yoy_e_pct_chg));

    // 描画
    g.append('path')
      .attr('fill', 'none')
      .attr('stroke', colors.index)
      .attr('stroke-width', 1.6)
      .attr('d', lineL(series));

    g.append('path')
      .attr('fill', 'none')
      .attr('stroke', colors.yoy_q)
      .attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '5,3')
      .attr('d', lineYQ(series));

    // YoY 支出（必要なら解除）
    // g.append('path')
    //   .attr('fill', 'none')
    //   .attr('stroke', colors.yoy_e)
    //   .attr('stroke-width', 1.4)
    //   .attr('d', lineYE(series));

    // X 軸（最前面へ）
    g.append('g')
      .attr('class', 'axis x')
      .attr('transform', `translate(0,${PX.ih})`)
      .call(xAxis);
  }

  // フィルタの可視性更新
  filterInput.dispatchEvent(new Event('input'));
}

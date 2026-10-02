(function(){
'use strict';

// ---------- Theme toggle ----------
(function initTheme(){
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  function apply(theme){
    root.setAttribute('data-theme', theme);
    btn.textContent = theme === 'dark' ? '☾' : '☀︎';
  }
  apply(root.getAttribute('data-theme') || 'light');
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('kdar-theme', next); } catch(e){}
  });
})();

// ---------- Layout constants ----------
const YEAR_W = 60;
const LANE_H = 42;
const MIN_BOX_W = 26;
const BOX_H = 34;
const MIN_YEAR = 1905;
const MAX_YEAR = 2027;
const MARGIN_L = 26;
const MARGIN_T = 24;

function yearLabel(y){ return y >= MAX_YEAR ? '현재' : String(y); }

const orgs = DATA.orgs;
const edges = DATA.edges;
const orgById = {};
orgs.forEach(o => orgById[o.id] = o);

const maxLane = Math.max(...orgs.map(o => o.lane));
const contentWidth = (MAX_YEAR - MIN_YEAR + 1) * YEAR_W + MARGIN_L * 2;
const contentHeight = (maxLane + 1) * LANE_H + MARGIN_T * 2;

function xFor(year){ return MARGIN_L + (year - MIN_YEAR) * YEAR_W; }
function laneY(lane){ return MARGIN_T + lane * LANE_H; }

orgs.forEach(o => {
  o.renderW = Math.max((o.year_end - o.year_start + 1) * YEAR_W, MIN_BOX_W);
  o.x = xFor(o.year_start);
  o.y = laneY(o.lane) + (LANE_H - BOX_H) / 2;
});

// Cap each box's rendered width so it never visually overlaps the next box
// sharing the same lane (short-lived orgs otherwise stretch past their true end year).
const GAP_PX = 3;
const byLaneList = {};
orgs.forEach(o => (byLaneList[o.lane] = byLaneList[o.lane] || []).push(o));
Object.values(byLaneList).forEach(list => {
  list.sort((a, b) => a.x - b.x);
  for (let i = 0; i < list.length - 1; i++){
    const cur = list[i], next = list[i + 1];
    const maxW = next.x - cur.x - GAP_PX;
    if (cur.renderW > maxW) cur.renderW = Math.max(maxW, 20);
  }
});

// ---------- Truncation detection (for hover/tap-to-expand) ----------
// Uses a live hidden DOM element (not canvas text metrics) so it always matches
// the real rendered font, regardless of web-font load timing or box size.
const LABEL_PAD_H = 13;   // horizontal label padding (left+right) inside a box
const LABEL_PAD_V = 5;    // vertical label padding (top+bottom) inside a box
const measureEl = document.createElement('div');
measureEl.style.cssText = [
  'position:fixed', 'left:-9999px', 'top:-9999px', 'visibility:hidden',
  'white-space:normal', 'width:max-content', 'max-width:520px',
  "font-family:'Noto Serif KR',serif", 'font-size:11px', 'font-weight:600',
  'line-height:1.24', 'word-break:keep-all'
].join(';');
document.body.appendChild(measureEl);

function measureNatural(name){
  measureEl.innerHTML = name.replace(/\n/g, '<br>');
  return { w: measureEl.offsetWidth + LABEL_PAD_H, h: measureEl.offsetHeight + LABEL_PAD_V };
}

orgs.forEach(o => {
  const nat = measureNatural(o.name);
  o.naturalW = nat.w;
  o.naturalH = nat.h;
  o.needsExpand = nat.w > o.renderW + 1 || nat.h > BOX_H + 1;
});

// Recompute once webfonts have actually loaded (initial measurement may run
// against a fallback font before 'Noto Serif KR' finishes downloading).
if (document.fonts && document.fonts.ready){
  document.fonts.ready.then(() => {
    orgs.forEach(o => {
      const nat = measureNatural(o.name);
      o.naturalW = nat.w;
      o.naturalH = nat.h;
      o.needsExpand = nat.w > o.renderW + 1 || nat.h > BOX_H + 1;
    });
    nodeSel.classed('truncated', d => d.needsExpand);
  }).catch(() => {});
}

// incoming/outgoing lookup for tooltip context
const outgoing = {}, incoming = {};
edges.forEach(e => {
  (outgoing[e.from] = outgoing[e.from] || []).push(e);
  (incoming[e.to] = incoming[e.to] || []).push(e);
});

// ---------- Stats ----------
document.getElementById('stats').innerHTML =
  `단체 <b>${orgs.length}</b>개 · 계보선 <b>${edges.length}</b>개 · <b>${MIN_YEAR}–${yearLabel(MAX_YEAR)}</b>`;

// ---------- SVG setup ----------
const svg = d3.select('#main-svg');
const axisSvg = d3.select('#axis-svg');
const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

// lane background bands
const laneG = zoomLayer.append('g').attr('class', 'lanes');
for (let l = 0; l <= maxLane; l++){
  laneG.append('rect')
    .attr('class', 'lane-band' + (l % 2 ? ' alt' : ''))
    .attr('x', 0).attr('y', laneY(l))
    .attr('width', contentWidth).attr('height', LANE_H);
}

// gridlines (every year, major every 10y)
const gridG = zoomLayer.append('g').attr('class', 'grid');
for (let y = MIN_YEAR; y <= MAX_YEAR; y++){
  const major = (y % 10 === 0);
  gridG.append('line')
    .attr('class', 'gridline' + (major ? ' major' : ''))
    .attr('x1', xFor(y)).attr('x2', xFor(y))
    .attr('y1', 0).attr('y2', contentHeight);
}

// ---------- Edges ----------
function edgePath(a, b){
  const x1 = a.x + a.renderW, y1 = a.y + BOX_H/2;
  const x2 = b.x, y2 = b.y + BOX_H/2;
  const dx = Math.max((x2 - x1) * 0.5, 24);
  return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;
}

const defs = svg.append('defs');
['succession','split','merge','complex','dormant','uncertain'].forEach(t=>{
  const m = defs.append('marker')
    .attr('id', 'arrow-' + t).attr('viewBox', '0 0 8 8')
    .attr('refX', 7).attr('refY', 4)
    .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto-start-reverse');
  m.append('path').attr('d', 'M0,0 L8,4 L0,8 Z').attr('class', 'edge ' + t).attr('fill', 'currentColor');
});

const edgeG = zoomLayer.append('g').attr('class', 'edges');
const edgeSel = edgeG.selectAll('path.edge')
  .data(edges)
  .join('path')
  .attr('class', d => 'edge ' + (d.type === 'split' ? 'split' : d.type === 'merge' ? 'merge' : d.type === 'complex' ? 'complex' : d.type))
  .attr('d', d => edgePath(orgById[d.from], orgById[d.to]))
  .attr('marker-end', d => `url(#arrow-${d.type})`);

// ---------- Nodes ----------
const nodeG = zoomLayer.append('g').attr('class', 'nodes');
const nodeSel = nodeG.selectAll('g.node')
  .data(orgs)
  .join('g')
  .attr('class', d => 'node' + ((d.uncertain_start || d.uncertain_end) ? ' uncertain' : '') + (d.needsExpand ? ' truncated' : ''))
  .attr('transform', d => `translate(${d.x},${d.y})`)
  .attr('data-id', d => d.id);

nodeSel.append('rect')
  .attr('class', 'card')
  .attr('width', d => d.renderW)
  .attr('height', BOX_H)
  .attr('rx', 1.5);

nodeSel.append('rect')
  .attr('class', 'accent')
  .attr('x', 0).attr('y', 0)
  .attr('width', 3.5).attr('height', BOX_H);

const fo = nodeSel.append('foreignObject')
  .attr('class', 'node-fo')
  .attr('x', 0).attr('y', 0)
  .attr('width', d => d.renderW)
  .attr('height', BOX_H);

fo.append('xhtml:div')
  .attr('class', 'node-label')
  .html(d => `<span>${d.name.replace(/\n/g, '<br>')}</span>`);

// ---------- Expand-on-hover / tap for truncated labels ----------
function expandNode(sel, d){
  if (!d.needsExpand || d._expanded) return;
  d._expanded = true;
  const w = Math.max(d.naturalW, d.renderW);
  const h = Math.max(d.naturalH, BOX_H);
  const dy = (BOX_H - h) / 2; // shift up to stay vertically centered on the lane
  sel.classed('expanded', true).raise();
  sel.select('rect.card').attr('width', w).attr('y', dy).attr('height', h);
  sel.select('rect.accent').attr('height', h).attr('y', dy);
  sel.select('foreignObject').attr('width', w).attr('y', dy).attr('height', h);
  sel.select('.node-label span').style('-webkit-line-clamp', 'unset');
}
function collapseNode(sel, d){
  if (!d._expanded) return;
  d._expanded = false;
  sel.classed('expanded', false);
  sel.select('rect.card').attr('width', d.renderW).attr('y', 0).attr('height', BOX_H);
  sel.select('rect.accent').attr('height', BOX_H).attr('y', 0);
  sel.select('foreignObject').attr('width', d.renderW).attr('y', 0).attr('height', BOX_H);
  sel.select('.node-label span').style('-webkit-line-clamp', '2');
}

// ---------- Zoom / pan ----------
const xScale = d3.scaleLinear().domain([MIN_YEAR, MAX_YEAR + 1]).range([MARGIN_L, MARGIN_L + (MAX_YEAR-MIN_YEAR+1)*YEAR_W]);

function getStageSize(){
  const el = document.getElementById('stage');
  return { w: el.clientWidth, h: el.clientHeight - 46 };
}

const zoom = d3.zoom()
  .scaleExtent([0.14, 4])
  .on('zoom', (ev) => {
    zoomLayer.attr('transform', ev.transform);
    drawAxis(ev.transform);
  })
  .on('start', () => document.getElementById('stage').classList.add('grabbing'))
  .on('end', () => document.getElementById('stage').classList.remove('grabbing'));

svg.call(zoom);

function initialTransform(){
  const {w, h} = getStageSize();
  const k = Math.min(1, Math.max(0.18, h / (contentHeight + 40)));
  return d3.zoomIdentity.translate(24, 12).scale(k);
}

function drawAxis(transform){
  const nx = transform.rescaleX(xScale);
  const k = transform.k;
  const px = YEAR_W * k;
  let step = 1;
  if (px < 7) step = 25;
  else if (px < 12) step = 10;
  else if (px < 22) step = 5;
  else if (px < 38) step = 2;
  const ticks = [];
  for (let y = Math.ceil(MIN_YEAR/step)*step; y <= MAX_YEAR; y += step) ticks.push(y);
  if (!ticks.includes(MAX_YEAR)) ticks.push(MAX_YEAR);

  const g = axisSvg.selectAll('g.tick-g').data([0]).join('g').attr('class','tick-g');
  const sel = g.selectAll('g.axis-tick').data(ticks, d=>d);
  sel.exit().remove();
  const enter = sel.enter().append('g').attr('class', d => 'axis-tick' + (d % 10 === 0 || d === MAX_YEAR ? ' major' : ''));
  enter.append('line');
  enter.append('text');
  const merged = enter.merge(sel);
  merged.attr('class', d => 'axis-tick' + (d % 10 === 0 || d === MAX_YEAR ? ' major' : ''));
  merged.attr('transform', d => `translate(${nx(d)},0)`);
  merged.select('line').attr('y1', 0).attr('y2', d => d % 10 === 0 || d === MAX_YEAR ? 14 : 8);
  merged.select('text').attr('y', 26).attr('text-anchor', 'middle')
    .attr('font-size', d => d % 10 === 0 || d === MAX_YEAR ? 11 : 9)
    .text(d => yearLabel(d));
}

function resizeAll(){
  const {w, h} = getStageSize();
  svg.attr('width', w).attr('height', h);
  axisSvg.attr('width', w).attr('height', 46);
  const t = d3.zoomTransform(svg.node());
  drawAxis(t.k === 1 && t.x === 0 && t.y === 0 ? initialTransform() : t);
}

window.addEventListener('resize', resizeAll);
resizeAll();
svg.call(zoom.transform, initialTransform());

document.getElementById('zoom-in').onclick = () => svg.transition().duration(200).call(zoom.scaleBy, 1.4);
document.getElementById('zoom-out').onclick = () => svg.transition().duration(200).call(zoom.scaleBy, 1/1.4);
document.getElementById('zoom-reset').onclick = () => svg.transition().duration(400).call(zoom.transform, initialTransform());

// ---------- Legend collapse ----------
const legendEl = document.getElementById('legend');
const legendToggle = document.getElementById('legend-toggle');
legendToggle.onclick = () => {
  const collapsed = legendEl.classList.toggle('collapsed');
  legendToggle.textContent = '범례 ' + (collapsed ? '▸' : '▾');
};

// ---------- Tooltip ----------
const tooltip = document.getElementById('tooltip');
const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
let activeId = null;

function linkify(text){
  if (!text) return '';
  const esc = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function relLabel(e, dir){
  const map = {succession:'계승', split:'분열', merge:'통합', complex:'복합', dormant:'침체기 후 재개', uncertain:'연관 불확실'};
  const other = dir === 'out' ? orgById[e.to] : orgById[e.from];
  return `${dir === 'out' ? '→' : '←'} ${other.name.replace(/\n/g,' ')} <span style="color:var(--muted)">(${map[e.type]||e.type})</span>`;
}

function buildTooltipContent(d){
  const period = `${yearLabel(d.year_start)}${d.uncertain_start?'?':''} — ${yearLabel(d.year_end)}${d.uncertain_end?'?':''}`;
  let rel = '';
  const out = outgoing[d.id] || [], inc = incoming[d.id] || [];
  if (out.length || inc.length){
    rel = '<div class="rel"><b>계보 연결</b>' +
      inc.map(e => relLabel(e,'in')).concat(out.map(e => relLabel(e,'out'))).join('<br>') +
      '</div>';
  }
  const footHtml = d.footnote ? linkify(d.footnote) : '';
  return `
    <h3>${d.name.replace(/\n/g,' ')}</h3>
    <div class="period">${period}</div>
    <div class="foot ${footHtml ? '' : 'empty'}">${footHtml || '수록된 출처 메모가 없습니다.'}</div>
    ${rel}
  `;
}

function getNodeSel(id){ return nodeSel.filter(n => n.id === id); }

function showTooltip(d, evt){
  activeId = d.id;
  tooltip.innerHTML = '<button class="close-btn" id="tt-close">✕</button>' + buildTooltipContent(d);
  document.getElementById('tt-close').onclick = hideTooltip;
  tooltip.classList.add('visible');
  nodeSel.classed('active', n => n.id === d.id);
  highlightConnections(d.id);
  expandNode(getNodeSel(d.id), d);
  if (!isTouch && evt){
    const pad = 16;
    let left = evt.clientX + pad, top = evt.clientY + pad;
    const maxLeft = window.innerWidth - 380, maxTop = window.innerHeight - 340;
    if (left > maxLeft) left = evt.clientX - 376;
    if (top > maxTop) top = Math.max(10, maxTop);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
}

function hideTooltip(){
  tooltip.classList.remove('visible');
  if (activeId){
    const prev = orgById[activeId];
    if (prev) collapseNode(getNodeSel(prev.id), prev);
  }
  activeId = null;
  nodeSel.classed('active', false);
  clearHighlight();
}

function highlightConnections(id){
  const related = new Set([id]);
  edges.forEach(e => { if (e.from === id) related.add(e.to); if (e.to === id) related.add(e.from); });
  nodeSel.classed('dimmed', n => !related.has(n.id));
  edgeSel.classed('edge-dimmed', e => e.from !== id && e.to !== id);
  edgeSel.classed('edge-highlight', e => e.from === id || e.to === id);
}
function clearHighlight(){
  nodeSel.classed('dimmed', false);
  edgeSel.classed('edge-dimmed', false);
  edgeSel.classed('edge-highlight', false);
}

// Use pointerdown/pointerup with a movement threshold instead of 'click' so taps
// register reliably on touch devices even while d3.zoom captures the gesture.
let pDownPos = null, pDownId = null;
nodeSel.on('pointerdown', function(evt, d){
  pDownPos = [evt.clientX, evt.clientY];
  pDownId = d.id;
});
nodeSel.on('pointerup', function(evt, d){
  if (!pDownPos || pDownId !== d.id){ pDownPos = null; return; }
  const dist = Math.hypot(evt.clientX - pDownPos[0], evt.clientY - pDownPos[1]);
  pDownPos = null;
  if (dist > 6) return;
  evt.stopPropagation();
  if (activeId === d.id){ hideTooltip(); return; }
  showTooltip(d, evt);
});
// Swallow the browser's synthetic click (fired after pointerup) so it doesn't
// bubble to the stage's outside-click handler and immediately close the tooltip.
nodeSel.on('click', evt => evt.stopPropagation());

if (!isTouch){
  nodeSel.on('mouseenter', function(evt, d){
    if (activeId) return;
    tooltip.innerHTML = buildTooltipContent(d);
    tooltip.classList.add('visible');
    highlightConnections(d.id);
    expandNode(d3.select(this), d);
    const pad = 16;
    let left = evt.clientX + pad, top = evt.clientY + pad;
    const maxLeft = window.innerWidth - 380, maxTop = window.innerHeight - 340;
    if (left > maxLeft) left = evt.clientX - 376;
    if (top > maxTop) top = Math.max(10, maxTop);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }).on('mousemove', function(evt, d){
    if (activeId) return;
    const pad = 16;
    let left = evt.clientX + pad, top = evt.clientY + pad;
    const maxLeft = window.innerWidth - 380, maxTop = window.innerHeight - 340;
    if (left > maxLeft) left = evt.clientX - 376;
    if (top > maxTop) top = Math.max(10, maxTop);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }).on('mouseleave', function(evt, d){
    if (activeId) return;
    tooltip.classList.remove('visible');
    clearHighlight();
    collapseNode(d3.select(this), d);
  });
}

document.getElementById('stage').addEventListener('click', () => { if (activeId) hideTooltip(); });
document.getElementById('tt-close').addEventListener('click', hideTooltip);

// ---------- Search ----------
const searchInput = document.getElementById('search');
let searchMatches = [];
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q){
    nodeSel.classed('highlight', false).classed('dimmed', false);
    return;
  }
  searchMatches = orgs.filter(o => o.name.toLowerCase().includes(q));
  const matchIds = new Set(searchMatches.map(o => o.id));
  nodeSel.classed('highlight', o => matchIds.has(o.id));
  nodeSel.classed('dimmed', o => q.length > 0 && !matchIds.has(o.id));
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchMatches.length){
    const d = searchMatches[0];
    const {w, h} = getStageSize();
    const targetX = w/2 - (d.x + d.renderW/2);
    const targetY = h/2 - (d.y + BOX_H/2);
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(targetX, targetY).scale(1));
  }
});

})();

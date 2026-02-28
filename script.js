// ═══════════════════════════════════════════════════════
//  McCabe-Thiele Calculator  |  script.js
//  Antoine data: Yaws Handbook (Organic, °C)
//  log₁₀(P/mmHg) = A − B/(T+C)   T in °C
// ═══════════════════════════════════════════════════════

'use strict';

// ── State ──────────────────────────────────────────────
let pyodide = null, pyReady = false;
let compA = null, compB = null;
let lastResults = null;

// ── Pressure conversion → mmHg ─────────────────────────
function toMmHg(val, unit) {
  const f = { mmHg:1, atm:760, bar:750.062, kPa:7.50062 };
  return val * (f[unit] || 1);
}

// ── Antoine: log10(P/mmHg) = A - B/(T+C), T in °C ──────
function antoineP(comp, T_C) {
  return Math.pow(10, comp.A - comp.B / (T_C + comp.C));
}

// ── Bubble-point temperature (binary, given x, P_total) ─
// Raoult: x*PA + (1-x)*PB = P_total
// Solve by bisection on T
function bubbleT(xA, P_total, compA, compB) {
  const Tlo = Math.max(compA.Tmin ?? -100, compB.Tmin ?? -100);
  const Thi = Math.min(compA.Tmax ?? 500,  compB.Tmax ?? 500);
  const f = T => xA * antoineP(compA, T) + (1 - xA) * antoineP(compB, T) - P_total;
  if (f(Tlo) * f(Thi) > 0) {
    // expand range a bit
    const T1 = Tlo - 50, T2 = Thi + 50;
    if (f(T1) * f(T2) > 0) return NaN;
    return bisect(f, T1, T2);
  }
  return bisect(f, Tlo, Thi);
}

function bisect(f, lo, hi, tol=1e-6, maxIter=60) {
  let flo = f(lo), fhi = f(hi);
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tol || (hi - lo) / 2 < tol) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; }
    else              { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// ── Equilibrium y from x (constant alpha) ───────────────
function equilY(x, alpha) {
  return alpha * x / (1 + (alpha - 1) * x);
}
function equilX(y, alpha) {
  return y / (alpha - (alpha - 1) * y);
}

// ── Calculate average alpha at operating P ───────────────
function calcAlpha(P_mmHg) {
  if (!compA || !compB) return null;
  // evaluate alpha at several x values, return geometric mean
  const xs = [0.1, 0.3, 0.5, 0.7, 0.9];
  const alphas = [];
  for (const x of xs) {
    const T = bubbleT(x, P_mmHg, compA, compB);
    if (isNaN(T)) continue;
    const PA = antoineP(compA, T);
    const PB = antoineP(compB, T);
    if (PB > 0) alphas.push(PA / PB);
  }
  if (!alphas.length) return null;
  const geoMean = Math.pow(alphas.reduce((a,b)=>a*b,1), 1/alphas.length);
  return geoMean;
}

// ── Autocomplete search ──────────────────────────────────
function setupSearch(inputId, suggestId, chipId, antoineId, onSelect) {
  const inp  = document.getElementById(inputId);
  const sbox = document.getElementById(suggestId);
  const chip = document.getElementById(chipId);
  const abox = document.getElementById(antoineId);

  let debTimer = null;

  inp.addEventListener('input', () => {
    clearTimeout(debTimer);
    debTimer = setTimeout(() => {
      const q = inp.value.trim().toLowerCase();
      if (q.length < 2) { sbox.style.display='none'; return; }
      const hits = ANTOINE_DATA.filter(d =>
        d.name.toLowerCase().includes(q) || d.formula.toLowerCase().includes(q)
      ).slice(0, 40);
      if (!hits.length) { sbox.style.display='none'; return; }
      sbox.innerHTML = hits.map(d =>
        `<div class="s-item" data-name="${d.name}">
          <span>${d.name}</span>
          <span class="s-formula">${d.formula}</span>
        </div>`
      ).join('');
      sbox.style.display = 'block';
      sbox.querySelectorAll('.s-item').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          const name = el.dataset.name;
          const comp = ANTOINE_DATA.find(d => d.name === name);
          onSelect(comp);
          inp.value = '';
          sbox.style.display = 'none';
        });
      });
    }, 160);
  });

  inp.addEventListener('blur', () => setTimeout(()=>{ sbox.style.display='none'; }, 200));
  inp.addEventListener('focus', () => { if (inp.value.length>=2) inp.dispatchEvent(new Event('input')); });

  function showChip(comp) {
    chip.innerHTML = `<div class="cmp-chip">
      <i class="fas fa-atom" style="font-size:10px"></i>
      ${comp.name} <span style="opacity:.7;font-size:10px">(${comp.formula})</span>
      <button onclick="clearComp('${inputId}')">✕</button>
    </div>`;
    abox.innerHTML = `
      <div class="ai-row"><span class="ai-label">A</span><span class="ai-val">${comp.A}</span></div>
      <div class="ai-row"><span class="ai-label">B</span><span class="ai-val">${comp.B}</span></div>
      <div class="ai-row"><span class="ai-label">C</span><span class="ai-val">${comp.C}</span></div>
      <div class="ai-row"><span class="ai-label">T range</span><span class="ai-val">${comp.Tmin ?? '?'} – ${comp.Tmax ?? '?'} °C</span></div>
      <div class="ai-row"><span class="ai-label">Formula</span><span class="ai-val">${comp.formula}</span></div>`;
    abox.classList.add('show');
  }

  return { showChip };
}

// ── Clear compound ───────────────────────────────────────
function clearComp(inputId) {
  if (inputId === 'searchA') {
    compA = null;
    document.getElementById('chipA').innerHTML = '';
    document.getElementById('antoineA').classList.remove('show');
  } else {
    compB = null;
    document.getElementById('chipB').innerHTML = '';
    document.getElementById('antoineB').classList.remove('show');
  }
  refreshAlpha();
  document.getElementById('calcBtn').disabled = true;
}

// ── Refresh alpha display ────────────────────────────────
function refreshAlpha() {
  const box  = document.getElementById('alphaBox');
  const valEl= document.getElementById('alphaVal');
  const noteEl=document.getElementById('alphaNote');

  if (!compA || !compB) { box.classList.remove('show'); return; }

  const P = toMmHg(parseFloat(document.getElementById('pressure').value) || 760,
                    document.getElementById('pressUnit').value);
  const override = document.getElementById('alphaOverride').value;

  if (override && parseFloat(override) > 0) {
    valEl.textContent = parseFloat(override).toFixed(4);
    noteEl.textContent = 'Manual override';
    box.classList.add('show');
    document.getElementById('calcBtn').disabled = !pyReady;
    return;
  }

  const alpha = calcAlpha(P);
  if (!alpha || isNaN(alpha)) {
    valEl.textContent = 'N/A';
    noteEl.textContent = 'T range mismatch — use manual override';
    box.classList.add('show');
    return;
  }

  valEl.textContent = alpha.toFixed(4);
  const T50 = bubbleT(0.5, P, compA, compB);
  noteEl.textContent = `Geometric mean α at ${P.toFixed(0)} mmHg · T(x=0.5)=${isNaN(T50)?'?':T50.toFixed(1)}°C`;
  box.classList.add('show');
  document.getElementById('calcBtn').disabled = !pyReady;
  document.getElementById('footerSys').textContent =
    `${compA.name}  /  ${compB.name}`;
}

// ── McCabe-Thiele calculation (JS, no Pyodide needed) ────
function mccabeThiele({ alpha, xD, xB, zF, R, q }) {
  // q-line: slope = q/(q-1), intercept = zF/(1-q) when q≠1
  // feed intersection with rectifying line
  const rectSlope = R / (R + 1);
  const rectInt   = xD / (R + 1);

  // q-line intersection with equilibrium curve
  // y = q/(q-1)*x - zF/(q-1)   (q≠1)
  // y = zF  (q=1, vertical)
  let xFeed, yFeed;
  if (Math.abs(q - 1) < 1e-9) {
    xFeed = zF;
    yFeed = rectSlope * zF + rectInt;
  } else {
    const qSlope = q / (q - 1);
    const qInt   = -zF / (q - 1);
    // intersect rectifying and q-line
    // rectSlope*x + rectInt = qSlope*x + qInt
    xFeed = (qInt - rectInt) / (rectSlope - qSlope);
    yFeed = rectSlope * xFeed + rectInt;
  }

  // Stripping line: through (xB,xB) and (xFeed,yFeed)
  const stripSlope = (yFeed - xB) / (xFeed - xB);
  const stripInt   = xB - stripSlope * xB;

  // Stage stepping: start from (xD, xD), step down
  const stages = [];
  let x = xD, y = xD;
  let section = 'Rectifying';
  const MAX = 80;

  for (let i = 0; i < MAX; i++) {
    // From point (x, y) on operating line → go horizontal to equilibrium curve
    // Find x_eq such that equilY(x_eq, alpha) = y  =>  x_eq = y / (alpha-(alpha-1)*y)
    const xEq = equilX(y, alpha);
    stages.push({ stage: stages.length + 1, x: xEq, y, section });

    if (xEq <= xB + 1e-6) break;

    // Determine which operating line to use (switch at feed stage)
    if (section === 'Rectifying' && xEq <= xFeed) section = 'Stripping';

    // New y from operating line at x = xEq
    y = section === 'Rectifying'
      ? rectSlope * xEq + rectInt
      : stripSlope * xEq + stripInt;

    y = Math.max(xB, Math.min(xD, y));
  }

  return { stages, xFeed, yFeed, rectSlope, rectInt, stripSlope, stripInt };
}

// ── Build VLE table (using bubble-T) ────────────────────
function buildVLE(alpha, P_mmHg) {
  const rows = [];
  const xs = Array.from({length:21}, (_,i) => i/20);
  for (const x of xs) {
    const y = equilY(x, alpha);
    let T = NaN, PA = NaN, PB = NaN;
    if (compA && compB) {
      T  = bubbleT(x, P_mmHg, compA, compB);
      PA = isNaN(T) ? NaN : antoineP(compA, T);
      PB = isNaN(T) ? NaN : antoineP(compB, T);
    }
    rows.push({ x, y, T, PA, PB });
  }
  return rows;
}

// ── Create Plotly chart ──────────────────────────────────
function createPlot(res, alpha, xD, xB, zF, R, q) {
  const { stages, xFeed, yFeed, rectSlope, rectInt, stripSlope, stripInt } = res;
  const P_mmHg = toMmHg(
    parseFloat(document.getElementById('pressure').value) || 760,
    document.getElementById('pressUnit').value
  );

  // Equilibrium curve (smooth)
  const xEq = Array.from({length:201}, (_,i) => i/200);
  const yEq = xEq.map(x => equilY(x, alpha));

  // Operating lines
  const xRectLine = [xFeed, xD];
  const yRectLine = xRectLine.map(x => rectSlope*x + rectInt);
  const xStripLine = [xB, xFeed];
  const yStripLine = xStripLine.map(x => stripSlope*x + stripInt);

  // q-line
  let xQL, yQL;
  if (Math.abs(q-1) < 1e-9) {
    xQL = [zF, zF]; yQL = [zF, yFeed];
  } else {
    const qS = q/(q-1), qI = -zF/(q-1);
    xQL = [xB, xD]; yQL = xQL.map(x => qS*x + qI);
  }

  // Stage staircase
  const xStair = [], yStair = [];
  let prevX = xD, prevY = xD;
  for (const s of stages) {
    xStair.push(prevX, s.x);
    yStair.push(prevY, prevY);   // horizontal
    xStair.push(s.x, s.x);
    yStair.push(prevY, s.section==='Rectifying'
      ? rectSlope * s.x + rectInt
      : Math.max(xB, stripSlope * s.x + stripInt));  // vertical
    prevX = s.x;
    prevY = yStair[yStair.length - 1];
  }

  const sysName = compA && compB ? `${compA.name} / ${compB.name}` : 'System';

  const traces = [
    { x: xEq, y: yEq, mode:'lines', name:'Equilibrium Curve', line:{color:'#1a237e',width:3} },
    { x:[0,1], y:[0,1], mode:'lines', name:'y = x', line:{color:'#9e9e9e',width:1.5,dash:'dash'} },
    { x: xRectLine, y: yRectLine, mode:'lines', name:'Rectifying OL', line:{color:'#0d6efd',width:2.5} },
    { x: xStripLine, y: yStripLine, mode:'lines', name:'Stripping OL', line:{color:'#198754',width:2.5} },
    { x: xQL, y: yQL, mode:'lines', name:'q-line', line:{color:'#fd7e14',width:2,dash:'dot'} },
    { x: xStair, y: yStair, mode:'lines', name:`Stages (${stages.length})`,
      line:{color:'#dc3545',width:2} },
    { x:[xD], y:[xD], mode:'markers+text', name:'xD',
      marker:{color:'#0d6efd',size:11,symbol:'diamond'},
      text:['xD'], textposition:'top right', textfont:{size:12} },
    { x:[xB], y:[xB], mode:'markers+text', name:'xB',
      marker:{color:'#198754',size:11,symbol:'diamond'},
      text:['xB'], textposition:'top right', textfont:{size:12} },
    { x:[zF], y:[yFeed], mode:'markers+text', name:'Feed (zF)',
      marker:{color:'#fd7e14',size:10,symbol:'circle'},
      text:['F'], textposition:'top right', textfont:{size:12} },
  ];

  const layout = {
    title: { text: `<b>McCabe-Thiele: ${sysName}</b><br><sup>α = ${alpha.toFixed(4)}, R = ${R}, Stages = ${stages.length}</sup>`,
      font:{size:15}, x:0.5 },
    xaxis: { title:'x (Liquid mole fraction)', range:[0,1], showgrid:true, gridcolor:'#e9ecef',
      zeroline:true, showline:true, mirror:true, linecolor:'#adb5bd' },
    yaxis: { title:'y (Vapor mole fraction)', range:[0,1], showgrid:true, gridcolor:'#e9ecef',
      zeroline:true, showline:true, mirror:true, linecolor:'#adb5bd' },
    legend:{ x:0.01, y:0.99, bgcolor:'rgba(255,255,255,0.9)', bordercolor:'#dee2e6', borderwidth:1 },
    plot_bgcolor:'#fafafa', paper_bgcolor:'white',
    margin:{ l:60, r:30, t:80, b:60 },
    height: 560
  };

  Plotly.newPlot('plotDiv', traces, layout, {responsive:true});
}

// ── Show results ─────────────────────────────────────────
function showResults(res, alpha, P_mmHg, xD, xB, zF, R, q) {
  const { stages } = res;
  const nTotal = stages.length;
  const nRect  = stages.filter(s=>s.section==='Rectifying').length;
  const nStrip = nTotal - nRect;
  const feedStage = nRect;

  // Summary grid
  const Rmin = calcRmin(alpha, zF, q);
  document.getElementById('summaryGrid').innerHTML = `
    <div class="s-item hl"><div class="s-label">Theoretical Stages</div><div class="s-val">${nTotal}</div></div>
    <div class="s-item hl"><div class="s-label">Feed Stage</div><div class="s-val">${feedStage}</div></div>
    <div class="s-item"><div class="s-label">Rectifying Stages</div><div class="s-val">${nRect}</div></div>
    <div class="s-item"><div class="s-label">Stripping Stages</div><div class="s-val">${nStrip}</div></div>
    <div class="s-item hl"><div class="s-label">α (constant)</div><div class="s-val">${alpha.toFixed(4)}</div></div>
    <div class="s-item"><div class="s-label">R / R<sub>min</sub></div><div class="s-val">${Rmin?(R/Rmin).toFixed(2):'—'}</div></div>
    <div class="s-item"><div class="s-label">R<sub>min</sub></div><div class="s-val">${Rmin?Rmin.toFixed(4):'—'}</div></div>
    <div class="s-item"><div class="s-label">Reflux Ratio R</div><div class="s-val">${R}</div></div>
  `;
  document.getElementById('summaryCard').style.display = 'block';

  // Stages table
  document.getElementById('stagesBody').innerHTML = stages.map(s =>
    `<tr><td>${s.stage}</td><td>${s.x.toFixed(5)}</td><td>${s.y.toFixed(5)}</td><td>${s.section}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="text-center text-muted">No stages</td></tr>';

  // VLE table
  const vle = buildVLE(alpha, P_mmHg);
  document.getElementById('vleBody').innerHTML = vle.map(r =>
    `<tr>
      <td>${r.x.toFixed(2)}</td>
      <td>${r.y.toFixed(5)}</td>
      <td>${isNaN(r.T)?'—':r.T.toFixed(2)}</td>
      <td>${isNaN(r.PA)?'—':r.PA.toFixed(2)}</td>
      <td>${isNaN(r.PB)?'—':r.PB.toFixed(2)}</td>
    </tr>`
  ).join('');

  // Params table
  document.getElementById('paramsBody').innerHTML = `
    <tr><td>System</td><td>${compA?compA.name:'?'} / ${compB?compB.name:'?'}</td></tr>
    <tr><td>α (constant, avg)</td><td>${alpha.toFixed(6)}</td></tr>
    <tr><td>Operating pressure</td><td>${P_mmHg.toFixed(2)} mmHg</td></tr>
    <tr><td>x<sub>D</sub></td><td>${xD}</td></tr>
    <tr><td>x<sub>B</sub></td><td>${xB}</td></tr>
    <tr><td>z<sub>F</sub></td><td>${zF}</td></tr>
    <tr><td>R (reflux ratio)</td><td>${R}</td></tr>
    <tr><td>q (feed quality)</td><td>${q}</td></tr>
    <tr><td>R<sub>min</sub></td><td>${Rmin?Rmin.toFixed(4):'—'}</td></tr>
    <tr><td>R / R<sub>min</sub></td><td>${Rmin?(R/Rmin).toFixed(2):'—'}</td></tr>
    <tr><td>Total theoretical stages</td><td>${nTotal}</td></tr>
    <tr><td>Feed stage (from top)</td><td>${feedStage}</td></tr>
    <tr><td>Antoine equation</td><td>log₁₀(P/mmHg) = A − B/(T+C), T in °C</td></tr>
    ${compA?`<tr><td>A: Antoine A,B,C</td><td>${compA.A} / ${compA.B} / ${compA.C}</td></tr>`:''}
    ${compB?`<tr><td>B: Antoine A,B,C</td><td>${compB.A} / ${compB.B} / ${compB.C}</td></tr>`:''}
  `;

  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('exportBtn').disabled = false;
  lastResults = { stages, vle, alpha, xD, xB, zF, R, q };
}

// ── Rmin (Underwood / simple method for constant α) ─────
function calcRmin(alpha, zF, q) {
  // Underwood: sum xi/(alpha_i - theta) = 1-q
  // For binary: alpha_A/(alpha-theta) + 1/(1-theta) = 1-q
  // Then Rmin+1 = alpha*xD/(alpha-theta) + xD(1-alpha)/(1-theta)  ... simplified:
  // For binary constant alpha, Underwood theta satisfies:
  // alpha*zF/(alpha-theta) + (1-zF)/(1-theta) = 1 - q
  // then: Rmin+1 = alpha*xD/(alpha-theta) + (1-xD)/(1-theta) ... no, use:
  // At minimum reflux, pinch at feed:
  try {
    const xD = parseFloat(document.getElementById('xD').value);
    // find theta in (1, alpha) by bisection
    const f = th => alpha*zF/(alpha-th) + (1-zF)/(1-th) - (1-q);
    const theta = bisect(f, 1+1e-9, alpha-1e-9);
    if (isNaN(theta)) return null;
    const Vmin = alpha*xD/(alpha-theta) + (1-xD)/(1-theta);
    const Rmin = Vmin - 1;
    return Rmin > 0 ? Rmin : null;
  } catch { return null; }
}

// ── Export CSV ───────────────────────────────────────────
function exportCSV() {
  if (!lastResults) return;
  const { stages, vle, alpha, xD, xB, zF, R, q } = lastResults;
  let csv = `McCabe-Thiele Results\n`;
  csv += `System,${compA?compA.name:'?'} / ${compB?compB.name:'?'}\n`;
  csv += `alpha,${alpha}\nxD,${xD}\nxB,${xB}\nzF,${zF}\nR,${R}\nq,${q}\n\n`;
  csv += `Stage,x,y,Section\n`;
  stages.forEach(s => { csv += `${s.stage},${s.x},${s.y},${s.section}\n`; });
  csv += `\nx,y_equil,T_C,PA_mmHg,PB_mmHg\n`;
  vle.forEach(r => { csv += `${r.x},${r.y.toFixed(6)},${isNaN(r.T)?'':r.T.toFixed(3)},${isNaN(r.PA)?'':r.PA.toFixed(3)},${isNaN(r.PB)?'':r.PB.toFixed(3)}\n`; });
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mccabe_thiele.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported!', 'success');
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type='info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast align-items-center text-white bg-${type} border-0`;
  t.setAttribute('role','alert');
  t.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  c.appendChild(t);
  new bootstrap.Toast(t, {delay:3000}).show();
  t.addEventListener('hidden.bs.toast', ()=>t.remove());
}

// ── Init Pyodide (only needed for potential future use) ──
async function initPyodide() {
  const prog    = document.getElementById('pyProg');
  const progTxt = document.getElementById('pyProgTxt');
  const loadDiv = document.getElementById('pyLoading');
  const status  = document.getElementById('pyStatus');
  loadDiv.style.display = 'flex';

  const steps = [
    {pct:'30%', msg:'Loading Pyodide core…',   fn: async()=>{ pyodide = await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/'}); }},
    {pct:'65%', msg:'Loading NumPy…',           fn: async()=>{ await pyodide.loadPackage('numpy'); }},
    {pct:'90%', msg:'Loading SciPy…',           fn: async()=>{ await pyodide.loadPackage('scipy'); }},
    {pct:'100%',msg:'Ready!',                   fn: async()=>{}},
  ];
  try {
    for (const s of steps) {
      progTxt.textContent = s.msg;
      prog.style.width = s.pct; prog.textContent = s.pct;
      await s.fn();
    }
    status.className = 'alert alert-success py-2 mb-2';
    status.innerHTML = '<i class="fas fa-check-circle me-1"></i> Python ready';
    pyReady = true;
    // Enable calc btn if both compounds selected
    if (compA && compB) document.getElementById('calcBtn').disabled = false;
  } catch(e) {
    status.className = 'alert alert-warning py-2 mb-2';
    status.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i> Pyodide unavailable — JS fallback active';
    pyReady = true; // JS-only mode still works
    if (compA && compB) document.getElementById('calcBtn').disabled = false;
  } finally {
    setTimeout(()=>{ loadDiv.style.display='none'; }, 400);
  }
}

// ── DOMContentLoaded ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Setup autocomplete for both compounds
  const srchA = setupSearch('searchA','suggestA','chipA','antoineA', comp => {
    compA = comp;
    srchA.showChip(comp);
    refreshAlpha();
  });
  const srchB = setupSearch('searchB','suggestB','chipB','antoineB', comp => {
    compB = comp;
    srchB.showChip(comp);
    refreshAlpha();
  });

  // Pressure / unit changes
  ['pressure','pressUnit','alphaOverride'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', refreshAlpha);
    document.getElementById(id)?.addEventListener('input', refreshAlpha);
  });

  // q selector
  document.getElementById('qSel').addEventListener('change', function() {
    document.getElementById('customQDiv').style.display = this.value==='custom' ? 'block':'none';
  });

  // Calculate
  document.getElementById('calcBtn').addEventListener('click', () => {
    const xD = parseFloat(document.getElementById('xD').value);
    const xB = parseFloat(document.getElementById('xB').value);
    const zF = parseFloat(document.getElementById('zF').value);
    const R  = parseFloat(document.getElementById('R').value);
    const qEl= document.getElementById('qSel').value;
    const q  = qEl==='custom' ? parseFloat(document.getElementById('customQ').value) : parseFloat(qEl);

    // Validation
    if (xD <= xB) { toast('xD must be greater than xB', 'danger'); return; }
    if (zF <= xB || zF >= xD) { toast('zF must be between xB and xD', 'danger'); return; }
    if (R <= 0) { toast('Reflux ratio R must be > 0', 'danger'); return; }

    const P_mmHg = toMmHg(parseFloat(document.getElementById('pressure').value)||760,
                           document.getElementById('pressUnit').value);
    const override = parseFloat(document.getElementById('alphaOverride').value);
    let alpha = (!isNaN(override) && override > 0) ? override : calcAlpha(P_mmHg);

    if (!alpha || isNaN(alpha) || alpha <= 1) {
      toast('Cannot compute α — please set Manual Override', 'danger'); return;
    }

    document.getElementById('calcLoading').style.display = 'flex';
    setTimeout(() => {
      try {
        const res = mccabeThiele({ alpha, xD, xB, zF, R, q });
        createPlot(res, alpha, xD, xB, zF, R, q);
        showResults(res, alpha, P_mmHg, xD, xB, zF, R, q);
        toast(`✅ Done: ${res.stages.length} theoretical stages`, 'success');
      } catch(e) {
        toast('Error: ' + e.message, 'danger');
        console.error(e);
      } finally {
        document.getElementById('calcLoading').style.display = 'none';
      }
    }, 50);
  });

  document.getElementById('exportBtn').addEventListener('click', exportCSV);

  // Start Pyodide (background, not blocking)
  initPyodide();
});

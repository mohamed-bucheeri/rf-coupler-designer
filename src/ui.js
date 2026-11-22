'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const sheet = $('sheet');
  const num = (x, n = 3) => isFinite(x) ? String(parseFloat(x.toPrecision(n))) : '–';
  const fmtL = v => v < 1e-6 ? num(v * 1e9) + ' nH' : num(v * 1e6) + ' µH';
  const fmtC = v => v < 1e-9 ? num(v * 1e12) + ' pF' : num(v * 1e9) + ' nF';
  const fmtR = v => v >= 1000 ? num(v / 1000) + ' kΩ' : num(v) + ' Ω';
  const fmtF = (v, n = 3) => v >= 1e9 ? num(v / 1e9, n) + ' GHz' : v >= 1e6 ? num(v / 1e6, n) + ' MHz' : num(v / 1e3, n) + ' kHz';
  const fmtLen = mm => mm >= 1000 ? num(mm / 1000) + ' m' : mm >= 10 ? num(mm) + ' mm' : mm.toFixed(2) + ' mm';
  const fmtV = (kind, v) => kind === 'L' ? fmtL(v) : kind === 'C' ? fmtC(v) : kind === 'R' ? fmtR(v) : num(v) + ' Ω';
  const sci = x => { const e = Math.floor(Math.log10(Math.abs(x))); return (x / 10 ** e).toFixed(3) + '×10' + String(e).replace(/[0-9]/g, c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]); };
  const dBs = (x, d = 1) => x < -60 ? 'below −60' : x.toFixed(d).replace('-', '−');
  const band = c => `${num(c.f1 / funitOf(c.f2), 4)}–${fmtF(c.f2, 4)}`;
  const funitOf = f => f >= 1e9 ? 1e9 : f >= 1e6 ? 1e6 : 1e3;
  const ICON = {
    ok: '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="var(--good)"/><path d="M7.5 13.5l3.6 3.6 7.4-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bad: '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="3" fill="var(--crit)"/><path d="M8 8l10 10M18 8L8 18" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    busy: '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="none" stroke="var(--ink-3)" stroke-width="2"/><path d="M13 7v6.5l4 2.5" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-linecap="round"/></svg>',
    crit: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l8.5 15h-17z" fill="var(--crit)"/><path d="M10 7.5v4.5M10 14.4v.2" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></svg>',
    warn: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l8.5 15h-17z" fill="var(--warn)"/><path d="M10 7.5v4.5M10 14.4v.2" stroke="#1a1a1a" stroke-width="1.9" stroke-linecap="round"/></svg>',
    tip: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--accent)" stroke-width="1.8"/><path d="M10 9v5M10 6v.2" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round"/></svg>'
  };

  /* ---------- form ---------- */
  const radio = name => document.querySelector(`input[name=${name}]:checked`).value;
  const val = id => parseFloat($(id).value);
  const PRESETS = { 'fr4-16': [4.4, 0.02, 1.6, 0.035], 'fr4-08': [4.4, 0.02, 0.8, 0.035], jlc4: [4.4, 0.02, 0.2104, 0.035], ro4350: [3.66, 0.0037, 0.508, 0.035] };
  function readCfg() {
    const mult = { kHz: 1e3, MHz: 1e6, GHz: 1e9 }[$('funit').value];
    return {
      circuit: radio('circuit'), tech: radio('tech'), f1: val('f1') * mult, f2: val('f2') * mult, z0: val('z0'),
      sections: +radio('sections'), cells: +radio('cells'), optimise: $('opt').checked,
      spec: { rl: val('spec'), imb: 0.5, ph: 5 },
      sub: { er: val('er'), tand: val('tand'), h: val('h'), b: val('b'), t: val('t'), wmin: val('wmin') },
      parts: { lcSeries: $('lcSeries').value, rSeries: $('rSeries').value, qL: val('qL'), qC: val('qC') },
      tol: { L: val('tolL') / 100, C: val('tolC') / 100, R: val('tolR') / 100, er: val('tolEr'), w: val('tolW') / 100 }
    };
  }
  function problem(c) {
    const pos = v => isFinite(v) && v > 0;
    if (!pos(c.f1) || !pos(c.f2)) return 'Enter both ends of the frequency band as positive numbers.';
    if (c.f2 <= c.f1) return 'The band must end at a higher frequency than it starts. Swap the two values.';
    if (c.f2 / c.f1 > 8) return 'This band is wider than 8:1. None of these circuits can cover it. Try a narrower band.';
    if (!pos(c.z0)) return 'Enter the system impedance in ohms, for example 50.';
    if (!(c.spec.rl >= 3 && c.spec.rl <= 40)) return 'Enter a target between 3 and 40 dB.';
    if (c.tech !== 'lumped') {
      if (!(c.sub.er > 1)) return 'The dielectric constant must be greater than 1.';
      if (!(c.sub.tand >= 0) || !(c.sub.t >= 0)) return 'Loss tangent and copper thickness cannot be negative.';
      if (c.tech === 'ms' && !pos(c.sub.h)) return 'Enter the board thickness in mm.';
      if (c.tech === 'sl' && !(c.sub.b > 2.5 * c.sub.t)) return 'The ground-to-ground spacing must be several times the copper thickness.';
    } else if (!pos(c.parts.qL) || !pos(c.parts.qC)) return 'Enter the inductor and capacitor Q as positive numbers.';
    return null;
  }
  function syncForm() {
    const circuit = radio('circuit'), tech = radio('tech'), lumped = tech === 'lumped';
    $('row-sections').hidden = circuit === 'ratrace';
    $('sec-hint').textContent = circuit === 'branchline'
      ? 'Sections along each through line. 1 is the classic 4-arm square (2 branches), 2 adds a third branch, 3 a fourth. More sections cover a wider band but need very thin, high-impedance branches.'
      : 'More sections cover a wider band, with more parts and a little more loss.';
    $('grp-lumped').hidden = !lumped; $('grp-board').hidden = lumped;
    $('lab-h').hidden = tech !== 'ms'; $('lab-b').hidden = tech !== 'sl'; $('row-preset').hidden = tech !== 'ms';
    document.querySelectorAll('[data-l]').forEach(e => e.hidden = !lumped);
    document.querySelectorAll('[data-d]').forEach(e => e.hidden = lumped);
  }
  const SAVE = 'rf-coupler-designer-v1';
  function saveForm() {
    try {
      const o = {}; document.querySelectorAll('#form input, #form select').forEach(e => { if (e.type === 'radio') { if (e.checked) o['r:' + e.name] = e.value; } else o[e.id] = e.type === 'checkbox' ? e.checked : e.value; });
      localStorage.setItem(SAVE, JSON.stringify(o));
    } catch (e) { /* storage unavailable: nothing to do */ }
  }
  function loadForm() {
    try {
      const o = JSON.parse(localStorage.getItem(SAVE) || 'null'); if (!o) return;
      Object.keys(o).forEach(k => {
        if (k.startsWith('r:')) { const e = document.querySelector(`input[name=${k.slice(2)}][value="${o[k]}"]`); if (e) e.checked = true; }
        else { const e = $(k); if (e) { if (e.type === 'checkbox') e.checked = o[k]; else e.value = o[k]; } }
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------- compute ---------- */
  let run = 0, st = null, overlay = false;
  function compute() {
    run++; const my = run, cfg = readCfg(), bad = problem(cfg);
    if (bad) { st = null; sheet.innerHTML = `<div class="err"><b>Can't calculate yet.</b> ${bad}</div>`; return; }
    const d = RF.makeDesign(cfg);
    st = { cfg, d, spec: cfg.spec, formula: d.seed.slice(), opt: null, busy: null };
    finish();
    if (d.lumped && cfg.optimise && !st.sum.formula.pass) optimise(my);
  }
  function sweepOf(net, freqs) {
    const { d, spec } = st, o = { s11: [], s22: [], iso: [], thru: [], coup: [], viol: [], imb: [], phErr: [] };
    freqs.forEach(f => { const F = RF.figures(d.circuit, RF.simulate(net, f)); for (const k in F) o[k].push(F[k]); o.viol.push(RF.violation(d.circuit, F, spec)); });
    return o;
  }
  function finish() {
    const { d, cfg, spec } = st, base = st.opt || st.formula, fsB = RF.linspace(cfg.f1, cfg.f2, 41);
    const ref = RF.refineRounded(d, base, spec);
    st.use = ref.values; st.refChanged = ref.changed;
    st.phys = d.lumped ? null : d.physical(st.use);
    const netUse = d.build(st.use, { real: true, phys: st.phys }), netF = d.build(st.formula);
    st.sum = { formula: RF.bandSummary(d.circuit, netF, fsB, spec), opt: st.opt ? RF.bandSummary(d.circuit, d.build(st.opt), fsB, spec) : null, use: RF.bandSummary(d.circuit, netUse, fsB, spec) };
    // worst point of the buildable design
    const sb = sweepOf(netUse, fsB); let wi = 0; sb.viol.forEach((v, i) => { if (v > sb.viol[wi]) wi = i; });
    const cand = d.circuit === 'wilkinson'
      ? [['input match', sb.s11[wi] + spec.rl, dBs(sb.s11[wi]) + ' dB'], ['output match', sb.s22[wi] + spec.rl, dBs(sb.s22[wi]) + ' dB'], ['isolation', sb.iso[wi] + spec.rl, dBs(sb.iso[wi]) + ' dB']]
      : [['input match', sb.s11[wi] + spec.rl, dBs(sb.s11[wi]) + ' dB'], ['isolation', sb.iso[wi] + spec.rl, dBs(sb.iso[wi]) + ' dB'], ['amplitude imbalance', (sb.imb[wi] - spec.imb) * 6, sb.imb[wi].toFixed(2) + ' dB'], ['phase error', sb.phErr[wi] - spec.ph, sb.phErr[wi].toFixed(1) + '°']];
    cand.sort((a, b) => b[1] - a[1]); st.worst = { f: fsB[wi], what: cand[0][0], value: cand[0][2] };
    // plot sweep
    const span = cfg.f2 - cfg.f1, f0 = d.f0;
    const fa = Math.max(0.2 * cfg.f1, Math.min(cfg.f1 - 0.25 * span, 0.6 * f0)), fb = Math.max(cfg.f2 + 0.5 * span, 1.4 * f0);
    st.freqs = RF.linspace(fa, fb, 221);
    st.sw = { use: sweepOf(netUse, st.freqs), formula: sweepOf(netF, st.freqs) };
    // range around the centre where the buildable design passes
    let ic = 0; st.freqs.forEach((f, i) => { if (Math.abs(f - f0) < Math.abs(st.freqs[ic] - f0)) ic = i; });
    st.pass = null;
    const segs = [];
    for (let i = 0, a = -1; i <= st.freqs.length; i++) {
      const ok = i < st.freqs.length && st.sw.use.viol[i] <= 0.05;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) { segs.push([a, i - 1]); a = -1; }
    }
    const best = segs.find(g => g[0] <= ic && g[1] >= ic) || segs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (best && best[1] > best[0]) st.pass = [st.freqs[best[0]], st.freqs[best[1]]];
    st.mc = RF.monteCarlo(d, st.use, st.phys, spec, cfg.tol, 200);
    render();
  }
  function optimise(my) {
    const o = RF.makeOptimiser(st.d, st.spec);
    st.busy = { frac: 0 }; render();
    let last = 1e9, still = 0, g = 0, evals = 0;
    const chunk = () => {
      if (my !== run) return;
      const t = performance.now();
      while (performance.now() - t < 45 && g < o.gens) {
        o.de.step(); g++;
        if (last - o.de.bestVal < 0.005) { if (++still > 50) { evals = g; g = o.gens; } } else { still = 0; last = o.de.bestVal; }
      }
      const b = sheet.querySelector('.bar i'); if (b) b.style.width = Math.round(100 * g / o.gens) + '%';
      if (g < o.gens) setTimeout(chunk, 0);
      else { st.opt = o.values(); st.busy = null; st.optInfo = { dims: o.dims, gens: evals || o.gens }; finish(); }
    };
    setTimeout(chunk, 30);
  }

  /* ---------- schematic ---------- */
  function Sch() {
    const p = []; let W = 0, H = 0;
    const ext = (x, y) => { W = Math.max(W, x); H = Math.max(H, y); };
    const s = {
      wire(...pts) { p.push(`<polyline class="w" points="${pts.map(q => q.join(',')).join(' ')}"/>`); pts.forEach(q => ext(q[0], q[1])); },
      dot(x, y) { p.push(`<circle class="dot" cx="${x}" cy="${y}" r="2.8"/>`); },
      text(x, y, t, anchor = 'middle', cls = '') { p.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${t}</text>`); ext(x + 40, y + 4); },
      // component drawn along a straight segment
      comp(x1, y1, x2, y2, type, label, side = 1) {
        const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, mid = len / 2;
        let g = '';
        if (type === 'ind') { const a = mid - 22; g = `<path class="w" d="M0 0H${a}a5.5 5.5 0 0 1 11 0a5.5 5.5 0 0 1 11 0a5.5 5.5 0 0 1 11 0a5.5 5.5 0 0 1 11 0H${len}"/>`; }
        else if (type === 'res') g = `<path class="w" d="M0 0H${mid - 17}M${mid + 17} 0H${len}"/><rect class="w body" x="${mid - 17}" y="-6.5" width="34" height="13"/>`;
        else if (type === 'cap') g = `<path class="w" d="M0 0H${mid - 3.5}M${mid + 3.5} 0H${len}M${mid - 3.5} -10V10M${mid + 3.5} -10V10"/>`;
        else g = `<path class="w" d="M0 0H7M${len - 7} 0H${len}"/><rect class="w tl" x="7" y="-7.5" width="${len - 14}" height="15" rx="2"/>`;
        p.push(`<g transform="translate(${x1},${y1}) rotate(${ang})">${g}</g>`);
        if (label) {
          const horiz = Math.abs(y2 - y1) < 1, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          if (horiz) s.text(mx, my + (side > 0 ? -15 : 24), label);
          else s.text(mx + (side > 0 ? 14 : -14), my + 4, label, side > 0 ? 'start' : 'end');
        }
        ext(x1, y1); ext(x2, y2);
      },
      // element from a node to ground. dir: [dx,dy]
      shunt(x, y, dir, type, label) {
        const L = 42, x2 = x + dir[0] * L, y2 = y + dir[1] * L;
        s.comp(x, y, x2, y2, type, null);
        const ang = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
        p.push(`<g transform="translate(${x2},${y2}) rotate(${ang})"><path class="w" d="M0 -9V9M4.5 -5.5V5.5M9 -2V2"/></g>`);
        if (dir[0] === 0) s.text(x + 13, y + dir[1] * 21 + 4, label, 'start'); else s.text(x + dir[0] * 21, y - 15, label);
        ext(x2 + 14, y2 + 14);
      },
      port(x, y, dir, label) {
        const x2 = x + dir[0] * 30, y2 = y + dir[1] * 30;
        s.wire([x, y], [x2, y2]); p.push(`<circle class="w body" cx="${x2 + dir[0] * 4}" cy="${y2 + dir[1] * 4}" r="4"/>`);
        if (dir[0] !== 0) s.text(x2 + dir[0] * 14, y2 + 4, label, dir[0] > 0 ? 'start' : 'end', 'p');
        else s.text(x2, y2 + (dir[1] < 0 ? -12 : 22), label, 'middle', 'p');
        ext(x2 + (dir[0] > 0 ? 14 + label.length * 7.2 : 10), y2 + 10);
      },
      raw(h) { p.push(h); }, ext,
      svg() { return `<svg width="${Math.ceil(W + 14)}" height="${Math.ceil(H + 14)}" viewBox="0 0 ${Math.ceil(W + 14)} ${Math.ceil(H + 14)}" role="img" aria-label="Schematic">${p.join('')}</svg>`; }
    };
    return s;
  }
  function schematic() {
    const { d, cfg } = st, s = Sch(), m = d.m, lum = d.lumped, UP = [0, -1], DN = [0, 1], LT = [-1, 0], RT = [1, 0];
    if (d.circuit === 'wilkinson') {
      const N = d.N, cw = lum ? (m === 1 ? 118 : 96) : 150, xs = 172, yt = 72, yb = 222, ym = 147;
      s.port(106, ym, LT, 'Input'); s.wire([106, ym], [xs, ym]); s.wire([xs, yt], [xs, yb]); s.dot(xs, ym);
      if (lum) { s.shunt(134, ym, DN, 'cap', 'C0'); s.dot(134, ym); }
      [yt, yb].forEach((y, br) => {
        let x = xs;
        for (let k = 0; k < N; k++) for (let c = 0; c < m; c++) {
          s.comp(x, y, x + cw, y, lum ? 'ind' : 'tl', (lum ? 'L' : 'TL') + (k + 1), br ? -1 : 1); x += cw;
          if (lum) { s.shunt(x, y, br ? DN : UP, 'cap', c === m - 1 ? 'C' + (k + 1) : 'C' + (k + 1) + 'm'); }
          s.dot(x, y);
        }
        s.port(x, y, RT, 'Output ' + (br + 1));
      });
      for (let k = 0; k < N; k++) { const x = xs + (k + 1) * m * cw; s.comp(x, yt, x, yb, 'res', 'R' + (k + 1), -1); }
      s.ext(0, yb + (lum ? 62 : 20));
    } else if (d.circuit === 'branchline') {
      const N = d.N, Gs = Math.ceil(N / 2), Gb = Math.floor(N / 2) + 1, gs = k => Math.min(k, N - 1 - k), gb = j => Math.min(j, N - j);
      const S = lum ? (N === 1 ? 150 : 132) * m : (N === 1 ? 190 : 150), V = lum ? 120 * m : 150, x1 = 170, y1 = lum ? 82 : 46, y2 = y1 + V, X = j => x1 + j * S;
      const arm = (ax, ay, bx, by, ref, cref, out, lab) => {
        for (let c = 0; c < m; c++) {
          const px = ax + (bx - ax) * c / m, py = ay + (by - ay) * c / m, qx = ax + (bx - ax) * (c + 1) / m, qy = ay + (by - ay) * (c + 1) / m;
          s.comp(px, py, qx, qy, lum ? 'ind' : 'tl', (lum ? 'L' : 'TL') + ref, lab);
          if (lum && c < m - 1) { s.shunt(qx, qy, out, 'cap', 'C' + cref); s.dot(qx, qy); }
        }
      };
      for (let k = 0; k < N; k++) {
        arm(X(k), y1, X(k + 1), y1, gs(k) + 1, Gb + gs(k) + 1, UP, 1);
        arm(X(k), y2, X(k + 1), y2, gs(k) + 1, Gb + gs(k) + 1, DN, -1);
      }
      for (let j = 0; j <= N; j++) arm(X(j), y1, X(j), y2, Gs + gb(j) + 1, Gb + Gs + gb(j) + 1, j === N ? RT : LT, j === N ? -1 : 1);
      for (let j = 0; j <= N; j++) {
        [[y1, UP], [y2, DN]].forEach(([y, cd]) => { s.dot(X(j), y); if (lum) s.shunt(X(j), y, cd, 'cap', 'C' + (gb(j) + 1)); });
      }
      s.port(X(0), y1, LT, '1 Input'); s.port(X(N), y1, RT, '2 Through'); s.port(X(N), y2, RT, '3 Coupled'); s.port(X(0), y2, LT, '4 Isolated');
      s.ext(0, y2 + (lum ? 62 : 24));
    } else if (lum) {
      const A = 150 * m, y = 104, xn = [96, 96 + A, 96 + 2 * A, 96 + 3 * A], order = ['2 Output A', '1 Sum Σ', '3 Output B', '4 Diff Δ'];
      for (let a = 0; a < 3; a++) for (let c = 0; c < m; c++) {
        const px = xn[a] + A * c / m, qx = xn[a] + A * (c + 1) / m;
        s.comp(px, y, qx, y, 'ind', a === 1 ? 'L2' : 'L1');
        if (c < m - 1) { s.shunt(qx, y, DN, 'cap', 'C3'); s.dot(qx, y); }
      }
      xn.forEach((x, i) => { s.dot(x, y); s.port(x, y, UP, order[i]); });
      s.shunt(xn[1], y, DN, 'cap', 'C1'); s.shunt(xn[2], y, DN, 'cap', 'C1');
      if (m > 1) { s.shunt(xn[0], y, DN, 'ind', 'L3'); s.shunt(xn[3], y, DN, 'ind', 'L3'); }
      const yl = y + 96, xl = xn[0] - 44, xr = xn[3] + 44, xm = (xl + xr) / 2;
      s.wire([xn[0], y], [xl, y], [xl, yl], [xm - 40, yl]); s.comp(xm - 40, yl, xm + 40, yl, 'cap', 'C2', -1); s.wire([xm + 40, yl], [xr, yl], [xr, y], [xn[3], y]);
      s.ext(xr + 10, yl + 26);
    } else {
      const cx = 250, cy = 150, r = 86, ports = [[180, '2 Output A'], [120, '1 Sum Σ'], [60, '3 Output B'], [0, '4 Diff Δ']];
      s.raw(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--ink)" stroke-width="11"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--accent-soft)" stroke-width="7.8"/>`);
      ports.forEach(([a, name]) => {
        const ca = Math.cos(a * Math.PI / 180), sa = -Math.sin(a * Math.PI / 180), x = cx + (r + 5) * ca, y = cy + (r + 5) * sa;
        s.wire([x, y], [x + 26 * ca, y + 26 * sa]); s.raw(`<circle class="w body" cx="${x + 30 * ca}" cy="${y + 30 * sa}" r="4"/>`);
        s.text(x + 42 * ca + (ca < -0.3 ? -4 : ca > 0.3 ? 4 : 0), y + 42 * sa + 4, name, ca < -0.3 ? 'end' : ca > 0.3 ? 'start' : 'middle', 'p');
      });
      [150, 90, 30].forEach(a => s.text(cx + (r - 24) * Math.cos(a * Math.PI / 180), cy - (r - 24) * Math.sin(a * Math.PI / 180) + 4, 'λ/4', 'middle', 'q'));
      s.text(cx, cy + r - 20, '3λ/4', 'middle', 'q'); s.text(cx, cy + 6, 'TL1', 'middle');
      s.ext(cx + r + 150, cy + r + 20);
    }
    return s.svg();
  }

  /* ---------- charts ---------- */
  const charts = [];
  function niceStep(span, n) { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function drawChart(c) {
    const host = $(c.id); if (!host) return;
    const W = Math.max(280, host.clientWidth), H = c.h, m = { l: 46, r: 12, t: 20, b: 36 }, fs = c.freqs, fa = fs[0], fb = fs[fs.length - 1];
    const X = f => m.l + (f - fa) / (fb - fa) * (W - m.l - m.r), Y = v => m.t + (c.y1 - v) / (c.y1 - c.y0) * (H - m.t - m.b);
    const u = funitOf(fb), uName = u === 1e9 ? 'GHz' : u === 1e6 ? 'MHz' : 'kHz', stp = niceStep((fb - fa) / u, W < 480 ? 4 : 7);
    let g = `<defs><clipPath id="${c.id}-clip"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath></defs>`;
    g += `<rect class="band" x="${X(c.band[0])}" y="${m.t}" width="${X(c.band[1]) - X(c.band[0])}" height="${H - m.t - m.b}"/>`;
    for (let v = c.y0; v <= c.y1 + 1e-9; v += c.step) g += `<line class="grid-l" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 7}" y="${Y(v) + 4}" text-anchor="end">${num(v, 3).replace('-', '−')}</text>`;
    for (let v = Math.ceil(fa / u / stp) * stp; v <= fb / u + 1e-9; v += stp) g += `<line class="axis" x1="${X(v * u)}" x2="${X(v * u)}" y1="${H - m.b}" y2="${H - m.b + 5}"/><text x="${X(v * u)}" y="${H - m.b + 18}" text-anchor="middle">${num(v, 4)}</text>`;
    g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    g += `<line class="band-e" x1="${X(c.band[0])}" x2="${X(c.band[0])}" y1="${m.t}" y2="${H - m.b}"/><line class="band-e" x1="${X(c.band[1])}" x2="${X(c.band[1])}" y1="${m.t}" y2="${H - m.b}"/>`;
    g += `<text class="t" x="${(X(c.band[0]) + X(c.band[1])) / 2}" y="${m.t + 13}" text-anchor="middle">your band</text>`;
    if (c.spec != null) g += `<line class="spec" x1="${m.l}" x2="${W - m.r}" y1="${Y(c.spec)}" y2="${Y(c.spec)}"/><text class="t" x="${W - m.r - 4}" y="${Y(c.spec) - 5}" text-anchor="end">target ${num(c.spec).replace('-', '−')} dB</text>`;
    g += `<text class="t" x="${W - m.r}" y="${H - 3}" text-anchor="end">frequency, ${uName}</text><text class="t" x="${m.l - 7}" y="10" text-anchor="end">dB</text>`;
    const lo = c.y0 - 0.06 * (c.y1 - c.y0);
    c.series.forEach(sr => { g += `<path class="tr ${sr.cls}${sr.ghost ? ' ghost' : ''}" clip-path="url(#${c.id}-clip)" d="${sr.data.map((v, i) => (i ? 'L' : 'M') + X(fs[i]).toFixed(1) + ' ' + Y(Math.max(lo, Math.min(c.y1 + 1, v))).toFixed(1)).join('')}"/>`; });
    g += `<g class="hov" style="display:none"><line class="cross" y1="${m.t}" y2="${H - m.b}"/>${c.series.filter(sr => !sr.ghost).map(sr => `<circle class="mk ${sr.cls}" r="4.5"/>`).join('')}</g>`;
    g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.title}">${g}</svg><div class="tip-box" style="display:none"></div>`;
    const hov = host.querySelector('.hov'), tip = host.querySelector('.tip-box'), hit = host.querySelector('.hit'), solid = c.series.filter(sr => !sr.ghost);
    const move = ev => {
      const r = hit.getBoundingClientRect(), i = Math.max(0, Math.min(fs.length - 1, Math.round((ev.clientX - r.left) / r.width * (fs.length - 1))));
      hov.style.display = ''; hov.querySelector('line').setAttribute('x1', X(fs[i])); hov.querySelector('line').setAttribute('x2', X(fs[i]));
      hov.querySelectorAll('circle').forEach((ci, k) => { const v = solid[k].data[i]; ci.setAttribute('cx', X(fs[i])); ci.setAttribute('cy', Y(Math.max(c.y0, Math.min(c.y1, v)))); ci.style.display = v < c.y0 || v > c.y1 ? 'none' : ''; });
      tip.innerHTML = `<b>${fmtF(fs[i], 4)}</b>` + solid.map(sr => `<div><span><i class="${sr.cls}"></i>${sr.name}</span><em>${dBs(sr.data[i], c.dec)} dB</em></div>`).join('');
      tip.style.display = ''; const tw = tip.offsetWidth, px = X(fs[i]);
      tip.style.left = Math.max(0, Math.min(W - tw, px + (px > W / 2 ? -tw - 12 : 12))) + 'px'; tip.style.top = (m.t + 6) + 'px';
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hov.style.display = 'none'; tip.style.display = 'none'; });
  }
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => charts.forEach(drawChart), 120); });

  /* ---------- text blocks ---------- */
  const TECH = { lumped: 'Lumped L-C', ms: 'Microstrip', sl: 'Stripline' };
  function title() {
    const { d } = st;
    return d.circuit === 'wilkinson' ? (d.N > 1 ? d.N + '-section ' : '') + 'Wilkinson power divider' : d.circuit === 'branchline' ? (d.N > 1 ? d.N + '-section branch-line 90° hybrid' : 'Branch-line 90° hybrid') : 'Rat-race 180° hybrid';
  }
  function notices() {
    const { d, cfg, spec, sum } = st, out = [], add = (lvl, html) => out.push({ lvl, html });
    const f0 = d.f0, ratio = cfg.f2 / cfg.f1, bw = 100 * (cfg.f2 - cfg.f1) / f0;
    if (!sum.use.pass && !st.busy) {
      const fixes = [];
      if (d.circuit !== 'ratrace' && d.N < 3) fixes.push(`add a section (try ${d.N + 1})`);
      if (d.lumped && d.m === 1) fixes.push('use 2 L-C cells per quarter-wave');
      if (d.lumped && !cfg.optimise) fixes.push('turn the optimiser on');
      fixes.push('narrow the band', `accept a ${Math.max(3, Math.floor(spec.rl - sum.use.viol))} dB target`);
      if (d.circuit === 'ratrace') fixes.push('for wide bands, use a coupled-line rat-race (not in this version)');
      if (d.circuit === 'branchline' && d.N === 3) fixes.push('for very wide bands, use a coupled-line (Lange or tandem) coupler (not in this version)');
      add('crit', `<b>This design misses your ${spec.rl} dB target by ${sum.use.viol.toFixed(1)} dB.</b> The weakest point is ${st.worst.what}, ${st.worst.value} at ${fmtF(st.worst.f)}. To fix it you can: ${fixes.join('; ')}.`);
    }
    if (d.circuit !== 'wilkinson' && st.pass) {
      const w = 100 * (st.pass[1] - st.pass[0]) / f0;
      add(sum.use.pass ? 'tip' : 'warn', `<b>Usable range: ${fmtF(st.pass[0])} to ${fmtF(st.pass[1])} (about ${num(w, 2)}% wide).</b> ${d.circuit === 'ratrace' ? 'A single rat-race ring only works well close to its centre frequency.' : d.N === 1 ? 'A single-section branch-line only works well close to its centre frequency. Adding sections widens it.' : `A ${d.N}-section branch-line covers more than the classic one.`} You asked for ${num(bw, 2)}%.`);
    }
    if (d.lumped) {
      const vals = st.use;
      if (cfg.f2 > 0.88 * d.cutoff) add(st.opt ? 'tip' : 'warn', `<b>Why the textbook values fail here:</b> series inductors with shunt capacitors form a low-pass filter. With ${d.m} cell${d.m > 1 ? 's' : ''} per quarter-wave it cuts off at ${fmtF(d.cutoff)}, and your band reaches ${fmtF(cfg.f2)}. ${st.opt ? 'The optimiser moved the cutoff up by shrinking the capacitors and re-tuned the rest.' : 'Turn the optimiser on, or use 2 cells per quarter-wave.'}`);
      const tinyL = d.params.some((p, i) => p.kind === 'L' && vals[i] < 1.5e-9), tinyC = d.params.some((p, i) => p.kind === 'C' && vals[i] < 0.7e-12);
      if (tinyL || tinyC) add('crit', `<b>Some values are too small to build reliably.</b> A PCB pad and a few millimetres of track already add roughly 0.5–1 nH and 0.1–0.3 pF, which is comparable to ${tinyL ? 'your smallest inductor' : 'your smallest capacitor'}. At this frequency use microstrip instead.`);
      else if (f0 > 1.2e9) add('warn', `<b>Lumped parts are hard above about 1 GHz.</b> Pad and track parasitics shift the response, and inductor Q drops near self-resonance. Microstrip is usually the better choice here.`);
      add('tip', `<b>When you pick inductors:</b> choose parts whose self-resonant frequency is above ${fmtF(3 * cfg.f2, 2)} (three times the top of your band) and whose Q at ${fmtF(f0, 2)} is at least the ${cfg.parts.qL} assumed here. Use C0G/NP0 capacitors.`);
    } else {
      const ph = st.phys, sub = cfg.sub, lam4 = Object.values(ph)[0].lamG / 4 * 1000;
      d.params.forEach((p, i) => {
        if (p.kind !== 'Z') return; const W = ph[i].W;
        if (W < sub.wmin) add('crit', `<b>${p.des} is too narrow to make.</b> ${num(ph[i].Z)} Ω needs a ${W.toFixed(3)} mm track, below your ${sub.wmin} mm limit. Use a ${cfg.tech === 'ms' ? 'thicker board' : 'larger ground spacing'} or a lower-εr material.`);
        else if (W > lam4 / 3) add('warn', `<b>${p.des} is very wide for its length</b> (${fmtLen(W)} wide, ${fmtLen(lam4)} long). The junctions will not behave like the ideal model. Use a thinner board.`);
      });
      if (lam4 > 150) add('crit', `<b>Each quarter-wave line is ${fmtLen(lam4)} long.</b> At ${fmtF(f0, 2)} a ${TECH[cfg.tech].toLowerCase()} version would not fit on a normal board. Switch "Built with" to L and C parts.`);
      else if (lam4 > 60) add('warn', `<b>Each quarter-wave line is ${fmtLen(lam4)} long.</b> It works, but the board is large. Meander the lines or consider L and C parts.`);
      if (cfg.tech === 'ms' && sub.h * 1e-3 * cfg.f2 / RF.C0 > 0.05) add('warn', `<b>The board is thick for this frequency.</b> The microstrip formulas lose accuracy and the line starts to radiate. Use a thinner board.`);
      if (sub.tand >= 0.015 && cfg.f2 > 3e9) add('warn', `<b>FR-4 is lossy and its εr is loosely controlled above about 3 GHz.</b> Expect extra loss and a frequency shift. A low-loss laminate such as RO4350B is the usual choice.`);
      add('tip', `<b>Before you order:</b> T-junctions, bends and the connector launch are not modelled. Check the layout in an EM simulator (Sonnet Lite, openEMS) or at least in Qucs-S with junction models.`);
    }
    if (d.circuit === 'wilkinson' && ratio > 1.6 && d.N === 1 && sum.use.pass) add('tip', `A single section just covers this band. Two sections would give more margin.`);
    return out;
  }

  const tag = (t, alt) => `<span class="tag${alt ? ' t2' : ''}">${t}</span>`;
  function steps() {
    const { d, cfg, sum, spec } = st, z0 = cfg.z0, f0 = d.f0, o = [], S = (h, tg, body) => o.push(`<li><div><h3>${h} ${tg}</h3>${body}</div></li>`);
    const w0 = 2 * Math.PI * f0, th = 90 / d.m;
    S('Centre frequency', tag('Formula'), `<p>Everything is designed at the middle of your band.</p><div class="eq">f₀ = (f₁ + f₂) / 2 = ${fmtF(f0, 4)} &nbsp;&nbsp; ω₀ = 2π·f₀ = ${sci(w0)} rad/s</div>`);
    if (d.circuit === 'wilkinson') {
      const P = d.proto, N = d.N;
      if (N === 1) {
        S('Line impedance and resistor', tag('Formula'), `<p>Each branch must turn the ${num(2 * z0)} Ω it sees at the input (two branches in parallel make ${num(z0)} Ω) into ${num(z0)} Ω at its output. One quarter-wave line does that when its impedance is the geometric mean. In odd mode each output sees half the resistor, so R/2 = Z₀.</p><div class="eq">Z = √2 · Z₀ = ${num(P.Z[0], 4)} Ω &nbsp;&nbsp; R = 2 · Z₀ = ${num(P.R[0])} Ω</div>`);
      } else {
        S('Line impedances', tag('Band search'), `<p>Each branch steps ${num(2 * z0)} Ω down to ${num(z0)} Ω in ${N} quarter-wave stages. The stage impedances are chosen so the input reflection has equal ripple across ${band(cfg)} (a Chebyshev transformer). ${Math.abs(cfg.f2 / cfg.f1 - 2) < 0.02 && N === 2 ? 'For a 2:1 band this reproduces Cohn’s table: 1.6398 and 1.2197 × Z₀.' : ''}</p><div class="eq">${P.Z.map((z, k) => `Z${k + 1} = ${num(z, 4)} Ω`).join(' &nbsp;&nbsp; ')} &nbsp;&nbsp; (section 1 is at the input)</div><p>Check: Z₁ × Z${N} = ${num(P.Z[0] * P.Z[N - 1], 4)} = 2 · Z₀².${N === 3 ? ' The middle section is √2 · Z₀.' : ''}</p>`);
        if (N === 2) S('Isolation resistors', tag('Formula') + ' ' + tag('Cohn 1968', 1), `<p>Two resistors share the job, so neither is simply 2·Z₀. Cohn’s closed-form design gives both from the line impedances and the bandwidth (z₁ = Z₂/Z₀ is the output-side line, z₂ = Z₁/Z₀ the input-side line):</p><div class="eq">φ = 90° · [1 − (1/√2)·(f₂/f₁ − 1)/(f₂/f₁ + 1)] = ${num(P.info.phi, 4)}°</div><div class="eq">r = 2·z₁·z₂ / √[(z₁+z₂)·(z₂ − z₁·cot²φ)] = ${num(P.R[0] / z0, 4)} &nbsp;→&nbsp; R1 = r·Z₀ = ${num(P.R[0], 4)} Ω &nbsp;(between the sections)</div><div class="eq">R2 = Z₀ · 2·r·(z₁+z₂) / [r·(z₁+z₂) − 2·z₂] = ${num(P.R[1], 4)} Ω &nbsp;(across the outputs)</div>`);
        else S('Isolation resistors', tag('Band search'), `<p>There is no closed formula for three resistors. Cohn himself had none. They were found by search: the three values that give the best worst-case output match and isolation across your band, with ideal lines.</p><div class="eq">${P.R.map((r, k) => `R${k + 1} = ${num(r, 4)} Ω`).join(' &nbsp;&nbsp; ')} &nbsp;&nbsp; (R${N} is across the outputs)</div>`);
      }
    } else if (d.circuit === 'branchline' && d.N === 1) {
      S('Line impedances', tag('Formula'), `<p>A square of four quarter-wave lines. The two through arms are lower impedance than the system, the two branch arms equal it. That combination cancels the reflection at the input and at the isolated port.</p><div class="eq">Z(through) = Z₀ / √2 = ${num(d.proto.Za, 4)} Ω &nbsp;&nbsp; Z(branch) = Z₀ = ${num(d.proto.Zb, 4)} Ω</div>`);
    } else if (d.circuit === 'branchline') {
      const P = d.proto, N = d.N;
      S('Ladder layout', tag('Structure'), `<p>Two through lines, each made of ${N} quarter-wave sections, joined by ${N + 1} quarter-wave branches. Each extra branch adds another path whose reflections cancel at a slightly different frequency, which is what widens the band.</p>`);
      if (N === 2) S('Where the search starts', tag('Formula'), `<p>The three-branch coupler has an exact solution at f₀: through sections of Z₀, outer branches of Z₀·(1+√2) and a middle branch of Z₀·√2. It gives a perfect 3 dB, 90° split at the centre frequency.</p><div class="eq">Z(through) = ${num(z0)} Ω &nbsp;&nbsp; Z(outer branches) = ${num(z0 * (1 + Math.SQRT2), 4)} Ω &nbsp;&nbsp; Z(middle branch) = ${num(z0 * Math.SQRT2, 4)} Ω</div>`);
      S('Line impedances for your band', tag('Band search'), `<p>There is no simple formula for ${N === 2 ? 'the widest-band' : 'a four-branch'} design, so the impedances were found by search with ideal lines: the set that gives the best worst-case input match, isolation, amplitude balance and 90° phase across ${band(cfg)}. Branches were capped at 3·Z₀ (${num(3 * z0)} Ω), because thinner tracks cannot be made reliably. Top and bottom, and left and right, stay symmetric.</p><div class="eq">${P.Zs.map((z, k) => `${'TL' + (k + 1)} (through) = ${num(z, 4)} Ω`).join(' &nbsp;&nbsp; ')}</div><div class="eq">${P.Zb.map((z, j) => `${'TL' + (P.Zs.length + j + 1)} (${j === 0 ? 'outer branches' : 2 * j === N ? 'middle branch' : 'inner branches'}) = ${num(z, 4)} Ω`).join(' &nbsp;&nbsp; ')}</div>${P.Zb.some(z => z >= 2.99 * z0) ? `<p>The branches hit the ${num(3 * z0)} Ω cap. With equal 3 dB coupling, a ${N}-section design wants even higher branch impedances, which is why designs with this many branches are rare.</p>` : ''}`);
    } else {
      S('Ring impedance', tag('Formula'), `<p>A ring one and a half wavelengths around. Three arms are a quarter-wave long and one is three quarter-waves. From the sum port the two paths to each output differ by nothing, and the two paths to the difference port differ by half a wavelength, so they cancel there.</p><div class="eq">Z(ring) = √2 · Z₀ = ${num(d.proto.Zr, 4)} Ω</div>`);
    }
    if (d.lumped) {
      const zs = d.circuit === 'wilkinson' ? d.proto.Z.map((z, k) => [z, 'section ' + (k + 1)]) : d.circuit === 'branchline' ? (d.N === 1 ? [[d.proto.Za, 'through arm'], [d.proto.Zb, 'branch arm']] : d.proto.Zs.map((z, k) => [z, 'through section ' + (k + 1)]).concat(d.proto.Zb.map((z, j) => [z, 'branch ' + (j + 1)]))) : [[d.proto.Zr, 'each arm']];
      S('Swap each line for inductors and capacitors', tag('Formula'), `<p>A line of impedance Z and electrical length θ behaves, at f₀, exactly like one series inductor with a shunt capacitor at each end (a π-cell). Here θ = 90° / ${d.m} = ${num(th)}° per cell.</p><div class="eq">L = Z · sin θ / ω₀ &nbsp;&nbsp;&nbsp; C(each end) = tan(θ/2) / (ω₀ · Z)</div>${zs.map(([z, nm]) => `<div class="eq">${nm}: L = ${num(z, 4)} × ${num(Math.sin(th * Math.PI / 180), 4)} / ${sci(w0)} = ${fmtL(z * Math.sin(th * Math.PI / 180) / w0)} &nbsp;&nbsp; C = ${fmtC(Math.tan(th * Math.PI / 360) / (w0 * z))}</div>`).join('')}${d.circuit === 'ratrace' ? `<p>The 3λ/4 arm is replaced by a high-pass cell (a series capacitor of 1/(ω₀·Z) with shunt inductors), which gives the same phase with one part. ${d.m === 1 ? 'Its shunt inductors resonate with the shunt capacitors at ports 2 and 4, so both are left out.' : 'Its shunt inductors combine with the shunt capacitors at ports 2 and 4 into one inductor each (L3).'}</p>` : ''}`);
      S('Add up capacitors that share a node', tag('Formula'), `<p>Capacitors to ground at the same point are in parallel, so their values add. That is why the parts list has fewer capacitors than the cell count suggests.</p><div class="eq">${d.params.map((p, i) => p.kind === 'C' ? `${p.des} = ${fmtC(st.formula[i])}` : null).filter(Boolean).join(' &nbsp;&nbsp; ')}</div>`);
      S('Test the formula values across your band', tag('Simulation'), `<p>The circuit was simulated at 41 frequencies from ${band(cfg)} with ideal parts. Worst input match ${dBs(sum.formula.s11)} dB, worst isolation ${dBs(sum.formula.iso)} dB. ${sum.formula.pass ? 'That meets your target, so the formula values are kept.' : `That misses your ${spec.rl} dB target.`} The formulas are exact only at f₀: the π-cells are a low-pass filter with cutoff at ${fmtF(d.cutoff)}.</p>`);
      if (st.opt) S('Optimise all values together', tag('Optimiser'), `<p>${st.optInfo.dims} values were allowed to change at once. The optimiser (differential evolution) bred a population of candidate designs for ${st.optInfo.gens} generations, simulating each across the band and keeping whichever had the best worst-case figure. Result with ideal parts: input match ${dBs(sum.opt.s11)} dB, output match ${dBs(sum.opt.s22)} dB, isolation ${dBs(sum.opt.iso)} dB${d.circuit === 'wilkinson' ? '' : `, imbalance ${sum.opt.imb.toFixed(2)} dB`}.</p><p>The values no longer follow the formulas. Typically the capacitors shrink (raising the cutoff) and the resistors trade places to keep the match.</p>`);
      S('Round to values you can buy', tag('Standard values'), `<p>Each value was rounded to the nearest ${cfg.parts.lcSeries} (L, C) or ${cfg.parts.rSeries} (R) value. Then neighbouring standard values were tried one part at a time and kept when they improved the worst in-band figure${st.refChanged ? ` (${st.refChanged} swap${st.refChanged > 1 ? 's' : ''} helped)` : ' (none helped)'}.</p>`);
      S('Add real part losses', tag('Simulation'), `<p>The final column is simulated with inductor Q = ${cfg.parts.qL} and capacitor Q = ${cfg.parts.qC}. Each inductor gets a series resistance and each capacitor a parallel conductance:</p><div class="eq">R(series) = ω·L / Q &nbsp;&nbsp;&nbsp; G(parallel) = ω·C / Q</div><p>Loss to each output rises from the ideal 3.01 dB to ${sum.use.ilMin.toFixed(2)}–${sum.use.ilMax.toFixed(2)} dB across the band.</p>`);
    } else {
      const ph = st.phys, sub = cfg.sub, ms = cfg.tech === 'ms';
      S('Track width for each impedance', tag(ms ? 'Hammerstad–Jensen model' : 'Cohn / Wheeler model'), `<p>${ms ? `The microstrip equations give impedance from width, not the other way round. So the width is found by trying values until the model returns the impedance you need (εr = ${sub.er}, h = ${sub.h} mm, copper ${sub.t} mm).` : `Stripline impedance depends on the track width and the ground-to-ground spacing (εr = ${sub.er}, b = ${sub.b} mm, copper ${sub.t} mm). The width is found by trying values until the model returns the impedance you need.`}</p>${d.params.map((p, i) => p.kind === 'Z' ? `<div class="eq">${p.des}: ${num(ph[i].Z, 4)} Ω → W = ${ph[i].W.toFixed(3)} mm${ms ? ` &nbsp;&nbsp; W/h = ${num(ph[i].W / sub.h)} &nbsp;&nbsp; ε(eff) = ${num(ph[i].eeffF, 4)}` : ''}</div>` : '').join('')}`);
      S('Line length', tag('Formula'), `<p>The wave travels slower on the board than in air by √ε(eff)${ms ? ', which depends on the width, so each line has its own wavelength' : ' = √εr, because stripline is fully inside the dielectric'}.</p><div class="eq">λ/4 = c / (4 · f₀ · √ε(eff))</div>${d.params.map((p, i) => p.kind === 'Z' ? `<div class="eq">${p.des}: λ/4 = ${fmtLen(ph[i].lamG / 4 * 1000)}</div>` : '').join('')}`);
      if (d.circuit === 'wilkinson') S('Round the resistors', tag('Standard values'), `<p>Resistors are rounded to ${cfg.parts.rSeries}, then neighbouring values are tried and kept if they improve the worst in-band figure. Use small thin-film chip resistors (0402 or 0603) so their own inductance stays low.</p>`);
      S('Add board losses and dispersion', tag('Simulation'), `<p>The final column includes copper loss, dielectric loss (loss tangent ${sub.tand})${ms ? ' and the small rise of ε(eff) with frequency (Kirschning–Jansen)' : ''}. Line loss here is about ${num(Object.values(ph)[0].lossDbPerM * Object.values(ph)[0].lamG / 4, 2)} dB per quarter-wave. Loss to each output across the band: ${sum.use.ilMin.toFixed(2)}–${sum.use.ilMax.toFixed(2)} dB (3.01 dB is a perfect split).</p>`);
    }
    return o.join('');
  }

  /* ---------- render ---------- */
  function partsTable() {
    const { d, cfg } = st, hasOpt = !!st.opt;
    if (d.lumped) {
      const moved = d.params.some((p, i) => Math.abs(Math.log(st.use[i] / (st.opt || st.formula)[i])) > 0.12);
      const note = `<p class="sub" style="margin:10px 0 0"><b>Why “Use this” can differ from the other columns:</b> the formula values are exact only at the centre frequency. ${st.opt ? 'The optimiser re-tuned every value together for your whole band. ' : ''}Then each value was rounded to a standard value you can buy, and neighbouring standard values were tried one part at a time and kept when they made the worst point in your band better${st.refChanged ? ` (${st.refChanged} swap${st.refChanged > 1 ? 's' : ''} helped here)` : ''}.${moved ? ' Some parts moved by more than one standard step, which is expected when the band is wide.' : ''} Build with the highlighted column.</p>`;
      return `<div class="scroll"><table><thead><tr><th>Ref</th><th>Part</th><th class="n">Qty</th><th class="n">Formula</th>${hasOpt ? '<th class="n">Optimised</th>' : ''}<th class="n use">Use this</th></tr></thead><tbody>${d.params.map((p, i) =>
        `<tr><td class="ref">${p.des}</td><td>${p.role}</td><td class="n">${p.count}</td><td class="n dim">${fmtV(p.kind, st.formula[i])}</td>${hasOpt ? `<td class="n dim">${fmtV(p.kind, st.opt[i])}</td>` : ''}<td class="n use">${fmtV(p.kind, st.use[i])}</td></tr>`).join('')}</tbody></table></div>${note}`;
    }
    const ph = st.phys, lines = d.params.map((p, i) => [p, i]).filter(([p]) => p.kind === 'Z'), res = d.params.map((p, i) => [p, i]).filter(([p]) => p.kind === 'R');
    let h = `<div class="scroll"><table><thead><tr><th>Ref</th><th>Line</th><th class="n">Qty</th><th class="n">Impedance</th><th class="n use">Width</th><th class="n use">Length</th><th class="n">Loss</th></tr></thead><tbody>${lines.map(([p, i]) => {
      const q = ph[i].lamG / 4 * 1000;
      return `<tr><td class="ref">${p.des}</td><td>${p.role}</td><td class="n">${p.count}</td><td class="n">${num(ph[i].Z, 4)} Ω</td><td class="n use">${ph[i].W.toFixed(3)} mm</td><td class="n use">${p.theta === 540 ? fmtLen(6 * q) + ' around' : fmtLen(q)}</td><td class="n dim">${num(ph[i].lossDbPerM * ph[i].lamG / 4, 2)} dB per λ/4</td></tr>`;
    }).join('')}</tbody></table></div>`;
    if (d.circuit === 'ratrace') { const q = ph[lines[0][1]].lamG / 4 * 1000; h += `<p class="sub" style="margin:10px 0 0">Ring measured along the middle of the track: λ/4 arms of ${fmtLen(q)}, the 3λ/4 arm ${fmtLen(3 * q)}, mean radius ${fmtLen(6 * q / (2 * Math.PI))}.</p>`; }
    if (res.length) h += `<div class="scroll" style="margin-top:14px"><table><thead><tr><th>Ref</th><th>Part</th><th class="n">Qty</th><th class="n">Ideal</th><th class="n use">Use this</th></tr></thead><tbody>${res.map(([p, i]) => `<tr><td class="ref">${p.des}</td><td>${p.role}</td><td class="n">${p.count}</td><td class="n dim">${fmtV('R', st.formula[i])}</td><td class="n use">${fmtV('R', st.use[i])}</td></tr>`).join('')}</tbody></table></div>`;
    return h;
  }
  function perfTable() {
    const { d, sum, spec } = st, cols = [];
    if (d.lumped) { cols.push(['Formula values', 'ideal parts', sum.formula]); if (sum.opt) cols.push(['Optimised', 'ideal parts', sum.opt]); cols.push(['Standard values', 'with part losses', sum.use, 1]); }
    else { cols.push(['Ideal lines', 'no loss', sum.formula]); cols.push(['On your board', 'loss, dispersion', sum.use, 1]); }
    const rows = [['Input match, worst', s => dBs(s.s11) + ' dB', s => s.s11 <= -spec.rl + 0.05, `≤ −${spec.rl} dB`]];
    if (d.circuit === 'wilkinson') rows.push(['Output match, worst', s => dBs(s.s22) + ' dB', s => s.s22 <= -spec.rl + 0.05, `≤ −${spec.rl} dB`]);
    rows.push(['Isolation, worst', s => dBs(s.iso) + ' dB', s => s.iso <= -spec.rl + 0.05, `≤ −${spec.rl} dB`]);
    rows.push(['Loss to each output', s => s.ilMin.toFixed(2) + '–' + s.ilMax.toFixed(2) + ' dB', null, '3.01 dB ideal']);
    if (d.circuit !== 'wilkinson') {
      rows.push(['Amplitude imbalance, worst', s => s.imb.toFixed(2) + ' dB', s => s.imb <= spec.imb + 0.01, `≤ ${spec.imb} dB`]);
      rows.push([`Phase error from ${d.circuit === 'branchline' ? '90°' : '0°'}, worst`, s => s.phErr.toFixed(1) + '°', s => s.phErr <= spec.ph + 0.05, `≤ ${spec.ph}°`]);
    }
    return `<div class="scroll"><table><thead><tr><th>Across ${band(st.cfg)}</th>${cols.map(c => `<th class="n${c[3] ? ' use' : ''}">${c[0]}<br><span style="font-weight:500;letter-spacing:.04em;text-transform:none">${c[1]}</span></th>`).join('')}<th class="n">Target</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${r[0]}</td>${cols.map(c => `<td class="n${c[3] ? ' use' : ''}">${r[1](c[2])}${r[2] ? ` <span class="pill ${r[2](c[2]) ? 'ok' : 'bad'}"><i></i>${r[2](c[2]) ? 'ok' : 'miss'}</span>` : ''}</td>`).join('')}<td class="n dim">${r[3]}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function render() {
    const { d, cfg, spec, sum } = st, wilk = d.circuit === 'wilkinson', nParts = d.params.reduce((a, p) => a + (p.kind === 'Z' ? 0 : p.count), 0);
    const stamp = st.busy
      ? `<div class="stamp busy">${ICON.busy}<div><b>Optimising</b><small>Trying thousands of value sets across your band</small><div class="bar"><i></i></div></div></div>`
      : sum.use.pass
        ? `<div class="stamp ok">${ICON.ok}<div><b>Meets ${spec.rl} dB target</b><small>across ${band(cfg)}, with ${d.lumped ? 'standard values and part losses' : 'board losses'}</small></div></div>`
        : `<div class="stamp bad">${ICON.bad}<div><b>Misses target by ${sum.use.viol.toFixed(1)} dB</b><small>weakest point: ${st.worst.what} ${st.worst.value} at ${fmtF(st.worst.f)}</small></div></div>`;
    const nts = notices();
    const names = wilk ? ['Input match (S11)', 'Isolation between outputs (S32)', 'To each output (S21)', 'Output match (S22)'] : ['Input match (S11)', 'Isolation (S41)', 'Through output (S21)', 'Coupled output (S31)'];
    const keys = wilk ? ['s11', 'iso', 'thru', 's22'] : ['s11', 'iso', 'thru', 'coup'];
    const ghostName = d.lumped ? 'textbook-formula values' : 'ideal lossless lines';
    const mc = st.mc, tol = cfg.tol;
    const tolText = d.lumped ? `inductors ±${num(tol.L * 100)}%, capacitors ±${num(tol.C * 100)}%, resistors ±${num(tol.R * 100)}%` : `εr ±${tol.er}, track width ±${num(tol.w * 100)}%${wilk ? `, resistors ±${num(tol.R * 100)}%` : ''}`;
    sheet.innerHTML = `
<header class="titleblock">
  <div>
    <div class="kind">${TECH[cfg.tech]} design sheet</div>
    <h1>${title()}</h1>
    <div class="meta"><span>${band(cfg)} (${num(cfg.f2 / cfg.f1)}:1)</span><span>centre ${fmtF(d.f0, 4)}</span><span>Z₀ ${num(cfg.z0)} Ω</span><span>${d.lumped ? nParts + ' parts' : cfg.tech === 'ms' ? `εr ${cfg.sub.er}, h ${cfg.sub.h} mm` : `εr ${cfg.sub.er}, b ${cfg.sub.b} mm`}</span></div>
  </div>
  ${stamp}
</header>
<p class="lead">Across your band this design gives an input match of ${dBs(sum.use.s11)} dB or better, isolation of ${dBs(sum.use.iso)} dB or better, and ${sum.use.ilMin.toFixed(2)}–${sum.use.ilMax.toFixed(2)} dB to each output. A perfect split is 3.01 dB.</p>
${nts.length ? `<section class="sec"><h2>Read this first</h2><ul class="notes">${nts.map(n => `<li class="${n.lvl}">${ICON[n.lvl]}<div>${n.html}</div></li>`).join('')}</ul></section>` : ''}
<section class="sec">
  <h2>Schematic and ${d.lumped ? 'parts' : 'dimensions'} <span class="tools"><button type="button" class="btn" id="copy">Copy list</button></span></h2>
  <div class="two-col"><div class="schem scroll">${schematic()}</div><div>${partsTable()}</div></div>
</section>
<section class="sec">
  <h2>Performance</h2>
  <p class="sub">Simulated response of the design in the highlighted column. The shaded strip is your band. Lower is better for the match and isolation curves.</p>
  <div class="legend">${names.map((n, i) => `<span><i class="c${i + 1}"></i>${n}</span>`).join('')}</div>
  <div class="chart" id="ch-main"></div>
  <div class="chart-opts"><label class="check"><input type="checkbox" id="ovl" ${overlay ? 'checked' : ''}><span>Also draw the ${ghostName} (dashed)</span></label></div>
  <p class="sub" style="margin:14px 0 6px">The split, zoomed in. ${wilk ? 'Both outputs follow the same curve.' : 'The two curves should sit on top of each other near 3 dB.'}</p>
  <div class="chart" id="ch-zoom"></div>
  <div style="margin-top:16px">${perfTable()}</div>
</section>
<section class="sec">
  <h2>If you build 200 of them</h2>
  <div class="yield"><div class="big">${Math.round(100 * mc.yield)}<small>%</small></div>
  <div><p><b>${Math.round(mc.yield * mc.runs)} of ${mc.runs} simulated builds meet the ${spec.rl} dB target</b> when every part is picked at random inside its tolerance (${tolText}).</p>
  <p class="sub" style="margin:6px 0 0">19 builds in 20 are at least this good: input match ${dBs(mc.p95.s11)} dB, isolation ${dBs(mc.p95.iso)} dB, loss to an output ${mc.p95.ilMax.toFixed(2)} dB, output imbalance ${mc.p95.imb.toFixed(2)} dB${wilk ? '' : `, phase error ${mc.p95.phErr.toFixed(1)}°`}. Change the tolerances under “Parts and tolerances”.</p></div></div>
</section>
<section class="sec">
  <h2>How each number was found</h2>
  <ol class="steps">${steps()}</ol>
</section>
<section class="sec">
  <h2>Limits and sources</h2>
  <div class="cols fine">
    <div><h3>Not modelled</h3><ul>
      <li>Pad, via and track parasitics, and the connector launch.</li>
      <li>Inductor and capacitor self-resonance. Q is treated as constant with frequency.</li>
      <li>Microstrip T-junctions, bends and coupling between neighbouring lines.</li>
      <li>Stripline uses one centred track between two grounds.</li>
    </ul><p style="margin-top:8px">Treat the result as a strong first design. Check it in Qucs-S or an EM simulator before you order boards.</p></div>
    <div><h3>Checked against</h3><ul>
      <li>Cohn’s two-section table: 1.2197 and 1.6398 × Z₀, resistors 1.9602 and 4.8204 × Z₀.</li>
      <li>Pozar’s 50 Ω microstrip example (εr 2.2, h 1.27 mm): 3.91 mm.</li>
      <li>Pozar’s 50 Ω stripline example (εr 2.2, b 3.2 mm): 2.66 mm.</li>
      <li>Steer’s 400 MHz lumped Wilkinson: 28.13 nH, 5.627 pF, 100 Ω.</li>
    </ul></div>
    <div><h3>Sources</h3><ul>
      <li>S. B. Cohn, “A Class of Broadband Three-Port TEM-Mode Hybrids”, IEEE Trans. MTT, 1968.</li>
      <li>D. M. Pozar, <i>Microwave Engineering</i>, 4th ed.</li>
      <li>Hammerstad and Jensen (1980) and Kirschning and Jansen (1982), as given in the <a href="https://qucs.sourceforge.net/tech/node75.html">Qucs technical papers</a>.</li>
      <li>M. Steer, <a href="https://eng.libretexts.org/Bookshelves/Electrical_Engineering/Electronics/Fundamentals_of_Microwave_and_RF_Design_(Steer)/09:_Passive_Components/9.10:_Wilkinson_Combiner_and_Divider">Wilkinson combiner and divider</a>.</li>
      <li><a href="https://www.microwaves101.com/encyclopedias/multistage-wilkinsons">Microwaves101, multistage Wilkinsons</a>.</li>
    </ul></div>
  </div>
</section>`;
    // charts
    const sw = st.sw, mk = (src, ghost) => keys.map((k, i) => ({ cls: 'c' + (i + 1), name: names[i].replace(/ \(.*/, ''), data: src[k], ghost }));
    const zoomKeys = wilk ? [2] : [2, 3], zs = (src, ghost) => zoomKeys.map(i => ({ cls: 'c' + (i + 1), name: names[i].replace(/ \(.*/, ''), data: src[keys[i]], ghost }));
    let lo = -3.5; zoomKeys.forEach(i => sw.use[keys[i]].forEach((v, j) => { if (st.freqs[j] >= cfg.f1 && st.freqs[j] <= cfg.f2) lo = Math.min(lo, v); }));
    const zy0 = Math.max(-12, Math.floor(lo - 0.6)), zstep = (-2 - zy0) > 5 ? 2 : 1;
    charts.length = 0;
    charts.push({ id: 'ch-main', h: 320, freqs: st.freqs, band: [cfg.f1, cfg.f2], y0: -40, y1: 0, step: 10, spec: -spec.rl, dec: 1, title: 'Match, isolation and split against frequency, in dB', series: (overlay ? mk(sw.formula, 1) : []).concat(mk(sw.use)) });
    charts.push({ id: 'ch-zoom', h: 190, freqs: st.freqs, band: [cfg.f1, cfg.f2], y0: zy0, y1: -2, step: zstep, spec: null, dec: 2, title: 'Power to each output against frequency, zoomed, in dB', series: (overlay ? zs(sw.formula, 1) : []).concat(zs(sw.use)) });
    charts.forEach(drawChart);
    $('ovl').addEventListener('change', e => { overlay = e.target.checked; render(); });
    $('copy').addEventListener('click', e => {
      const txt = `${title()} — ${TECH[cfg.tech]}, ${band(cfg)}, Z0 ${num(cfg.z0)} ohm\n` + d.params.map((p, i) => p.kind === 'Z'
        ? `${p.des}  x${p.count}  ${num(st.phys[i].Z, 4)} ohm  W ${st.phys[i].W.toFixed(3)} mm  quarter-wave ${fmtLen(st.phys[i].lamG / 4 * 1000)}  (${p.role})`
        : `${p.des}  x${p.count}  ${fmtV(p.kind, st.use[i])}  (${p.role})`).join('\n');
      const done = ok => { e.target.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { e.target.textContent = 'Copy list'; }, 1500); };
      try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (err) { done(false); }
    });
  }

  /* ---------- wiring ---------- */
  let deb;
  const changed = () => { syncForm(); saveForm(); clearTimeout(deb); deb = setTimeout(compute, 180); };
  $('preset').addEventListener('change', () => { const p = PRESETS[$('preset').value]; if (p) { $('er').value = p[0]; $('tand').value = p[1]; $('h').value = p[2]; $('t').value = p[3]; } });
  ['er', 'tand', 'h', 't'].forEach(id => $(id).addEventListener('input', () => { if (radio('tech') === 'ms') $('preset').value = 'custom'; }));
  $('form').addEventListener('input', changed); $('form').addEventListener('change', changed);
  $('form').addEventListener('submit', e => e.preventDefault());
  loadForm(); syncForm(); compute();
  window.__rf = { get st() { return st; }, compute };
})();

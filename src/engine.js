'use strict';
/* RF engine: nodal S-parameter simulator, design formulas, line models, optimiser. No DOM. */
const RF = (() => {
  const C0 = 299792458, ETA0 = 376.730313668, MU0 = 4e-7 * Math.PI, RHO_CU = 1.72e-8;
  const rad = d => d * Math.PI / 180;

  /* ---------- seeded random numbers (so results repeat) ---------- */
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- transmission-line models ---------- */
  // Hammerstad-Jensen microstrip analysis. Lengths in the same unit (mm).
  function msStatic(u, er) {
    const fu = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528));
    const zl1 = ETA0 / (2 * Math.PI) * Math.log(fu / u + Math.sqrt(1 + 4 / (u * u)));
    const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7;
    const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053);
    const eeff = (er + 1) / 2 + (er - 1) / 2 * Math.pow(1 + 10 / u, -a * b);
    return { zl1, eeff };
  }
  function msAnalyze(W, h, t, er) {
    const u = W / h, th = t / h;
    if (!(th > 0)) { const s = msStatic(u, er); return { z0: s.zl1 / Math.sqrt(s.eeff), eeff: s.eeff, u }; }
    const coth = x => 1 / Math.tanh(x), sech = x => 1 / Math.cosh(x);
    const du1 = th / Math.PI * Math.log(1 + 4 * Math.E / (th * coth(Math.sqrt(6.517 * u)) ** 2));
    const dur = 0.5 * du1 * (1 + sech(Math.sqrt(er - 1)));
    const s1 = msStatic(u + du1, er), sr = msStatic(u + dur, er);
    return { z0: sr.zl1 / Math.sqrt(sr.eeff), eeff: sr.eeff * (s1.zl1 / sr.zl1) ** 2, u };
  }
  function msSynth(Z, h, t, er) {       // width for a target impedance (bisection on W/h)
    let lo = 0.005, hi = 200;
    for (let i = 0; i < 70; i++) {
      const mid = Math.sqrt(lo * hi);
      if (msAnalyze(mid * h, h, t, er).z0 > Z) lo = mid; else hi = mid;
    }
    const W = Math.sqrt(lo * hi) * h;
    return Object.assign({ W }, msAnalyze(W, h, t, er));
  }
  // Kirschning-Jansen dispersion: effective permittivity at frequency f (Hz), h in mm
  function msEeffF(eeff0, er, u, h_mm, f) {
    const fn = f / 1e9 * h_mm;
    const P1 = 0.27488 + (0.6315 + 0.525 / Math.pow(1 + 0.0157 * fn, 20)) * u - 0.065683 * Math.exp(-8.7513 * u);
    const P2 = 0.33622 * (1 - Math.exp(-0.03442 * er));
    const P3 = 0.0363 * Math.exp(-4.6 * u) * (1 - Math.exp(-Math.pow(fn / 38.7, 4.97)));
    const P4 = 1 + 2.751 * (1 - Math.exp(-Math.pow(er / 15.916, 8)));
    const P = P1 * P2 * Math.pow((0.1844 + P3 * P4) * fn, 1.5763);
    return er - (er - eeff0) / (1 + P);
  }
  // Stripline: Cohn exact (zero thickness) and Wheeler/Wadell finite thickness. W, b, t same unit.
  function agm(a, b) { for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) { const m = (a + b) / 2; b = Math.sqrt(a * b); a = m; } return a; }
  function slExact(W, b, er) {
    const x = Math.PI * W / (2 * b), k = 1 / Math.cosh(x), kp = Math.tanh(x);
    return 30 * Math.PI / Math.sqrt(er) * agm(1, k) / agm(1, kp);   // K(k)/K(k') = agm(1,k)/agm(1,k')
  }
  function slAnalyze(W, b, t, er) {
    if (!(t > 0)) return { z0: slExact(W, b, er), eeff: er };
    const x = t / b, m = 2 / (1 + 2 * x / (3 * (1 - x)));
    const dW = (b - t) * x / (Math.PI * (1 - x)) * (1 - 0.5 * Math.log((x / (2 - x)) ** 2 + Math.pow(0.0796 * x / (W / b + 1.1 * x), m)));
    const q = 8 * (b - t) / (Math.PI * (W + dW));
    return { z0: 30 / Math.sqrt(er) * Math.log(1 + q / 2 * (q + Math.sqrt(q * q + 6.27))), eeff: er };
  }
  function slSynth(Z, b, t, er) {
    let lo = 1e-4, hi = 50;
    for (let i = 0; i < 70; i++) {
      const mid = Math.sqrt(lo * hi);
      if (slAnalyze(mid * b, b, t, er).z0 > Z) lo = mid; else hi = mid;
    }
    const W = Math.sqrt(lo * hi) * b;
    return Object.assign({ W }, slAnalyze(W, b, t, er));
  }
  // physical description of one line for the simulator. tech lengths in mm.
  function lineModel(tech, W, Z, eeff0) {
    const m = { kind: tech.kind, Z, eeff0, W };
    const Wm = W * 1e-3;
    if (tech.kind === 'ms') {
      m.u = W / tech.h; m.h = tech.h; m.er = tech.er;
      m.kd = tech.tand; // dielectric loss handled with eeff(f)
      const Ki = Math.exp(-1.2 * Math.pow(Z / ETA0, 0.7));
      m.kc = Math.sqrt(Math.PI * MU0 * RHO_CU) / (Z * Wm) * Ki;         // alpha_c = kc * sqrt(f)  [Np/m]
    } else {
      m.er = tech.er; m.kd = tech.tand;
      const b = tech.b * 1e-3, t = Math.max(tech.t, 0.005) * 1e-3, rs1 = Math.sqrt(Math.PI * MU0 * RHO_CU);
      if (Math.sqrt(tech.er) * Z < 120) {
        const A = 1 + 2 * Wm / (b - t) + (b + t) / (Math.PI * (b - t)) * Math.log((2 * b - t) / t);
        m.kc = 2.7e-3 * rs1 * tech.er * Z / (30 * Math.PI * (b - t)) * A;
      } else {
        const B = 1 + b / (0.5 * Wm + 0.7 * t) * (0.5 + 0.414 * t / Wm + Math.log(4 * Math.PI * Wm / t) / (2 * Math.PI));
        m.kc = 0.16 * rs1 / (Z * b) * B;
      }
    }
    return m;
  }
  function lineEeff(m, f) { return m.kind === 'ms' ? msEeffF(m.eeff0, m.er, m.u, m.h, f) : m.er; }
  function lineAlpha(m, f, ee) {      // Np/m
    const ad = m.kind === 'ms'
      ? (m.er / Math.sqrt(ee)) * ((ee - 1) / (m.er - 1)) * Math.PI * f / C0 * m.kd
      : Math.PI * f * Math.sqrt(m.er) / C0 * m.kd;
    return ad + m.kc * Math.sqrt(f);
  }

  /* ---------- nodal S-parameter simulator ---------- */
  // net = { n, ports:[node...], z0, els:[{t:'R'|'L'|'C'|'TL', a, b, v, q, z, th0, f0, len, m}] }, node 0 = ground
  function simulate(net, f) {
    const n = net.n, w = 2 * Math.PI * f, np = net.ports.length, z0 = net.z0;
    const Yr = new Float64Array(n * n), Yi = new Float64Array(n * n);
    const els = net.els;
    for (let k = 0; k < els.length; k++) {
      const e = els[k], a = e.a - 1, b = e.b - 1;
      let gr = 0, gi = 0;
      if (e.t === 'TL') {
        let th, al, Z = e.z;
        if (e.m) { const ee = lineEeff(e.m, f); th = w * Math.sqrt(ee) / C0 * e.len; al = Math.max(lineAlpha(e.m, f, ee) * e.len, 1e-7); }
        else { th = e.th0 * f / e.f0; al = 1e-7; }
        const sr = Math.sinh(al) * Math.cos(th), si = Math.cosh(al) * Math.sin(th);
        const cr = Math.cosh(al) * Math.cos(th), ci = Math.sinh(al) * Math.sin(th);
        const d = sr * sr + si * si, ir = sr / d, ii = -si / d;
        const y11r = (cr * ir - ci * ii) / Z, y11i = (cr * ii + ci * ir) / Z, y12r = -ir / Z, y12i = -ii / Z;
        if (a >= 0) { Yr[a * n + a] += y11r; Yi[a * n + a] += y11i; }
        if (b >= 0) { Yr[b * n + b] += y11r; Yi[b * n + b] += y11i; }
        if (a >= 0 && b >= 0) { Yr[a * n + b] += y12r; Yi[a * n + b] += y12i; Yr[b * n + a] += y12r; Yi[b * n + a] += y12i; }
        continue;
      }
      if (e.t === 'R') gr = 1 / e.v;
      else if (e.t === 'L') { const x = w * e.v, r = e.q ? x / e.q : 0, d = r * r + x * x; gr = r / d; gi = -x / d; }
      else { const bb = w * e.v; gr = e.q ? bb / e.q : 0; gi = bb; }
      if (a >= 0) { Yr[a * n + a] += gr; Yi[a * n + a] += gi; }
      if (b >= 0) { Yr[b * n + b] += gr; Yi[b * n + b] += gi; }
      if (a >= 0 && b >= 0) { Yr[a * n + b] -= gr; Yi[a * n + b] -= gi; Yr[b * n + a] -= gr; Yi[b * n + a] -= gi; }
    }
    for (let p = 0; p < np; p++) { const i = net.ports[p] - 1; Yr[i * n + i] += 1 / z0; }
    // solve Y X = E for unit currents at each port (Gaussian elimination, partial pivoting)
    const Br = new Float64Array(n * np), Bi = new Float64Array(n * np);
    for (let p = 0; p < np; p++) Br[(net.ports[p] - 1) * np + p] = 1;
    for (let c = 0; c < n; c++) {
      let piv = c, best = -1;
      for (let r = c; r < n; r++) { const m = Yr[r * n + c] ** 2 + Yi[r * n + c] ** 2; if (m > best) { best = m; piv = r; } }
      if (piv !== c) {
        for (let j = 0; j < n; j++) { let t = Yr[c * n + j]; Yr[c * n + j] = Yr[piv * n + j]; Yr[piv * n + j] = t; t = Yi[c * n + j]; Yi[c * n + j] = Yi[piv * n + j]; Yi[piv * n + j] = t; }
        for (let j = 0; j < np; j++) { let t = Br[c * np + j]; Br[c * np + j] = Br[piv * np + j]; Br[piv * np + j] = t; t = Bi[c * np + j]; Bi[c * np + j] = Bi[piv * np + j]; Bi[piv * np + j] = t; }
      }
      const pr = Yr[c * n + c], pi = Yi[c * n + c], pd = pr * pr + pi * pi, qr = pr / pd, qi = -pi / pd;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const ar = Yr[r * n + c], ai = Yi[r * n + c];
        if (ar === 0 && ai === 0) continue;
        const fr = ar * qr - ai * qi, fi = ar * qi + ai * qr;
        for (let j = c; j < n; j++) { const xr = Yr[c * n + j], xi = Yi[c * n + j]; Yr[r * n + j] -= fr * xr - fi * xi; Yi[r * n + j] -= fr * xi + fi * xr; }
        for (let j = 0; j < np; j++) { const xr = Br[c * np + j], xi = Bi[c * np + j]; Br[r * np + j] -= fr * xr - fi * xi; Bi[r * np + j] -= fr * xi + fi * xr; }
      }
    }
    const Sr = new Float64Array(np * np), Si = new Float64Array(np * np);
    for (let i = 0; i < np; i++) {
      const r = net.ports[i] - 1, pr = Yr[r * n + r], pi = Yi[r * n + r], pd = pr * pr + pi * pi;
      for (let j = 0; j < np; j++) {
        const xr = Br[r * np + j], xi = Bi[r * np + j];
        Sr[i * np + j] = 2 * (xr * pr + xi * pi) / pd / z0 - (i === j ? 1 : 0);
        Si[i * np + j] = 2 * (xi * pr - xr * pi) / pd / z0;
      }
    }
    return { re: Sr, im: Si, np };
  }
  const dB = (S, i, j) => { const k = (i - 1) * S.np + (j - 1); return 10 * Math.log10(S.re[k] ** 2 + S.im[k] ** 2 + 1e-30); };
  const ph = (S, i, j) => { const k = (i - 1) * S.np + (j - 1); return Math.atan2(S.im[k], S.re[k]) * 180 / Math.PI; };
  const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

  /* ---------- per-frequency figures for each circuit ---------- */
  // returns { s11, s22, iso, thru, coup, imb, phErr }
  function figures(circuit, S) {
    if (circuit === 'wilkinson') {
      const a = dB(S, 2, 1), b = dB(S, 3, 1);
      return { s11: dB(S, 1, 1), s22: Math.max(dB(S, 2, 2), dB(S, 3, 3)), iso: dB(S, 3, 2), thru: a, coup: b, imb: Math.abs(a - b), phErr: Math.abs(wrap(ph(S, 2, 1) - ph(S, 3, 1))) };
    }
    const a = dB(S, 2, 1), b = dB(S, 3, 1), target = circuit === 'branchline' ? 90 : 0;
    return { s11: dB(S, 1, 1), s22: dB(S, 2, 2), iso: dB(S, 4, 1), thru: a, coup: b, imb: Math.abs(a - b), phErr: Math.abs(wrap(ph(S, 2, 1) - ph(S, 3, 1) - target)) };
  }
  // how far a single frequency point is from the spec, in dB-like units. <= 0 means it passes.
  function violation(circuit, F, spec) {
    if (circuit === 'wilkinson') return Math.max(F.s11, F.s22, F.iso) + spec.rl;
    return Math.max(F.s11 + spec.rl, F.iso + spec.rl, (F.imb - spec.imb) * 6, (F.phErr - spec.ph));
  }
  function bandSummary(circuit, net, freqs, spec) {
    const w = { s11: -99, s22: -99, iso: -99, ilMax: 0, ilMin: 99, imb: 0, phErr: 0, viol: -99 };
    for (const f of freqs) {
      const F = figures(circuit, simulate(net, f));
      w.s11 = Math.max(w.s11, F.s11); w.s22 = Math.max(w.s22, F.s22); w.iso = Math.max(w.iso, F.iso);
      w.ilMax = Math.max(w.ilMax, -Math.min(F.thru, F.coup)); w.ilMin = Math.min(w.ilMin, -Math.max(F.thru, F.coup));
      w.imb = Math.max(w.imb, F.imb); w.phErr = Math.max(w.phErr, F.phErr);
      w.viol = Math.max(w.viol, violation(circuit, F, spec));
    }
    w.pass = w.viol <= 0.05;
    return w;
  }
  const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

  /* ---------- differential evolution (best/1/bin with dither), steppable ---------- */
  function makeDE(cost, lo, hi, x0, opts = {}) {
    const d = lo.length, NP = opts.pop || Math.max(24, 8 * d), rnd = rng(opts.seed || 7);
    const pop = [], val = [];
    for (let i = 0; i < NP; i++) {
      const x = new Float64Array(d);
      for (let j = 0; j < d; j++) x[j] = (i === 0 && x0) ? Math.min(hi[j], Math.max(lo[j], x0[j])) : lo[j] + rnd() * (hi[j] - lo[j]);
      pop.push(x); val.push(cost(x));
    }
    let best = 0; for (let i = 1; i < NP; i++) if (val[i] < val[best]) best = i;
    return {
      get best() { return pop[best]; }, get bestVal() { return val[best]; },
      step() {
        const F = 0.5 + 0.5 * rnd(), CR = 0.8;
        for (let i = 0; i < NP; i++) {
          let a, b; do a = Math.floor(rnd() * NP); while (a === i); do b = Math.floor(rnd() * NP); while (b === i || b === a);
          const tr = new Float64Array(d), jr = Math.floor(rnd() * d);
          for (let j = 0; j < d; j++) {
            let v = (rnd() < CR || j === jr) ? pop[best][j] + F * (pop[a][j] - pop[b][j]) : pop[i][j];
            if (v < lo[j] || v > hi[j]) v = lo[j] + rnd() * (hi[j] - lo[j]);
            tr[j] = v;
          }
          const c = cost(tr);
          if (c <= val[i]) { pop[i] = tr; val[i] = c; if (c < val[best]) best = i; }
        }
      }
    };
  }
  function golden(fn, a, b, it = 60) {
    const g = (Math.sqrt(5) - 1) / 2; let c = b - g * (b - a), d = a + g * (b - a), fc = fn(c), fd = fn(d);
    for (let i = 0; i < it; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = fn(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = fn(d); }
    }
    return (a + b) / 2;
  }

  /* ---------- ideal prototypes (lines and resistors) ---------- */
  // Wilkinson: sections numbered from the INPUT. Z[k] line of section k, R[k] resistor at the end of section k.
  function wilkNetIdeal(Z, R, z0, f0) {
    const N = Z.length, els = [];
    for (let br = 0; br < 2; br++) for (let k = 0; k < N; k++)
      els.push({ t: 'TL', a: k === 0 ? 1 : 1 + br * N + k, b: 2 + br * N + k, z: Z[k], th0: Math.PI / 2, f0 });
    for (let k = 0; k < N; k++) els.push({ t: 'R', a: 2 + k, b: 2 + N + k, v: R[k] });
    return { n: 1 + 2 * N, ports: [1, 1 + N, 1 + 2 * N], z0, els };
  }
  const protoCache = {};
  function wilkPrototype(N, f1, f2, z0) {
    const key = N + '|' + (f2 / f1).toFixed(4);
    if (!protoCache[key]) protoCache[key] = wilkProto1(N, 1, f2 / f1, 1);
    const c = protoCache[key];
    return { Z: c.Z.map(v => v * z0), R: c.R.map(v => v * z0), f0: (f1 + f2) / 2, info: c.info };
  }
  function wilkProto1(N, f1, f2, z0) {
    const f0 = (f1 + f2) / 2, r = Math.max(f2 / f1, 1.1);
    const lo = 2 * f0 / (1 + r), hi = 2 * f0 * r / (1 + r), fs = linspace(lo, hi, 31);
    const info = { ratio: f2 / f1 };
    let Z, R;
    if (N === 1) { Z = [Math.SQRT2 * z0]; R = [2 * z0]; return { Z, R, f0, info }; }
    const zs = x => N === 2 ? [x, 2 * z0 * z0 / x] : [x, Math.SQRT2 * z0, 2 * z0 * z0 / x];
    const dummyR = new Array(N).fill(2 * z0);
    const worstS11 = x => { let w = -1e9; const net = wilkNetIdeal(zs(x), dummyR, z0, f0); for (const f of fs) w = Math.max(w, dB(simulate(net, f), 1, 1)); return w; };
    const x = golden(worstS11, Math.SQRT2 * z0 * 1.001, 1.999 * z0);
    Z = zs(x);
    if (N === 2) {
      const z1 = Z[1] / z0, z2 = Z[0] / z0;   // Cohn: subscript 1 at the outputs
      const phi = rad(90 * (1 - (1 / Math.SQRT2) * (r - 1) / (r + 1))), cot2 = 1 / Math.tan(phi) ** 2;
      const R2 = 2 * z1 * z2 / Math.sqrt((z1 + z2) * (z2 - z1 * cot2));
      const R1 = 2 * R2 * (z1 + z2) / (R2 * (z1 + z2) - 2 * z2);
      R = [R2 * z0, R1 * z0]; info.phi = phi * 180 / Math.PI; info.method = 'cohn';
    } else {
      const cost = v => { let w = -1e9; const net = wilkNetIdeal(Z, [Math.exp(v[0]), Math.exp(v[1]), Math.exp(v[2])], z0, f0); for (let i = 0; i < fs.length; i += 2) { const S = simulate(net, fs[i]); w = Math.max(w, dB(S, 2, 2), dB(S, 3, 2)); } return w; };
      const L = v => Math.log(v * z0);
      const de = makeDE(cost, [L(0.8), L(1.2), L(2)], [L(6), L(12), L(40)], [L(2), L(4), L(8)], { pop: 30, seed: 11 });
      for (let g = 0; g < 110; g++) de.step();
      R = Array.from(de.best, Math.exp); info.method = 'minimax'; info.worst = de.bestVal;
    }
    return { Z, R, f0, info };
  }

  /* ---------- E-series rounding ---------- */
  const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  const E24 = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
  const E96 = Array.from({ length: 96 }, (_, i) => Math.round(Math.pow(10, i / 96) * 100) / 100);
  const SERIES = { E12, E24, E96 };
  function roundE(v, series) {
    const tab = SERIES[series]; if (!tab || !(v > 0)) return v;
    const dec = Math.floor(Math.log10(v)), mant = v / 10 ** dec;
    let best = tab[0], bd = Infinity;
    for (const c of tab.concat([10])) { const d = Math.abs(Math.log(c / mant)); if (d < bd) { bd = d; best = c; } }
    return parseFloat((best * 10 ** dec).toPrecision(4));
  }

  /* ---------- build a design ---------- */
  // cfg = { circuit, tech:'lumped'|'ms'|'sl', f1, f2 (Hz), z0, sections, cells, sub:{er,h,t,tand,b}, parts:{lcSeries,rSeries,qL,qC}, spec }
  // returns design = { params:[{des,kind,role,count,theta}], seed:[...], proto, build(values, opts) -> net, ... }
  function makeDesign(cfg) {
    const { circuit, z0 } = cfg, f0 = (cfg.f1 + cfg.f2) / 2, w0 = 2 * Math.PI * f0;
    const lumped = cfg.tech === 'lumped', m = lumped ? (cfg.cells || 1) : 1, thc = rad(90 / m);
    const cellL = Z => Z * Math.sin(thc) / w0, cellC = Z => Math.tan(thc / 2) / (w0 * Z);
    const params = [], seed = [];
    const P = (des, kind, role, count, val, extra) => { params.push(Object.assign({ des, kind, role, count }, extra)); seed.push(val); return params.length - 1; };
    const d = { cfg, circuit, f0, w0, m, lumped, params, seed, lines: null };
    const cut = Math.sqrt(2 / (Math.sin(thc) * Math.tan(thc / 2)));
    d.cutoff = lumped ? f0 * cut : null;

    let structure;   // function(values, add) placing elements; add.L/C/R/TL(a,b,paramIndex,theta)
    if (circuit === 'wilkinson') {
      const N = cfg.sections || 1, proto = wilkPrototype(N, cfg.f1, cfg.f2, z0); d.proto = proto; d.N = N;
      const pos = k => N === 1 ? '' : (k === 0 ? ', section 1 (input side)' : k === N - 1 ? `, section ${N} (output side)` : `, section ${k + 1}`);
      const rpos = k => N === 1 ? 'across the two outputs' : k === N - 1 ? 'across the two outputs' : `across the branches after section ${k + 1}`;
      if (lumped) {
        const iL = [], iC = [], iCi = [], iR = [];
        for (let k = 0; k < N; k++) iL.push(P(`L${k + 1}`, 'L', 'Series inductor' + pos(k), 2 * m, cellL(proto.Z[k])));
        iC.push(P('C0', 'C', 'Shunt capacitor at the input', 1, 2 * cellC(proto.Z[0])));
        for (let k = 0; k < N; k++) iC.push(P(`C${k + 1}`, 'C', k === N - 1 ? 'Shunt capacitor at each output' : `Shunt capacitor after section ${k + 1}`, 2,
          cellC(proto.Z[k]) + (k < N - 1 ? cellC(proto.Z[k + 1]) : 0)));
        if (m > 1) for (let k = 0; k < N; k++) iCi.push(P(`C${k + 1}m`, 'C', `Shunt capacitor between the ${m} inductors of section ${k + 1}`, 2 * (m - 1), 2 * cellC(proto.Z[k])));
        for (let k = 0; k < N; k++) iR.push(P(`R${k + 1}`, 'R', 'Isolation resistor ' + rpos(k), 1, proto.R[k]));
        const node = (br, k, c) => 2 + br * N * m + k * m + c;   // end of cell c of section k
        d.n = 1 + 2 * N * m; d.ports = [1, node(0, N - 1, m - 1), node(1, N - 1, m - 1)];
        structure = add => {
          add.C(1, 0, iC[0]);
          for (let br = 0; br < 2; br++) { let prev = 1; for (let k = 0; k < N; k++) for (let c = 0; c < m; c++) { const nd = node(br, k, c); add.L(prev, nd, iL[k]); add.C(nd, 0, c === m - 1 ? iC[k + 1] : iCi[k]); prev = nd; } }
          for (let k = 0; k < N; k++) add.R(node(0, k, m - 1), node(1, k, m - 1), iR[k]);
        };
      } else {
        const iZ = [], iR = [];
        for (let k = 0; k < N; k++) iZ.push(P(`TL${k + 1}`, 'Z', 'Quarter-wave line' + pos(k), 2, proto.Z[k], { theta: 90 }));
        for (let k = 0; k < N; k++) iR.push(P(`R${k + 1}`, 'R', 'Isolation resistor ' + rpos(k), 1, proto.R[k]));
        d.n = 1 + 2 * N; d.ports = [1, 1 + N, 1 + 2 * N];
        structure = add => {
          for (let br = 0; br < 2; br++) for (let k = 0; k < N; k++) add.TL(k === 0 ? 1 : 1 + br * N + k, 2 + br * N + k, iZ[k], 90);
          for (let k = 0; k < N; k++) add.R(2 + k, 2 + N + k, iR[k]);
        };
      }
      d.portNames = ['Input', 'Output 1', 'Output 2'];
    } else if (circuit === 'branchline') {
      const Za = z0 / Math.SQRT2, Zb = z0; d.proto = { Za, Zb, f0 };
      const arms = [[1, 2, 0], [2, 3, 1], [3, 4, 0], [4, 1, 1]];
      if (lumped) {
        const iL = [P('L1', 'L', 'Series inductor in each through arm (ports 1-2 and 4-3)', 2 * m, cellL(Za)), P('L2', 'L', 'Series inductor in each branch arm (ports 1-4 and 2-3)', 2 * m, cellL(Zb))];
        const iCn = P('C1', 'C', 'Shunt capacitor at each of the four corners', 4, cellC(Za) + cellC(Zb));
        const iCi = m > 1 ? [P('C2', 'C', 'Shunt capacitor between the inductors of each through arm', 2 * (m - 1), 2 * cellC(Za)), P('C3', 'C', 'Shunt capacitor between the inductors of each branch arm', 2 * (m - 1), 2 * cellC(Zb))] : [];
        d.n = 4 + 4 * (m - 1); d.ports = [1, 2, 3, 4];
        structure = add => {
          for (let c = 1; c <= 4; c++) add.C(c, 0, iCn);
          arms.forEach(([a, b, g], ai) => { let prev = a; for (let c = 0; c < m; c++) { const nd = c === m - 1 ? b : 5 + ai * (m - 1) + c; add.L(prev, nd, iL[g]); if (c < m - 1) add.C(nd, 0, iCi[g]); prev = nd; } });
        };
      } else {
        const iZ = [P('TL1', 'Z', 'Through arms (ports 1-2 and 4-3), quarter-wave', 2, Za, { theta: 90 }), P('TL2', 'Z', 'Branch arms (ports 1-4 and 2-3), quarter-wave', 2, Zb, { theta: 90 })];
        d.n = 4; d.ports = [1, 2, 3, 4];
        structure = add => arms.forEach(([a, b, g]) => add.TL(a, b, iZ[g], 90));
      }
      d.portNames = ['Input', 'Through (-90°)', 'Coupled (-180°)', 'Isolated'];
    } else {   // rat-race: ring order 2 - 1 - 3 - 4 - (three quarter-waves) - back to 2
      const Zr = Math.SQRT2 * z0; d.proto = { Zr, f0 };
      const arms = [[2, 1, 0], [1, 3, 1], [3, 4, 0]];
      if (lumped) {
        const iL = [P('L1', 'L', 'Series inductor, arms 2-1 and 3-4', 2 * m, cellL(Zr)), P('L2', 'L', 'Series inductor, arm 1-3', m, cellL(Zr))];
        const iCn = P('C1', 'C', 'Shunt capacitor at ports 1 and 3', 2, 2 * cellC(Zr));
        const iCs = P('C2', 'C', 'Series capacitor between ports 4 and 2 (replaces the 3λ/4 arm)', 1, 1 / (w0 * Zr));
        let iCi, iLs;
        if (m > 1) {
          iCi = P('C3', 'C', 'Shunt capacitor between the inductors of each arm', 3 * (m - 1), 2 * cellC(Zr));
          iLs = P('L3', 'L', 'Shunt inductor at ports 2 and 4', 2, Zr / ((1 - Math.tan(thc / 2)) * w0));
        }
        d.n = 4 + 3 * (m - 1); d.ports = [1, 2, 3, 4];
        structure = add => {
          add.C(1, 0, iCn); add.C(3, 0, iCn); add.C(4, 2, iCs);
          if (m > 1) { add.L(2, 0, iLs); add.L(4, 0, iLs); }
          arms.forEach(([a, b, g], ai) => { let prev = a; for (let c = 0; c < m; c++) { const nd = c === m - 1 ? b : 5 + ai * (m - 1) + c; add.L(prev, nd, iL[g]); if (c < m - 1) add.C(nd, 0, iCi); prev = nd; } });
        };
      } else {
        const iZ = P('TL1', 'Z', 'Ring line (three λ/4 arms and one 3λ/4 arm)', 1, Zr, { theta: 540 });
        d.n = 4; d.ports = [1, 2, 3, 4];
        structure = add => { arms.forEach(([a, b]) => add.TL(a, b, iZ, 90)); add.TL(4, 2, iZ, 270); };
      }
      d.portNames = ['Sum input (Σ)', 'Output A', 'Output B', 'Difference port (Δ)'];
    }

    // physical lines for microstrip / stripline: width, length, loss model, from a set of impedances
    d.physical = values => {
      const sub = cfg.sub, out = {};
      params.forEach((p, i) => {
        if (p.kind !== 'Z') return;
        const s = cfg.tech === 'ms' ? msSynth(values[i], sub.h, sub.t, sub.er) : slSynth(values[i], sub.b, sub.t, sub.er);
        const mdl = lineModel(Object.assign({ kind: cfg.tech }, sub), s.W, values[i], s.eeff);
        const ee = lineEeff(mdl, f0), lamG = C0 / (f0 * Math.sqrt(ee));
        out[i] = { W: s.W, Z: values[i], eeff0: s.eeff, eeffF: ee, lamG, mdl, lossDbPerM: 8.686 * lineAlpha(mdl, f0, ee) };
      });
      return out;
    };

    // build a netlist. opts: { real:bool (losses, physical lines), phys (from d.physical), jit:{L,C,R} fn, mc:{er, wScale} }
    d.build = (values, opts = {}) => {
      const els = [], parts = cfg.parts || {}, jit = opts.jit;
      const add = {
        L: (a, b, i) => els.push({ t: 'L', a, b, v: values[i] * (jit ? jit('L') : 1), q: opts.real ? parts.qL : 0 }),
        C: (a, b, i) => els.push({ t: 'C', a, b, v: values[i] * (jit ? jit('C') : 1), q: opts.real ? parts.qC : 0 }),
        R: (a, b, i) => els.push({ t: 'R', a, b, v: values[i] * (jit ? jit('R') : 1) }),
        TL: (a, b, i, theta) => {
          if (!opts.real || !opts.phys) { els.push({ t: 'TL', a, b, z: values[i], th0: rad(theta), f0 }); return; }
          const ph0 = opts.phys[i], len = theta / 360 * ph0.lamG;
          if (opts.mc) {
            const sub = Object.assign({}, cfg.sub, { er: opts.mc.er }), W = ph0.W * opts.mc.wScale;
            const an = cfg.tech === 'ms' ? msAnalyze(W, sub.h, sub.t, sub.er) : slAnalyze(W, sub.b, sub.t, sub.er);
            els.push({ t: 'TL', a, b, z: an.z0, len, m: lineModel(Object.assign({ kind: cfg.tech }, sub), W, an.z0, an.eeff) });
          } else els.push({ t: 'TL', a, b, z: ph0.Z, len, m: ph0.mdl });
        }
      };
      structure(add);
      return { n: d.n, ports: d.ports, z0, els };
    };
    d.round = values => values.map((v, i) => {
      const k = params[i].kind, parts = cfg.parts || {};
      return k === 'R' ? roundE(v, parts.rSeries || 'E24') : k === 'Z' ? v : roundE(v, parts.lcSeries || 'E24');
    });
    return d;
  }

  /* ---------- band optimiser for a design (lumped values, or lines + resistors) ---------- */
  function makeOptimiser(d, spec, seedVals) {
    const { cfg, params } = d, x0 = (seedVals || d.seed).map(Math.log);
    const idx = params.map((p, i) => i).filter(i => d.lumped || params[i].kind === 'R' || d.circuit !== 'ratrace');
    const lo = [], hi = [];
    idx.forEach(i => {
      const p = params[i], s = d.seed[i];
      if (p.kind === 'R') { lo.push(Math.log(0.5 * cfg.z0)); hi.push(Math.log(30 * cfg.z0)); }
      else if (p.kind === 'Z') { lo.push(Math.log(Math.max(20, s / 1.6))); hi.push(Math.log(Math.min(160, s * 1.6))); }
      else { lo.push(Math.log(s / 4)); hi.push(Math.log(s * 3)); }
    });
    const nf = d.n > 9 ? 13 : 17, fs = linspace(cfg.f1, cfg.f2, nf), full = d.seed.slice();
    const unpack = x => { idx.forEach((i, j) => { full[i] = Math.exp(x[j]); }); return full; };
    const cost = x => {
      const net = d.build(unpack(x)); let w = -1e9;
      for (const f of fs) w = Math.max(w, violation(d.circuit, figures(d.circuit, simulate(net, f)), spec));
      return w;
    };
    const de = makeDE(cost, lo, hi, idx.map(i => x0[i]), { pop: Math.min(60, Math.max(28, 7 * idx.length)), seed: 5 });
    const gens = 120 + 40 * idx.length;
    return { de, gens, values: () => unpack(de.best).slice(), dims: idx.length };
  }


  /* ---------- standard-value refinement: try neighbouring values, keep what helps ---------- */
  function stepE(v, series, k) {
    const tab = SERIES[series]; if (!tab) return v;
    const r = roundE(v, series), dec = Math.floor(Math.log10(r) + 1e-9), mant = r / 10 ** dec;
    let i = 0, bd = Infinity; tab.forEach((c, j) => { const d = Math.abs(c - mant); if (d < bd) { bd = d; i = j; } });
    const j = i + k, n = tab.length, wrapDec = Math.floor(j / n);
    return parseFloat((tab[((j % n) + n) % n] * 10 ** (dec + wrapDec)).toPrecision(4));
  }
  function refineRounded(d, vals, spec) {
    const cfg = d.cfg, parts = cfg.parts || {}, fs = linspace(cfg.f1, cfg.f2, 17);
    let cur = d.round(vals);
    const phys = d.lumped ? null : d.physical(cur);
    const cost = v => { const net = d.build(v, { real: true, phys }); let w = -1e9; for (const f of fs) w = Math.max(w, violation(d.circuit, figures(d.circuit, simulate(net, f)), spec)); return w; };
    let best = cost(cur), changed = 0;
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      d.params.forEach((p, i) => {
        if (p.kind === 'Z') return;
        const series = p.kind === 'R' ? (parts.rSeries || 'E24') : (parts.lcSeries || 'E24');
        const base = cur[i];
        for (const k of [-2, -1, 1, 2]) {
          const cand = cur.slice(); cand[i] = stepE(base, series, k);
          const c = cost(cand);
          if (c < best - 0.02) { best = c; cur = cand; improved = true; changed++; }
        }
      });
      if (!improved) break;
    }
    return { values: cur, changed };
  }

  /* ---------- tolerance analysis: random builds within the stated tolerances ---------- */
  function monteCarlo(d, vals, phys, spec, tol, runs = 200) {
    const cfg = d.cfg, rnd = rng(99), fs = linspace(cfg.f1, cfg.f2, 13), u = () => 2 * rnd() - 1;
    const keys = ['s11', 's22', 'iso', 'ilMax', 'imb', 'phErr'], acc = {}; keys.forEach(k => acc[k] = []);
    let pass = 0;
    for (let r = 0; r < runs; r++) {
      const jit = k => 1 + (tol[k] || 0) * u();
      const mc = d.lumped ? null : { er: cfg.sub.er + (tol.er || 0) * u(), wScale: 1 + (tol.w || 0) * u() };
      const s = bandSummary(d.circuit, d.build(vals, { real: true, phys, jit, mc }), fs, spec);
      if (s.pass) pass++;
      keys.forEach(k => acc[k].push(s[k]));
    }
    const p95 = {}; keys.forEach(k => { acc[k].sort((a, b) => a - b); p95[k] = acc[k][Math.min(runs - 1, Math.floor(0.95 * runs))]; });
    return { yield: pass / runs, p95, runs };
  }

  return { stepE, refineRounded, monteCarlo, C0, simulate, dB, ph, wrap, figures, violation, bandSummary, linspace, makeDE, golden, rng,
    msAnalyze, msSynth, msEeffF, slExact, slAnalyze, slSynth, lineModel, lineEeff, lineAlpha,
    wilkPrototype, wilkNetIdeal, roundE, SERIES, makeDesign, makeOptimiser };
})();
if (typeof module !== 'undefined') module.exports = RF;

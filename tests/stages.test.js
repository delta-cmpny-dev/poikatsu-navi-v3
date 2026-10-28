const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'stages.js'), 'utf8');
const stages = JSON.parse(vm.runInNewContext(source + '\nJSON.stringify(STAGES)'));
let checks = 0;
function test(name, fn) {
  try { fn(); checks++; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const order = ['safari', 'tracking', 'relay', 'android', 'unext-flow', 'unext-pending', 'browser-flow', 'a8-flow', 'passbook', 'passbook-moppy', 'inquiry-hapitas', 'inquiry-moppy', 'fx-demo'];
test('unique IDs and requested order', () => {
  assert.equal(new Set(stages.map(s => s.id)).size, stages.length);
  assert.equal(JSON.stringify(stages.map(s => s.id)), JSON.stringify(order));
});
test('every stage shows guide boxes from the start', () => {
  for (const s of stages) assert.equal(s.guide, true, s.id);
});
test('every scroll followed by a tap accepts a mid-scroll tap', () => {
  for (const st of stages) st.steps.forEach((s, i) => {
    if (s.type === 'scroll' && st.steps[i + 1]?.type === 'tap') assert.ok(s.target, st.id + ':' + i);
  });
});
test('Safari tracking warning is the short keep-once note', () => {
  assert.equal(stages[0].steps.find(s => s.after).warn, '「サイト越えトラッキングを防ぐ」は一度設定すればキープされるので、毎回の確認は不要。');
});
function rect(r, label) {
  assert.ok(Array.isArray(r) && r.length === 4 && r.every(Number.isFinite), label);
  const [x, y, w, h] = r;
  assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 590 && y + h <= 1280, label);
}
function overlap(a, b) {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}
for (const stage of stages) test(stage.id + ' data and assets', () => {
  assert.ok(stage.title && stage.lead && stage.steps.length);
  for (const [i, s] of stage.steps.entries()) {
    const label = stage.id + ':' + (i + 1);
    assert.ok(['tap', 'scroll', 'quiz', 'info'].includes(s.type), label);
    assert.ok(s.text, label);
    if (s.type === 'tap') { rect(s.rect, label); assert.ok(s.img || s.html, label); }
    if (s.type === 'scroll') {
      assert.ok(Array.isArray(s.seq) && s.seq.length === 2 && typeof s.seq[0] === 'string', label);
      assert.ok(Number.isInteger(s.seq[1]) && s.seq[1] > 0, label);
      if (s.target) {
        assert.equal(stage.steps[i + 1]?.type, 'tap', label);
        assert.ok(Number.isInteger(s.target.from) && s.target.from >= 1 && s.target.from <= s.seq[1], label);
        assert.equal(s.target.ys.length, s.seq[1], label);
        for (const y of s.target.ys.slice(s.target.from - 1).filter(y => y != null)) {
          const [x, , w, h] = stage.steps[i + 1].rect;
          rect([x, y, w, h], label);
        }
      }
    }
    if (s.type === 'quiz') {
      assert.ok(Array.isArray(s.choices) && s.choices.length >= 2, label);
      assert.equal(s.choices.filter(c => c.ok === true).length, 1, label);
      for (const c of s.choices) assert.ok(c.label && (c.ok || c.msg), label);
    }
    if (s.rect) rect(s.rect, label);
    for (const t of s.traps || []) {
      rect(t.rect, label); assert.ok(t.msg || t.alert, label);
      assert.ok(!s.rect || !overlap(s.rect, t.rect), label + ' overlapping trap');
    }
    for (const name of [s.img, s.after].filter(Boolean)) assert.ok(fs.existsSync(path.join(root, 'img', name + '.jpg')), label + ' ' + name);
    if (s.seq) for (let k = 1; k <= s.seq[1]; k++) assert.ok(fs.existsSync(path.join(root, 'img', 'seq', s.seq[0] + '-' + String(k).padStart(2, '0') + '.jpg')), label);
    assert.ok(!s.link, label + ' link steps are replaced by in-app videos');
    if (s.video) { assert.equal(s.type, 'info', label); assert.ok(fs.existsSync(path.join(root, 'video', s.video + '.mp4')), label + ' ' + s.video); }
    if (s.html) { assert.equal(typeof s.html, 'string'); assert.ok(s.html.length); }
  }
});
test('android overrides use existing images and valid targets', () => {
  for (const st of stages) st.steps.forEach((s, i) => {
    if (!s.android) return;
    const a = { ...s, ...s.android }, label = st.id + ':' + (i + 1) + ' android';
    if (a.rect) rect(a.rect, label);
    for (const t of a.traps || []) { rect(t.rect, label); assert.ok(!overlap(a.rect, t.rect), label + ' overlapping trap'); }
    if (a.img) assert.ok(fs.existsSync(path.join(root, 'img', a.img + '.jpg')), label + ' ' + a.img);
    if (a.choices) assert.equal(a.choices.filter(c => c.ok === true).length, 1, label);
  });
});
test('Safari bars cut on Android never hide a tap target', () => {
  const bars = vm.runInNewContext(fs.readFileSync(path.join(root, 'safari-bars.js'), 'utf8') + '\nSAFARI_BARS');
  for (const name of Object.keys(bars)) assert.ok(fs.existsSync(path.join(root, 'img', name + '.jpg')), name);
  const visible = (label, name, r) => {
    const b = bars[name];
    if (b && r) assert.ok(r[1] >= b[0] && r[1] + r[3] <= b[1], `${label} ${name} ${r} under ${b}`);
  };
  for (const st of stages.filter(s => s.device !== 'iphone')) st.steps.forEach((s0, i) => {
    const s = { ...s0, ...s0.android }, label = st.id + ':' + (i + 1);
    for (const name of [s.img, s.after].filter(Boolean))
      for (const r of [s.rect, ...(s.alts || []), ...(s.marks || []), ...(s.traps || []).map(t => t.rect), s.warnMark]) visible(label, name, r);
    if (s.seq && s.target) s.target.ys.forEach((y, k) => {
      if (y != null) visible(label, `seq/${s.seq[0]}-${String(k + 1).padStart(2, '0')}`, [0, y, 1, st.steps[i + 1].rect[3]]);
    });
  });
});
test('FX banners have no colored squares', () => {
  assert.doesNotMatch(source, /🟥|🟦/);
});
console.log(checks + ' data checks passed');

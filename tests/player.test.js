// DOMを最小限再現し、本体のイベント処理を外部パッケージなしで検査する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const nodes = new Map();
function node(id) {
  if (nodes.has(id)) return nodes.get(id);
  const n = { id, style: {}, dataset: {}, innerHTML: '', textContent: '', className: '', hidden: false, clientHeight: 640,
    events: {}, addEventListener(type, fn) { this.events[type] = fn; },
    removeAttribute(name) { delete this[name]; }, setAttribute(name, value) { this[name] = value; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 295, height: 640 }; },
    closest(selector) { return selector === '#card' && id === 'card' ? this : null; },
  };
  n.classList = {
    contains(c) { return n.className.split(' ').includes(c); },
    add(c) { if (!this.contains(c)) n.className += ' ' + c; },
    remove(c) { n.className = n.className.split(' ').filter(x => x !== c).join(' '); },
    toggle(c, on) { on ? this.add(c) : this.remove(c); },
  };
  nodes.set(id, n); return n;
}
const timers = new Map(), images = [], saved = new Map(); let timerId = 0;
const ctx = vm.createContext({
  document: { getElementById: node, querySelectorAll: () => ['home', 'play', 'clear'].map(node) },
  window: { scrollTo() {}, addEventListener() {} }, navigator: {}, location: { search: '' }, URLSearchParams,
  localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, String(v)) },
  Image: class { set src(value) { images.push(value); } },
  ResizeObserver: class { observe() {} },
  setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
});
vm.runInContext(fs.readFileSync(path.join(root, 'stages.js'), 'utf8'), ctx);
// 1つ目の<script>は stages.js の読み込み用。本体は一番長い<script>
vm.runInContext([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((x, y) => y.length - x.length)[0], ctx);
const run = code => vm.runInContext(code, ctx);
function flush(limit = Infinity) {
  const callbacks = [...timers.entries()].filter(([, t]) => t.ms <= limit);
  callbacks.forEach(([id]) => timers.delete(id)); callbacks.forEach(([, t]) => t.fn());
}
function clickCard(dataset) { node('card').events.click({ target: { dataset, classList: { add() {} } } }); }
function tap(r) {
  const e = { clientX: (r[0] + r[2] / 2) / 2, clientY: (r[1] + r[3] / 2) / 2, target: node('shot') };
  node('shot').events.pointerdown(e); node('shot').events.pointerup(e);
}
assert.match(node('stages').innerHTML, /stage-number/);
assert.match(node('stages').innerHTML, /まだクリアしていません/);
// HTML自体にも採点表示を残さない。最小DOMは存在しないIDも作れるため別途検査する。
assert.doesNotMatch(page, /id="(?:missN|stars|result)"|[★☆]|ミス\s|ノーミス/);
// 別の版の記録(同じドメイン)は読まない。この版の記録だけでクリア済みになり、全体の進み具合に数える
saved.set('cleared-safari', 'true'); run('home()');
assert.match(node('done').innerHTML, /全13ステージ中 <em>0<\/em>/);
saved.set('v3-cleared-safari', 'true'); run('home()');
assert.match(node('stages').innerHTML, /クリア済み ✓/);
assert.match(node('done').innerHTML, /全13ステージ中 <em>1<\/em>/);
saved.clear(); run('home()');

const STAGES_SCROLL_TARGETS = JSON.parse(run('JSON.stringify(STAGES[0].steps.map((s, i) => s.target ? i : -1).filter(i => i >= 0))'));
function openStep(stageIndex, stepIndex) { run(`start(${stageIndex}); si = ${stepIndex}; step()`); }
function frame(k) {
  run(`scrollBy(((${k} - 1) / (stage.steps[si].seq[1] - 1) - scrollP) * shot.clientHeight * (stage.steps[si].len || 1.5))`);
}
function targetAt(s, next, k) { return [next.rect[0], s.target.ys[k - 1], next.rect[2], next.rect[3]]; }
function assertGuide(rect) {
  assert.ok(node('target').classList.contains('hint'));
  assert.equal(node('target').style.left, rect[0] / 5.9 + '%');
  assert.equal(node('target').style.top, rect[1] / 12.8 + '%');
  assert.equal(node('target').style.width, rect[2] / 5.9 + '%');
  assert.equal(node('target').style.height, rect[3] / 12.8 + '%');
}
openStep(0, 1); assertGuide(run('stage.steps[si].rect'));
// どのステージのタップ画面でも、最初から枠が出る。間違えてもひとことが出る。
openStep(0, 4); assertGuide(run('stage.steps[si].rect'));
tap([580, 1200, 0, 0]); assertGuide(run('stage.steps[si].rect'));
assert.ok(node('toast').classList.contains('on'));
flush();

for (const stepIndex of STAGES_SCROLL_TARGETS) {
  openStep(0, stepIndex);
  const s = run('stage.steps[si]'), next = run('stage.steps[si + 1]');
  if (s.target.from > 1) {
    frame(s.target.from - 1);
    assert.ok(!node('target').classList.contains('hint'));
    tap(targetAt(s, next, s.target.from - 1));
    assert.equal(run('si'), stepIndex); assert.equal(run('stepMisses'), 1);
    assert.ok(node('toast').classList.contains('on'));
  }
  // 境界コマから最終コマ直前まで、表示コマとガイドの位置が一致する。
  for (let k = s.target.from; k < s.seq[1]; k++) {
    frame(k); assertGuide(targetAt(s, next, k));
    assert.equal(node('img').src, `img/seq/${s.seq[0]}-${String(k).padStart(2, '0')}.jpg`);
    assert.equal(node('swipe').style.display, 'none'); // タップ場所が見えたら指マークは消す
  }
  if (s.target.from > 1) { frame(s.target.from - 1); assert.equal(node('swipe').style.display, 'block'); }
  frame(s.target.from);
  if (s.target.from > 1) {
    frame(s.target.from - 1); assert.ok(!node('target').classList.contains('hint'));
    frame(s.target.from); assertGuide(targetAt(s, next, s.target.from));
  }
  tap([580, 1200, 0, 0]); assert.equal(run('si'), stepIndex);
  const expectedRect = targetAt(s, next, s.target.from);
  tap(expectedRect);
  assert.equal(run('si'), stepIndex + 1); assert.equal(run('busy'), true);
  assert.equal(node('swipe').style.display, 'none');
  assert.ok(node('target').classList.contains('hit'));
  assert.equal(node('target').style.top, expectedRect[1] / 12.8 + '%');
  tap(expectedRect); // 成功演出中の連打では進まない。
  assert.equal(run('si'), stepIndex + 1);
  flush(350);
  if (next.after) assert.equal(node('img').src, `img/${next.after}.jpg`);
  flush();
  if (next.warn) {
    assert.ok(node('modal').classList.contains('on'));
    assert.equal(node('modalText').textContent, next.warn);
    assert.equal(run('si'), stepIndex + 1);
    node('modalOk').onclick();
  }
  assert.equal(run('si'), stepIndex + 2);
}
// 指を上下に動かして元の位置で離しても、途中タップにはしない。
const dragStep = STAGES_SCROLL_TARGETS[0];
openStep(0, dragStep);
const drag = { clientX: 150, clientY: 560, target: node('shot') };
node('shot').events.pointerdown(drag);
node('shot').events.pointermove({ ...drag, clientY: 520 });
node('shot').events.pointermove(drag);
node('shot').events.pointerup(drag);
assert.equal(run('si'), dragStep); assert.equal(run('stepMisses'), 0);
// 途中タップの成功演出も、中断・再開で無効になる。
const dragS = run(`stage.steps[${dragStep}]`), dragNext = run(`stage.steps[${dragStep + 1}]`);
frame(dragS.target.from); tap(targetAt(dragS, dragNext, dragS.target.from)); node('quit').onclick(); run('start(0)'); flush();
assert.equal(run('si'), 0);
console.log('PASS scroll target taps, boundaries, guides, drag suppression, and legacy completion');

const count = run('STAGES.length');
for (let i = 0; i < count; i++) {
  run(`start(${i})`);
  const steps = run('stage.steps');
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k];
    assert.equal(run('si'), k);
    if (!s.img && !s.html) {
      assert.ok(node('img').hidden);
      assert.equal(node('card').className, 'mid');
      assert.ok(node('shot').classList.contains('plain'));
    }
    if (s.type === 'info' || s.type === 'quiz') assert.equal(node('shot').style.touchAction, 'pan-y');
    if (s.html) { assert.equal(node('scene').innerHTML, s.html); assert.ok(!node('scene').hidden); }
    else assert.equal(node('scene').innerHTML, '');
    if (s.video) {
      assert.match(node('card').innerHTML, /data-video/);
      clickCard({ video: '' }); assert.equal(run('si'), k);
      assert.ok(node('player').classList.contains('on'));
      assert.match(node('video').src, new RegExp('video/' + s.video + '\.mp4$'));
      node('playerClose').onclick(); assert.ok(!node('player').classList.contains('on'));
    }
    if (s.type === 'info') { if (s.next) assert.match(node('card').innerHTML, new RegExp('>' + s.next + '<')); clickCard({ next: '' }); }
    if (s.type === 'quiz') {
      const wrong = s.choices.findIndex(c => !c.ok);
      clickCard({ c: String(wrong) }); assert.equal(run('si'), k);
      clickCard({ c: String(s.choices.findIndex(c => c.ok)) });
    }
    if (s.type === 'tap') {
      if (s.traps?.length) {
        const tr = s.traps[0]; tap(tr.rect); assert.equal(run('si'), k);
        if (tr.alert) {
          // アプリを押すと、重要ポイントが出て、閉じても進まない。
          assert.ok(node('modal').classList.contains('on')); assert.equal(node('modalText').textContent, tr.alert);
          node('modalOk').onclick(); assert.ok(!node('modal').classList.contains('on')); assert.equal(run('si'), k);
        } else assert.equal(node('toast').textContent, tr.msg);
      }
      tap(s.rect);
    }
    if (s.type === 'scroll') {
      run('scrollBy(shot.clientHeight * (stage.steps[si].len || 1.5) * .25)');
      assert.equal(node('swipe').style.display, run('activeRect()') ? 'none' : 'block');
      run('scrollBy(100000)'); assert.match(node('img').src, /seq\//);
      assert.equal(node('swipe').style.display, 'none');
    }
    flush();
    if (s.warn) { assert.ok(node('modal').classList.contains('on')); assert.equal(node('modalText').textContent, s.warn); node('modalOk').onclick(); }
  }
  assert.ok(node('clear').classList.contains('on'));
  assert.equal(saved.get('v3-cleared-' + run('stage.id')), 'true');
  assert.equal(saved.has('stars-' + run('stage.id')), false);
  for (const s of steps.filter(s => s.warn)) assert.ok(node('review').innerHTML.includes(s.warn));
  console.log('PASS full playthrough ' + run('stage.id'));
}
assert.ok(images.every(src => !src.includes('undefined')));
run('home()');
assert.equal((node('stages').innerHTML.match(/クリア済み ✓/g) || []).length, count);
assert.doesNotMatch(node('stages').innerHTML, /[★☆]|まだクリアしていません/);
// 保存が使えない環境でも、クリアとホーム表示を続行する。
run('localStorage.getItem = () => { throw Error("unavailable"); }; localStorage.setItem = () => { throw Error("unavailable"); }; start(0); clear(); home()');
assert.ok(node('home').classList.contains('on'));
// タップ成功の待機中にやめて再開しても、前のタイマーが次のゲームを進めない。
run('start(0); si = 1; step()'); tap(run('stage.steps[si].rect'));
node('quit').onclick(); run('start(0)'); flush(); assert.equal(run('si'), 0);
console.log('PASS display modes, links, warnings, existing scrolls, and quit/restart');

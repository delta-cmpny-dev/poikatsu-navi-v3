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
vm.runInContext(fs.readFileSync(path.join(root, 'safari-bars.js'), 'utf8'), ctx);
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
assert.match(node('done').innerHTML, /全12ステージ中 <em>0<\/em>/);
saved.set('v3-cleared-safari', 'true'); run('home()');
assert.match(node('stages').innerHTML, /クリア済み ✓/);
assert.match(node('done').innerHTML, /全12ステージ中 <em>1<\/em>/);
// iPhoneでは準備編(Android版)を出さず数えない。Androidを選ぶとiPhone用の準備編3つが消える
assert.doesNotMatch(node('stages').innerHTML, /Android版/);
assert.match(node('stages').innerHTML, /準備編[\s\S]*1\/3/);
saved.set('v3-device', 'android'); run('home()');
assert.match(node('done').innerHTML, /全10ステージ中/);
assert.match(node('stages').innerHTML, /Android版/);
assert.doesNotMatch(node('stages').innerHTML, /Safariの設定/);
run('stage = STAGES.find(s => s.id === "android")');
assert.equal(run('STAGES[nextStage()].id'), 'unext-flow');
saved.set('v3-device', 'iphone'); run('stage = STAGES.find(s => s.id === "relay")');
assert.equal(run('STAGES[nextStage()].id'), 'unext-flow');
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
assert.equal((node('stages').innerHTML.match(/クリア済み ✓/g) || []).length, count - 1); // iPhone表示ではAndroid版を出さない
assert.doesNotMatch(node('stages').innerHTML, /[★☆]|まだクリアしていません/);
// 保存が使えない環境でも、クリアとホーム表示を続行する。
run('localStorage.getItem = () => { throw Error("unavailable"); }; localStorage.setItem = () => { throw Error("unavailable"); }; start(0); clear(); home()');
assert.ok(node('home').classList.contains('on'));
// タップ成功の待機中にやめて再開しても、前のタイマーが次のゲームを進めない。
run('start(0); si = 1; step()'); tap(run('stage.steps[si].rect'));
node('quit').onclick(); run('start(0)'); flush(); assert.equal(run('si'), 0);
console.log('PASS display modes, links, warnings, existing scrolls, and quit/restart');

// Androidを選ぶと、準備編のあとのステージも「Safari」ではなく「Chrome」で案内する(ブラウザの中の画面はiPhoneのまま)
ctx.localStorage.getItem = k => saved.get(k); ctx.localStorage.setItem = (k, v) => saved.set(k, String(v));
saved.clear(); flush();
const indexOf = id => run(`STAGES.findIndex(s => s.id === ${JSON.stringify(id)})`);
saved.set('v3-device', 'android'); run('home()');
assert.doesNotMatch(node('stages').innerHTML, /Safari/);
assert.match(node('stages').innerHTML, /スクールの案内のURLをChromeで開くまで/);
for (const id of JSON.parse(run('JSON.stringify(visible().map(s => s.id))'))) {
  run(`start(${indexOf(id)})`);
  assert.doesNotMatch(run("JSON.stringify({ ...stage, base: null })"), /Safari/, id);
}
// 入口はAndroidのホーム画面。Chromeで進み、ポイントサイトのアプリは重要ポイントを出して進まない
run(`start(${indexOf('unext-flow')})`);
const entry = run('stage.steps.findIndex(s => s.img === "an-home-apps")');
assert.ok(entry >= 0);
run(`si = ${entry}; step()`);
assert.equal(node('img').src, 'img/an-home-apps.jpg');
assert.match(node('card').innerHTML, /Chromeを開こう/);
tap([324, 528, 92, 124]);
assert.ok(node('modal').classList.contains('on'));
assert.match(node('modalText').textContent, /Chromeから開く癖/);
assert.equal(run('si'), entry);
node('modalOk').onclick(); tap([180, 531, 86, 84]); assert.equal(run('si'), entry); flush(); assert.equal(run('si'), entry + 1);
// ブラウザを開いた最初の画面(検索欄)もChromeの画面。ブラウザ経由のステージも同じ
assert.equal(node('img').src, 'img/an-chrome.jpg');
run(`start(${indexOf('browser-flow')})`);
assert.ok(run('stage.steps.some(s => s.img === "an-chrome" && s.text === "Chromeを開いて、検索欄をタップしよう")'));
run(`start(${indexOf('unext-flow')})`);
// 「もう一度」「次のステージへ」は元のステージで探す
run('clear()'); assert.equal(run('STAGES[nextStage()].id'), 'unext-pending');
node('again').onclick(); assert.equal(run('stage.id'), 'unext-flow');
// Safariの画面は、上下のバーを切り取って見せる(Chromeの画面・スクロールのコマも)
run(`start(${indexOf('passbook')})`);
assert.equal(node('img').src, 'img/hapitas-top.jpg');
assert.equal(node('img').style.clipPath, `inset(${140 / 12.8}% 0 ${110 / 12.8}% 0)`);
assert.equal(node('shot').style.background, 'transparent');
run(`start(${indexOf('browser-flow')}); si = stage.steps.findIndex(s => s.img === "an-chrome"); step()`);
assert.equal(node('img').style.clipPath, ''); assert.equal(node('shot').style.background, '');
run(`start(${indexOf('inquiry-hapitas')}); si = stage.steps.findIndex(s => s.seq?.[0] === "ihexp"); step(); scrollBy(shot.clientHeight * 0.5)`);
assert.match(node('img').src, /seq\/ihexp-/);
assert.equal(node('img').style.clipPath, `inset(${140 / 12.8}% 0 0% 0)`); // スクロールの途中はツールバーが消えている
// iPhoneは今までどおりSafari
saved.set('v3-device', 'iphone');
run(`start(${indexOf('passbook')})`);
assert.equal(node('img').style.clipPath, ''); assert.equal(node('shot').style.background, '');
run(`start(${indexOf('unext-flow')})`);
const home = run('stage.steps.findIndex(s => s.img === "hapitas-home")');
assert.ok(home > 0); assert.equal(run(`stage.steps[${home + 1}].img`), 'hr-safari');
assert.match(run('JSON.stringify(stage)'), /Safariを開こう/);
console.log('PASS android shows Chrome instead of Safari');

// 狭い押す場所は少し外れても正解。間違いの場所(traps)は今までどおり優先する
run(`start(${indexOf('inquiry-moppy')})`);
const cal = run('stage.steps.findIndex(s => s.img === "im-cal")');
run(`si = ${cal}; step()`);
const [cx, cy, cw, ch] = run('stage.steps[si].rect');
// カレンダーは、どの日付を押しても進む(19日・11日・25日・31日・年月の行)
const mid = [cx + cw / 2, cy + ch / 2];
for (const [x, y] of [[mid[0] + 51.5, mid[1]], [mid[0], mid[1] - 33], [mid[0], mid[1] + 33], [400, 673], [240, 462]]) {
  run(`si = ${cal}; step()`);
  tap([x, y, 0, 0]); assert.equal(run('si'), cal); flush(); assert.equal(run('si'), cal + 1, `${x},${y}`);
}
// カレンダーの外(キーボード)を押したときは進まない
run(`si = ${cal}; step()`);
tap([300, 950, 0, 0]); assert.equal(run('si'), cal); assert.equal(node('toast').textContent, 'そこじゃないよ');
flush();
run('stage = { id: "t", steps: [{ type: "tap", img: "im-cal", text: "t", rect: [100, 100, 50, 28], traps: [{ rect: [155, 100, 50, 28], msg: "となりの日" }] }] }; si = 0; step()');
tap([160, 105, 0, 0]); assert.equal(run('si'), 0); assert.equal(node('toast').textContent, 'となりの日');
flush(); run('si = 0; step()');
tap([60, 114, 0, 0]); assert.equal(node('toast').textContent, 'そこじゃないよ');
flush(); run('si = 0; step()');
tap([85, 95, 0, 0]); flush(); assert.equal(run('si'), 1);
console.log('PASS small tap targets accept near taps but keep traps');

// スクロールの場面は、探す項目が見えたら「ゴール」の枠を出す(ニケさんの直し 10/28)。
// 枠が全部見えたら、最後までスクロールしなくても次の画面へ進む(本人の直し 10/29)
saved.set('v3-device', 'android');
run(`start(${indexOf('android')})`);
const js = run('stage.steps.findIndex(s => s.seq?.[0] === "ansite")');
run(`si = ${js}; step()`);
assert.match(run('stage.steps[si].text'), /「JavaScript」を探そう/);
assert.equal(node('goal').hidden, true);
frame(20); assert.equal(node('goal').hidden, true); assert.equal(run('busy'), false);
frame(21); assert.equal(node('goal').hidden, false);
assert.equal(node('goal').dataset.label, 'ゴール');
assert.equal(node('goal').style.top, 1185 / 12.8 + '%');
assert.equal(run('busy'), true); assert.equal(run('si'), js);
flush(); assert.equal(run('si'), js + 1);
assert.equal(node('goal').hidden, true);
// 次の画面は、ゴールだったJavaScriptの確認
assert.equal(JSON.stringify(run('stage.steps[si].marks')), JSON.stringify([[20, 1028, 550, 92]]));
// 説明の窓に隠れている間は進まない(逆にスクロールすると枠は消える)。隠れていても枠を押せば進む
const cardRect = node('card').getBoundingClientRect;
node('card').getBoundingClientRect = () => ({ left: 0, top: 0, width: 295, height: 640, bottom: 640 });
run(`si = ${js}; step()`);
frame(21); assert.equal(node('goal').hidden, false); assert.equal(run('busy'), false);
frame(10); assert.equal(node('goal').hidden, true);
frame(21); tap([300, 300, 0, 0]); assert.equal(run('si'), js); // 枠の外を押しても進まない
flush(); tap([20, 1185, 550, 92]); flush(); assert.equal(run('si'), js + 1);
// 窓の下端を見た目の位置で測る(真ん中に出す窓でも、枠の上端より上で終わっていれば進む)
node('card').getBoundingClientRect = () => ({ left: 0, top: 180, width: 295, height: 183, bottom: 363 }); // 画像の座標で726
run(`start(${indexOf('passbook-moppy')}); si = stage.steps.findIndex(s => s.seq?.[0] === "moppymp"); step()`);
frame(19); assert.equal(run('busy'), true); flush();
node('card').getBoundingClientRect = () => ({ left: 0, top: 180, width: 295, height: 184, bottom: 364 });
run('si = stage.steps.findIndex(s => s.seq?.[0] === "moppymp"); step()');
frame(19); assert.equal(run('busy'), false);
node('card').getBoundingClientRect = cardRect;
// モッピーの通帳は、38コマのうち枠が出る19コマ目で進む
saved.set('v3-device', 'iphone');
run(`start(${indexOf('passbook-moppy')}); si = stage.steps.findIndex(s => s.seq?.[0] === "moppymp"); step()`);
const mp = run('si');
frame(18); assert.equal(run('busy'), false);
frame(19); assert.equal(node('goal').hidden, false); assert.equal(run('busy'), true);
flush(); assert.equal(run('si'), mp + 1);
// FXは⑪のセットが画面に収まる23コマ目で進む。最後の確認の画面も⑪に枠
run(`start(${indexOf('fx-demo')}); si = stage.steps.findIndex(s => s.seq?.[0] === "fxlist"); step()`);
frame(22); assert.equal(node('goal').hidden, true); assert.equal(run('busy'), false);
frame(23); assert.equal(node('goal').hidden, false); assert.equal(node('goal').dataset.label, '⑪'); assert.equal(run('busy'), true);
flush(); assert.equal(run('stage.steps[si].markLabel'), '⑪');
console.log('PASS scroll steps finish when the goal box is fully visible');

// 上下に並んだ確認の枠では、となりの枠の文字に重なる札は出さない(本人の直し 10/29)
const labels = () => node('marks').innerHTML.split('</div>').filter(Boolean).map(d => (d.match(/data-label="([^"]*)"/) || [])[1] || '');
run(`start(0); si = stage.steps.findIndex(s => s.img === "safari-ip4" && s.type === "info"); step()`);
assert.equal(JSON.stringify(labels()), JSON.stringify(['確認', ''])); // 札は上の枠だけ
run('renderMarks(stage.steps[si], true)');
assert.equal(JSON.stringify(labels()), JSON.stringify(['', '確認'])); // 札を枠の下に出すときは下の枠だけ
run(`start(${indexOf('fx-demo')}); si = stage.steps.findIndex(s => s.img === "fx-list-top" && s.type === "info"); step()`);
assert.equal(JSON.stringify(labels()), JSON.stringify(['確認', '']));
// 離れた枠には、どちらにも札を出す
run(`start(${indexOf('fx-demo')}); si = stage.steps.findIndex(s => s.img === "fx-v1-52"); step()`);
assert.equal(JSON.stringify(labels()), JSON.stringify(['確認', '確認']));
console.log('PASS stacked check boxes keep labels off the neighbor box');

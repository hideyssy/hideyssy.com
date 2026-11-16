'use strict';

const FONT_OPTIONS = [
  ['游ゴシック', '"Yu Gothic", "YuGothic", "Meiryo", sans-serif'],
  ['メイリオ', '"Meiryo", "Yu Gothic", sans-serif'],
  ['BIZ UDPゴシック', '"BIZ UDPGothic", "Yu Gothic", sans-serif'],
  ['游明朝', '"Yu Mincho", "YuMincho", serif'],
  ['BIZ UDP明朝', '"BIZ UDPMincho", "Yu Mincho", serif'],
  ['UDデジタル教科書体', '"UD Digi Kyokasho NK-B", "UD Digi Kyokasho N-B", "Yu Gothic", serif'],
  ['Segoe UI', '"Segoe UI", "Yu Gothic", sans-serif'],
  ['Arial Black', '"Arial Black", "Arial", sans-serif'],
  ['Impact', 'Impact, "Arial Black", sans-serif'],
  ['Georgia', 'Georgia, "Yu Mincho", serif'],
  ['Consolas', 'Consolas, "MS Gothic", monospace'],
  ['Segoe Script', '"Segoe Script", cursive'],
];

const $ = sel => document.querySelector(sel);

class UI {
  constructor(app) {
    this.app = app;
    this.s = app.settings;
    this.panel = $('#panel');
    this.fileCallback = null;
    this.screens = [];
    this.openAdjust = new Set();

    this._buildFontSelect();
    this._bindTabs();
    this._bindInputs();
    this._bindLists();
    this._bindFiles();
    this._bindSettingsTab();
    this._bindPresets();
    this.refreshAll();
  }

  get panelOpen() { return !this.panel.classList.contains('hidden'); }

  togglePanel(force) {
    const open = force ?? !this.panelOpen;
    this.panel.classList.toggle('hidden', !open);
    if (!open && this.panel.contains(document.activeElement)) document.activeElement.blur();
  }

  toggleHelp() { $('#help').classList.toggle('hidden'); }

  toast(msg) {
    if (!this.panelOpen) return;
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  _buildFontSelect() {
    const sel = $('#font-select');
    for (const [label, value] of FONT_OPTIONS) {
      const o = document.createElement('option');
      o.value = value; o.textContent = label; o.style.fontFamily = value;
      sel.appendChild(o);
    }
  }

  _bindTabs() {
    document.querySelectorAll('#tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-body').forEach(b => b.classList.toggle('active', b.dataset.tabBody === btn.dataset.tab));
      });
    });
    $('#panel-close').addEventListener('click', () => this.togglePanel(false));
    $('#help-btn').addEventListener('click', () => this.toggleHelp());
    $('#help').addEventListener('click', () => this.toggleHelp());
  }

  _bindInputs() {
    document.querySelectorAll('[data-bind]').forEach(el => {
      const path = el.dataset.bind;
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'range') v = parseFloat(el.value);
        else if (el.type === 'number') v = clamp(Math.floor(+el.value || 0), +el.min || 0, el.max ? +el.max : Infinity);
        else v = el.value;
        setPath(this.s, path, v);
        this._updateVal(path);
        this.app.onChange(path);
      });
    });
    document.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.toggle;
        setPath(this.s, path, !getPath(this.s, path));
        el.classList.toggle('on', !!getPath(this.s, path));
        this.app.onChange(path);
      });
    });
    $('#style-reset').addEventListener('click', () => {
      this.s.textStyle = { ...DEFAULT_TEXT_STYLE };
      this.refreshAll();
      this.app.onChange('textStyle');
    });
  }

  _updateVal(path) {
    const el = document.querySelector(`[data-val="${path}"]`);
    if (el) {
      const v = getPath(this.s, path);
      el.textContent = typeof v === 'number' ? +v.toFixed(3) : v;
    }
  }

  refreshAll() {
    document.querySelectorAll('[data-bind]').forEach(el => {
      const v = getPath(this.s, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
      this._updateVal(el.dataset.bind);
    });
    document.querySelectorAll('[data-toggle]').forEach(el => {
      el.classList.toggle('on', !!getPath(this.s, el.dataset.toggle));
    });
    this.renderTextList();
    this.renderVisualList();
    this.refreshLogoThumb();
    this.renderPresets();
  }

  // ---------- lists ----------

  _bindLists() {
    $('#text-prev').addEventListener('click', () => this.app.stepText(-1));
    $('#text-next').addEventListener('click', () => this.app.stepText(1));
    $('#visual-prev').addEventListener('click', () => this.app.stepVisual(-1));
    $('#visual-next').addEventListener('click', () => this.app.stepVisual(1));
    const addText = (text, focus) => {
      this.s.texts.push(text);
      this.s.textScales.push(1);
      this.renderTextList();
      this.app.save();
      const inputs = document.querySelectorAll('#text-list textarea');
      if (focus) inputs[inputs.length - 1]?.focus();
    };
    $('#text-add').addEventListener('click', () => addText('', true));
    $('#text-add-clock').addEventListener('click', () => addText('{clock}', false));
    $('#text-add-countdown').addEventListener('click', () => addText('開始まで\n{countdown}', false));
    $('#visual-add').addEventListener('click', () => {
      const last = this.s.visuals[this.s.visuals.length - 1];
      this.s.visuals.push({
        pattern: last ? last.pattern : 'blobs', palette: last ? last.palette : 'neon', image: '',
        speed: 1, intensity: 1, brightness: 1,
        backdrop: last ? last.backdrop : 'black', backdropColor: last ? last.backdropColor : DEFAULT_BACKDROP_COLOR,
      });
      this.renderVisualList();
      this.app.save();
    });
  }

  _miniBtn(label, title, fn) {
    const b = document.createElement('button');
    b.className = 'mini'; b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  /** Lists that travel with another list item by item. */
  _companion(listKey) {
    return listKey === 'texts' ? this.s.textScales : null;
  }

  /** Move/delete an item while keeping the "current" index pointing at the same entry. */
  _move(listKey, indexKey, i, dir) {
    const arr = this.s[listKey];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const comp = this._companion(listKey);
    if (comp) [comp[i], comp[j]] = [comp[j], comp[i]];
    if (this.s[indexKey] === i) this.s[indexKey] = j;
    else if (this.s[indexKey] === j) this.s[indexKey] = i;
  }

  _remove(listKey, indexKey, i, minLen) {
    const arr = this.s[listKey];
    if (arr.length <= minLen) return false;
    arr.splice(i, 1);
    this._companion(listKey)?.splice(i, 1);
    const wasCurrent = this.s[indexKey] === i;
    if (this.s[indexKey] > i) this.s[indexKey]--;
    this.s[indexKey] = Math.min(this.s[indexKey], Math.max(0, arr.length - 1));
    return wasCurrent;
  }

  renderTextList() {
    const ol = $('#text-list');
    ol.innerHTML = '';
    this.s.texts.forEach((text, i) => {
      const li = document.createElement('li');
      const num = this._miniBtn(String(i + 1), 'この文字に切り替え', () => this.app.gotoText(i));
      num.classList.add('num');
      const input = document.createElement('textarea');
      input.rows = 1;
      input.className = 'text-input';
      input.value = text;
      input.placeholder = '（文字なし）';
      input.title = 'Enter で改行、Esc で入力を終了';
      // Sized by line count rather than scrollHeight, which reads 0 while the panel is hidden.
      const fit = () => { input.rows = Math.min(8, input.value.split('\n').length); };
      fit();
      input.addEventListener('input', () => {
        fit();
        this.s.texts[i] = input.value;
        if (i === this.s.textIndex) this.app.showCurrentText(0.3);
        this.app.save();
      });
      const size = document.createElement('input');
      Object.assign(size, { type: 'number', min: 20, max: 500, step: 10, className: 'text-scale' });
      size.value = Math.round((this.s.textScales[i] ?? 1) * 100);
      size.title = 'この文字の大きさ（文字スタイルの大きさに対する ％）';
      size.addEventListener('input', () => {
        const v = parseFloat(size.value);
        if (!Number.isFinite(v)) return;
        this.s.textScales[i] = clamp(v, 20, 500) / 100;
        size.classList.toggle('changed', this.s.textScales[i] !== 1);
        if (i === this.s.textIndex) this.app.text.setScale(this.s.textScales[i]);
        this.app.save();
      });
      size.addEventListener('change', () => { size.value = Math.round(this.s.textScales[i] * 100); });
      size.classList.toggle('changed', this.s.textScales[i] !== 1);
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = '%';
      li.append(num, input, size, pct,
        this._miniBtn('▲', '上へ', () => { this._move('texts', 'textIndex', i, -1); this.renderTextList(); this.app.save(); }),
        this._miniBtn('▼', '下へ', () => { this._move('texts', 'textIndex', i, 1); this.renderTextList(); this.app.save(); }),
        this._miniBtn('✕', '削除', () => {
          if (this.s.texts.length === 1) this.s.texts[0] = '';
          else this._remove('texts', 'textIndex', i, 1);
          this.renderTextList();
          this.app.showCurrentText();
          this.app.save();
        }));
      ol.appendChild(li);
    });
    this.updateCurrentMarks();
  }

  renderVisualList() {
    const ol = $('#visual-list');
    ol.innerHTML = '';
    this.s.visuals.forEach((v, i) => {
      const li = document.createElement('li');
      li.className = 'visual-item';
      const num = this._miniBtn(String(i + 1), 'この映像に切り替え', () => this.app.gotoVisual(i));
      num.classList.add('num');
      const pat = document.createElement('select');
      for (const [key, def] of Object.entries(PATTERNS)) pat.add(new Option(def.name, key));
      pat.value = v.pattern;
      const pal = document.createElement('select');
      for (const [key, def] of Object.entries(PALETTES)) pal.add(new Option(def.name, key));
      pal.value = v.palette;
      const onSel = () => {
        this.s.visuals[i] = { ...this.s.visuals[i], pattern: pat.value, palette: pal.value };
        if (i === this.s.visualIndex) this.app.showCurrentVisual(1);
        this.app.save();
      };
      const setImage = id => {
        this.s.visuals[i].image = id;
        this.renderVisualList();
        if (i === this.s.visualIndex) this.app.showCurrentVisual(1);
        this.app.save();
      };
      const sub = document.createElement('div');
      sub.className = 'sub-row';
      const url = ImageStore.url(v.image);
      if (url) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = url;
        sub.append(img,
          this._miniBtn('画像を変更', '背景画像を選び直す', () => this.pickImage(setImage)),
          this._miniBtn('画像を外す', '背景画像なしにする', () => setImage('')));
      } else {
        const none = document.createElement('span');
        none.className = 'none';
        none.textContent = '背景画像なし';
        sub.append(none, this._miniBtn('背景画像を選ぶ', 'この映像の背景画像を選ぶ', () => this.pickImage(setImage)));
      }
      pat.addEventListener('change', onSel);
      pal.addEventListener('change', onSel);
      li.append(num, pat, pal,
        this._miniBtn('▲', '上へ', () => { this._move('visuals', 'visualIndex', i, -1); this.renderVisualList(); this.app.save(); }),
        this._miniBtn('▼', '下へ', () => { this._move('visuals', 'visualIndex', i, 1); this.renderVisualList(); this.app.save(); }),
        this._miniBtn('✕', '削除', () => {
          const wasCurrent = this._remove('visuals', 'visualIndex', i, 1);
          this.renderVisualList();
          if (wasCurrent) this.app.showCurrentVisual();
          this.app.save();
        }),
        sub,
        this._adjustBox(i));
      ol.appendChild(li);
    });
    this.updateCurrentMarks();
  }

  /** Per-visual sliders. The live layer holds the same entry object, so edits apply instantly. */
  _adjustBox(i) {
    const v = this.s.visuals[i];
    const box = document.createElement('details');
    box.className = 'adjust';
    box.open = this.openAdjust.has(i);
    box.addEventListener('toggle', () => {
      if (box.open) this.openAdjust.add(i); else this.openAdjust.delete(i);
    });
    const summary = document.createElement('summary');
    const describe = () => {
      const parts = [];
      if (v.speed !== 1 || v.intensity !== 1 || v.brightness !== 1) {
        parts.push(`速さ ${v.speed} / 反応 ${v.intensity} / 明るさ ${v.brightness}`);
      }
      if (v.backdrop !== 'black') parts.push(`背景 ${BACKDROPS[v.backdrop]}`);
      summary.textContent = parts.length ? `調整（${parts.join(' / ')}）` : '調整';
    };
    describe();
    box.appendChild(summary);
    for (const [key, label, min, max, step] of [
      ['speed', '動きの速さ', 0.1, 3, 0.05],
      ['intensity', '反応の強さ', 0, 3, 0.05],
      ['brightness', '明るさ', 0.1, 1.5, 0.05],
    ]) {
      const row = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = label;
      const range = document.createElement('input');
      Object.assign(range, { type: 'range', min, max, step, value: v[key] });
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = v[key];
      range.addEventListener('input', () => {
        v[key] = parseFloat(range.value);
        val.textContent = v[key];
        describe();
        this.app.save();
      });
      row.append(name, range, val);
      box.appendChild(row);
    }
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = '背景色';
    const sel = document.createElement('select');
    for (const [key, label] of Object.entries(BACKDROPS)) sel.add(new Option(label, key));
    sel.value = v.backdrop;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = v.backdropColor;
    color.hidden = v.backdrop !== 'color';
    const applyBackdrop = () => {
      v.backdrop = sel.value;
      v.backdropColor = color.value;
      color.hidden = v.backdrop !== 'color';
      describe();
      this.app.visualizer.restyle();
      this.app.save();
    };
    sel.addEventListener('change', applyBackdrop);
    color.addEventListener('input', applyBackdrop);
    row.append(name, sel, color);
    box.appendChild(row);

    box.appendChild(this._miniBtn('調整を元に戻す', '速さ・反応・明るさを 1、背景色を黒に戻す', () => {
      v.speed = v.intensity = v.brightness = 1;
      v.backdrop = 'black';
      this.app.visualizer.restyle();
      this.renderVisualList();
      this.app.save();
    }));
    return box;
  }

  // ---------- presets ----------

  _bindPresets() {
    const save = () => {
      const input = $('#preset-name');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (PresetStore.list().some(p => p.name === name) && !confirm(`「${name}」を今の設定で上書きしますか？`)) return;
      this._savePreset(name);
      input.value = '';
    };
    $('#preset-save').addEventListener('click', save);
    $('#preset-name').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  }

  _savePreset(name) {
    try {
      PresetStore.save(name, this.s);
      this.renderPresets();
      this.toast(`プリセット「${name}」を保存しました`);
    } catch (e) {
      alert('プリセットを保存できませんでした: ' + e.message);
    }
  }

  renderPresets() {
    const ol = $('#preset-list');
    ol.innerHTML = '';
    const list = PresetStore.list();
    $('#preset-empty').classList.toggle('hidden', list.length > 0);
    for (const p of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'preset-name';
      name.textContent = p.name;
      const date = document.createElement('span');
      date.className = 'preset-date';
      date.textContent = '保存日時: ' + new Date(p.savedAt).toLocaleString('ja-JP');
      li.append(name,
        this._miniBtn('読み込み', 'このプリセットに切り替える', async () => {
          if (!confirm(`「${p.name}」を読み込みますか？今の設定は置き換えられます。`)) return;
          await this.app.replaceSettings(PresetStore.toSettings(p, this.s));
          this.toast(`プリセット「${p.name}」を読み込みました`);
        }),
        this._miniBtn('上書き', '今の設定でこのプリセットを上書きする', () => {
          if (confirm(`「${p.name}」を今の設定で上書きしますか？`)) this._savePreset(p.name);
        }),
        this._miniBtn('✕', '削除', () => {
          if (!confirm(`「${p.name}」を削除しますか？`)) return;
          PresetStore.remove(p.name);
          this.renderPresets();
        }),
        date);
      ol.appendChild(li);
    }
  }

  setMicStatus(text) {
    $('#mic-status').textContent = text;
  }

  updateCurrentMarks() {
    document.querySelectorAll('#text-list li').forEach((li, i) => li.classList.toggle('current', i === this.s.textIndex));
    document.querySelectorAll('#visual-list li').forEach((li, i) => li.classList.toggle('current', i === this.s.visualIndex));
    $('#text-pos').textContent = `${this.s.textIndex + 1} / ${this.s.texts.length}`;
    $('#visual-pos').textContent = `${this.s.visualIndex + 1} / ${this.s.visuals.length}`;
  }

  // ---------- files ----------

  _pickFile(accept, onFile) {
    const input = $('#file-input');
    this.fileCallback = onFile;
    input.accept = accept;
    input.value = '';
    input.click();
  }

  pickImage(onId) {
    this._pickFile('image/*', async file => {
      if (!file.type.startsWith('image/')) { alert('画像ファイルを選んでください。'); return; }
      onId(await ImageStore.add(file));
    });
  }

  _importTexts(text, replace) {
    // One item per line; a written "\n" inside a line becomes a line break within the item.
    const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim() !== '').map(l => l.replace(/\\n/g, '\n'));
    if (!lines.length) { alert('文字が見つかりませんでした。'); return; }
    if (replace) {
      this.s.texts = lines;
      this.s.textScales = lines.map(() => 1);
      this.s.textIndex = 0;
    } else {
      if (this.s.texts.length === 1 && this.s.texts[0] === '') { this.s.texts = []; this.s.textScales = []; }
      this.s.texts.push(...lines);
      this.s.textScales.push(...lines.map(() => 1));
    }
    this.renderTextList();
    this.app.showCurrentText();
    this.app.save();
    this.toast(`${lines.length} 件の文字を読み込みました`);
  }

  async _importSettings(text) {
    const data = JSON.parse(text);
    if (data.images && typeof data.images === 'object') {
      for (const [id, dataUrl] of Object.entries(data.images)) {
        await ImageStore.put(id, await (await fetch(dataUrl)).blob());
      }
    }
    if (Array.isArray(data.presets)) PresetStore.merge(data.presets);
    await this.app.replaceSettings(Store.fromJSON(text));
    this.toast('設定を読み込みました');
  }

  async _exportSettings() {
    const images = {};
    for (const id of allUsedImageIds(this.s)) {
      const blob = await ImageStore.getBlob(id);
      if (blob) images[id] = await blobToDataURL(blob);
    }
    const presets = PresetStore.list();
    download('visualizer-settings.json', JSON.stringify({ ...this.s, presets, images }, null, 2), 'application/json');
  }

  _bindFiles() {
    const readText = async file => (await file.text()).replace(/^\uFEFF/, '');
    $('#file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file || !this.fileCallback) return;
      try {
        await this.fileCallback(file);
      } catch (err) {
        alert('読み込みに失敗しました: ' + err.message);
      }
    });

    $('#text-import-replace').addEventListener('click', () =>
      this._pickFile('.txt,text/plain', async f => this._importTexts(await readText(f), true)));
    $('#text-import-append').addEventListener('click', () =>
      this._pickFile('.txt,text/plain', async f => this._importTexts(await readText(f), false)));
    $('#settings-import').addEventListener('click', () =>
      this._pickFile('.json,application/json', async f => this._importSettings(await readText(f))));

    $('#text-export').addEventListener('click', () => {
      download('texts.txt', this.s.texts.map(t => t.replace(/\r?\n/g, '\\n')).join('\r\n'), 'text/plain');
    });
    $('#settings-export').addEventListener('click', () => {
      this._exportSettings().catch(err => alert('書き出しに失敗しました: ' + err.message));
    });

    $('#logo-pick').addEventListener('click', () => this.pickImage(id => {
      this.s.logo.image = id;
      this.s.logo.enabled = true;
      this.refreshAll();
      this.app.onChange('logo');
    }));
    $('#logo-clear').addEventListener('click', () => {
      this.s.logo.image = '';
      this.refreshAll();
      this.app.onChange('logo');
    });
  }

  refreshLogoThumb() {
    const url = ImageStore.url(this.s.logo.image);
    $('#logo-thumb').classList.toggle('hidden', !url);
    $('#logo-none').classList.toggle('hidden', !!url);
    if (url) $('#logo-thumb').src = url;
  }

  // ---------- settings tab ----------

  _bindSettingsTab() {
    $('#device-select').addEventListener('change', e => {
      this.s.audio.deviceId = e.target.value;
      this.app.save();
      this.app.startMic();
    });
    $('#mic-restart').addEventListener('click', () => this.app.startMic());
    $('#countdown-restart').addEventListener('click', () => {
      this.app.restartCountdown();
      this.toast('カウントダウンを最初からにしました');
    });
    $('#fullscreen-btn').addEventListener('click', () => {
      const idx = $('#screen-select').value;
      this.app.enterFullscreen(idx === '' ? null : this.screens[+idx]);
    });

    const sel = $('#screen-select');
    if ('getScreenDetails' in window) {
      const btn = document.createElement('button');
      btn.textContent = 'ディスプレイを検出';
      btn.addEventListener('click', () => this.detectScreens());
      sel.after(btn);
    }
  }

  async detectScreens() {
    const sel = $('#screen-select');
    try {
      const details = await window.getScreenDetails();
      this.screens = details.screens;
      sel.innerHTML = '';
      sel.add(new Option('このディスプレイ', ''));
      let external = -1;
      this.screens.forEach((sc, i) => {
        const kind = sc.isInternal ? 'ノートPC' : '外部';
        sel.add(new Option(`${sc.label || 'ディスプレイ ' + (i + 1)}（${kind} ${sc.width}×${sc.height}）`, String(i)));
        if (!sc.isInternal && external < 0) external = i;
      });
      if (external >= 0) sel.value = String(external);
      this.toast(`${this.screens.length} 台のディスプレイを検出しました`);
    } catch (e) {
      alert('ディスプレイを検出できませんでした。ウィンドウを外部ディスプレイへドラッグしてから F キーで全画面にしてください。');
    }
  }

  async refreshDevices() {
    const sel = $('#device-select');
    const devices = await this.app.audio.listDevices();
    sel.innerHTML = '';
    sel.add(new Option('既定のマイク', ''));
    devices.forEach((d, i) => sel.add(new Option(d.label || `マイク ${i + 1}`, d.deviceId)));
    sel.value = devices.some(d => d.deviceId === this.s.audio.deviceId) ? this.s.audio.deviceId : '';
  }

  setMeter(level) {
    $('#meter-bar').style.width = Math.round(level * 100) + '%';
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

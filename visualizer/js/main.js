'use strict';

const App = {
  settings: Store.load(),
  audio: new AudioEngine(),
  visualizer: null,
  text: null,
  ui: null,
  sinceVisualChange: 0,
  sinceTextChange: 0,
  wakeLock: null,
  wantMic: false,
  reconnectTimer: 0,
  countdownStart: 0,

  async init() {
    await ImageStore.init();
    ImageStore.gc(allUsedImageIds(this.settings));
    this.visualizer = new Visualizer(document.getElementById('visual-layers'));
    this.text = new TextOverlay(document.getElementById('text-wrap'));
    this.text.formatter = s => this.formatTokens(s);
    this.ui = new UI(this);
    this.applyAll();
    this._bindKeys();
    this._bindStart();
    this._bindCursorHide();
    this.audio.onLost = () => this.scheduleReconnect(1000);
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      this.ui.refreshDevices();
      if (this.wantMic && !this.audio.running) this.scheduleReconnect(500);
    });

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt, now / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  applyAll() {
    const s = this.settings;
    this.audio.sensitivity = s.audio.sensitivity;
    this.audio.autoGain = s.audio.autoGain;
    this.visualizer.setScale(parseFloat(s.renderScale) || 1);
    this.visualizer.setBackground(s.background);
    this.visualizer.setEffect(s.transition.visual);
    this.text.effect = s.transition.text;
    this.text.applyStyle(s.textStyle);
    this.text.setVisible(s.showText);
    this.applyLogo();
    this.applyFinish();
    this.showCurrentText(0);
    this.showCurrentVisual(0);
  },

  async replaceSettings(next) {
    Object.keys(this.settings).forEach(k => delete this.settings[k]);
    Object.assign(this.settings, next);
    this.ui.refreshAll();
    this.applyAll();
    this.save();
    await ImageStore.gc(allUsedImageIds(this.settings));
  },

  /** Replace {clock} / {date} / {countdown} with live values. */
  formatTokens(str) {
    if (!str.includes('{')) return str;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (str.includes('{countdown}')) {
      const remain = this.countdownDuration() - (performance.now() - this.countdownStart);
      if (remain <= 0) return this.settings.countdown.endText;
      const sec = Math.ceil(remain / 1000);
      const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
      str = str.replace(/\{countdown\}/g, h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`);
    }
    if (str.includes('{clock}')) {
      const c = `${pad(now.getHours())}:${pad(now.getMinutes())}` + (this.settings.clock.seconds ? `:${pad(now.getSeconds())}` : '');
      str = str.replace(/\{clock\}/g, c);
    }
    if (str.includes('{date}')) {
      const wd = '日月火水木金土'[now.getDay()];
      str = str.replace(/\{date\}/g, `${now.getMonth() + 1}月${now.getDate()}日（${wd}）`);
    }
    return str;
  },

  countdownDuration() {
    const c = this.settings.countdown;
    return ((+c.hours || 0) * 3600 + (+c.minutes || 0) * 60 + (+c.seconds || 0)) * 1000;
  },

  restartCountdown() {
    this.countdownStart = performance.now();
  },

  applyFinish() {
    const grain = document.getElementById('grain');
    if (!grain.style.backgroundImage) {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      grain.style.backgroundImage = `url(${c.toDataURL()})`;
    }
    document.getElementById('finish').classList.toggle('off', !this.settings.finish);
  },

  applyLogo() {
    const l = this.settings.logo;
    const el = document.getElementById('logo');
    const url = ImageStore.url(l.image);
    el.classList.toggle('off', !(l.enabled && url));
    if (!url) return;
    if (el.getAttribute('src') !== url) el.src = url;
    const m = l.margin + 'vh';
    const [v, h] = l.position === 'center' ? ['center', 'center'] : l.position.split('-');
    el.style.height = l.size + 'vh';
    el.style.opacity = l.opacity;
    el.style.top = v === 'top' ? m : v === 'center' ? '50%' : '';
    el.style.bottom = v === 'bottom' ? m : '';
    el.style.left = h === 'left' ? m : h === 'center' ? '50%' : '';
    el.style.right = h === 'right' ? m : '';
    el.style.transform = `translate(${h === 'center' ? '-50%' : '0'}, ${v === 'center' ? '-50%' : '0'})`;
  },

  frame(dt, t) {
    const s = this.settings;
    this.audio.update(dt);
    this.visualizer.frame(this.audio, dt, t);
    this.text.update(this.audio, dt, this.visualizer.palette, s.reactions, t);
    if (this.ui.panelOpen) this.ui.setMeter(this.audio.level);

    this.sinceVisualChange += dt;
    if (s.autoVisual.enabled && s.visuals.length > 1 && this.sinceVisualChange >= s.autoVisual.minutes * 60) {
      this.stepVisual(1);
    }
    this.sinceTextChange += dt;
    if (s.autoText.enabled && s.texts.length > 1 && this.sinceTextChange >= s.autoText.seconds) {
      this.stepText(1);
    }
  },

  save() { Store.save(this.settings); },

  onChange(path) {
    const s = this.settings;
    if (path.startsWith('textStyle')) this.text.applyStyle(s.textStyle);
    else if (path === 'showText') this.text.setVisible(s.showText);
    else if (path === 'audio.sensitivity') this.audio.sensitivity = s.audio.sensitivity;
    else if (path === 'audio.autoGain') this.audio.autoGain = s.audio.autoGain;
    else if (path === 'renderScale') this.visualizer.setScale(parseFloat(s.renderScale) || 1);
    else if (path.startsWith('background')) this.visualizer.setBackground(s.background);
    else if (path.startsWith('logo')) this.applyLogo();
    else if (path === 'finish') this.applyFinish();
    else if (path.startsWith('autoVisual')) this.sinceVisualChange = 0;
    else if (path.startsWith('autoText')) this.sinceTextChange = 0;
    else if (path === 'transition.visual') this.visualizer.setEffect(s.transition.visual);
    else if (path === 'transition.text') this.text.effect = s.transition.text;
    else if (path.startsWith('countdown.') && path !== 'countdown.endText') this.restartCountdown();
    this.save();
  },

  // ---------- text / visual navigation ----------

  showCurrentText(fade = this.settings.fade.text) {
    const s = this.settings;
    const text = s.texts[s.textIndex] ?? '';
    if (text.includes('{countdown}')) this.restartCountdown();
    this.text.show(text, fade, s.textScales[s.textIndex] ?? 1);
    this.sinceTextChange = 0;
    this.ui.updateCurrentMarks();
  },

  gotoText(i) {
    const s = this.settings;
    if (!s.texts.length) return;
    s.textIndex = (i + s.texts.length) % s.texts.length;
    this.showCurrentText();
    this.ui.toast(`文字 ${s.textIndex + 1}/${s.texts.length}`);
    this.save();
  },

  stepText(dir) { this.gotoText(this.settings.textIndex + dir); },

  showCurrentVisual(fade = this.settings.fade.visual) {
    const s = this.settings;
    this.visualizer.show(s.visuals[s.visualIndex], fade);
    this.sinceVisualChange = 0;
    this.ui.updateCurrentMarks();
  },

  gotoVisual(i) {
    const s = this.settings;
    s.visualIndex = (i + s.visuals.length) % s.visuals.length;
    this.showCurrentVisual();
    const v = s.visuals[s.visualIndex];
    this.ui.toast(`映像 ${s.visualIndex + 1}/${s.visuals.length}: ${PATTERNS[v.pattern].name}（${PALETTES[v.palette].name}）`);
    this.save();
  },

  stepVisual(dir) { this.gotoVisual(this.settings.visualIndex + dir); },

  advance() {
    const target = this.settings.spaceTarget;
    if (target !== 'visual') this.stepText(1);
    if (target !== 'text') this.stepVisual(1);
  },

  // ---------- mic / display ----------

  async startMic() {
    const err = document.getElementById('start-error');
    clearTimeout(this.reconnectTimer);
    try {
      await this.audio.start(this.settings.audio.deviceId);
      err.textContent = '';
      this.wantMic = true;
      this.ui.setMicStatus('接続中');
      await this.ui.refreshDevices();
      this.ui.toast('マイクを開始しました');
      return true;
    } catch (e) {
      console.error(e);
      if (this.settings.audio.deviceId) {
        this.settings.audio.deviceId = '';
        this.save();
        return this.startMic();
      }
      const msg = e.name === 'NotAllowedError'
        ? 'マイクの使用が許可されませんでした。アドレスバーの鍵アイコンからマイクを許可してください。'
        : 'マイクを開始できませんでした: ' + e.message;
      err.textContent = msg;
      this.ui.setMicStatus('未接続');
      this.ui.toast(msg);
      return false;
    }
  },

  /** 'granted' | 'prompt' | 'denied' | 'unknown' (Permissions API unavailable). */
  async micPermission() {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      if (!this.permissionWatched) {
        this.permissionWatched = true;
        status.addEventListener('change', () => {
          if (status.state === 'granted' && this.wantMic && !this.audio.running) this.scheduleReconnect(300);
        });
      }
      return status.state;
    } catch (_) {
      return 'unknown';
    }
  },

  /**
   * Retry quietly until the mic comes back; falls back to the default mic if the chosen one is gone.
   * Only retries while permission is still granted: asking again would show a browser dialog,
   * and any dialog ends fullscreen.
   */
  scheduleReconnect(delay) {
    if (!this.wantMic) return;
    clearTimeout(this.reconnectTimer);
    this.ui.setMicStatus('再接続中…');
    this.reconnectTimer = setTimeout(async () => {
      if (this.audio.running) return;
      const permission = await this.micPermission();
      if (permission === 'prompt' || permission === 'denied') {
        this.ui.setMicStatus('マイクの許可が切れています（「マイクを再接続」を押してください）');
        return;
      }
      try {
        await this.audio.start(this.settings.audio.deviceId);
      } catch (_) {
        try {
          await this.audio.start('');
        } catch (_) {
          this.scheduleReconnect(3000);
          return;
        }
      }
      this.ui.setMicStatus('接続中');
      this.ui.toast('マイクを再接続しました');
      this.ui.refreshDevices();
    }, delay);
  },

  async enterFullscreen(screen) {
    try {
      const opts = screen ? { screen, navigationUI: 'hide' } : { navigationUI: 'hide' };
      await document.documentElement.requestFullscreen(opts);
    } catch (e) {
      alert('全画面にできませんでした: ' + e.message);
    }
  },

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.enterFullscreen(null);
  },

  async requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) { /* not available (e.g. battery saver) */ }
  },

  // ---------- input ----------

  _bindStart() {
    const overlay = document.getElementById('start-overlay');
    const begin = async withMic => {
      if (withMic && !(await this.startMic())) return;
      overlay.classList.add('hidden');
      this.requestWakeLock();
    };
    document.getElementById('start-btn').addEventListener('click', () => begin(true));
    document.getElementById('start-silent-btn').addEventListener('click', () => begin(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && overlay.classList.contains('hidden')) this.requestWakeLock();
    });
  },

  _bindKeys() {
    const isTyping = el => el && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
      (el.tagName === 'INPUT' && ['text', 'number', 'search', 'time'].includes(el.type)));

    window.addEventListener('keydown', e => {
      if (isTyping(e.target)) {
        if (e.isComposing) return;
        // Enter starts a new line in multi-line fields; Esc always leaves the field.
        if (e.key === 'Escape' || (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA')) e.target.blur();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const handled = () => e.preventDefault();
      switch (e.code) {
        case 'Space': handled(); if (!e.repeat) this.advance(); break;
        case 'ArrowRight': handled(); this.stepText(1); break;
        case 'ArrowLeft': handled(); this.stepText(-1); break;
        case 'ArrowDown': handled(); this.stepVisual(1); break;
        case 'ArrowUp': handled(); this.stepVisual(-1); break;
        case 'KeyF': handled(); this.toggleFullscreen(); break;
        case 'KeyS': handled(); this.ui.togglePanel(); break;
        case 'KeyH': handled(); this.ui.toggleHelp(); break;
        case 'KeyT':
          handled();
          this.settings.showText = !this.settings.showText;
          this.text.setVisible(this.settings.showText);
          this.ui.refreshAll();
          this.save();
          break;
        case 'KeyL':
          handled();
          this.settings.logo.enabled = !this.settings.logo.enabled;
          this.applyLogo();
          this.ui.refreshAll();
          this.save();
          if (!ImageStore.url(this.settings.logo.image)) this.ui.toast('ロゴ画像が未設定です（設定パネルの「ロゴ」タブで選べます）');
          break;
      }
    });
    // Stop a focused button/checkbox from also reacting to the space key.
    window.addEventListener('keyup', e => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
    });
  },

  _bindCursorHide() {
    let timer = 0;
    const show = () => {
      document.body.classList.remove('hide-cursor');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.ui.panelOpen) document.body.classList.add('hide-cursor');
      }, 2500);
    };
    window.addEventListener('mousemove', show);
    show();
  },
};

App.init();

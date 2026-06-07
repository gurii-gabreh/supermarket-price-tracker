// ===========================
// config.js - 設定管理
// ===========================

const Config = {
  // ▼ GAS URLをここに直接設定してください（Code.gsをデプロイしたURL）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxo6J3r4ZXRweNHko6zJpuqO0m1E3LPd4IS_P9FqSydO5OQoKeiWRxsbFeyxugnWkTU/exec',

  STORAGE_KEY: 'chirashi_tracker_config',

  defaults: {
    sheetUrl: '',
  },

  load() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      return saved ? { ...this.defaults, ...JSON.parse(saved) } : { ...this.defaults };
    } catch {
      return { ...this.defaults };
    }
  },

  save(data) {
    const merged = { ...this.load(), ...data };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(merged));
    return merged;
  },

  get(key) {
    // GAS URLは直接埋め込みを優先
    if (key === 'gasUrl') return this.GAS_URL;
    return this.load()[key];
  },
};

// ── デモモード管理 ──
const DemoMode = {
  _active: false,

  isActive() { return this._active; },

  toggle() {
    this._active = !this._active;
    this._apply();
    return this._active;
  },

  enable()  { this._active = true;  this._apply(); },
  disable() { this._active = false; this._apply(); },

  _apply() {
    const btn    = document.getElementById('btnDemoMode');
    const banner = document.getElementById('demoBanner');
    if (this._active) {
      btn?.classList.add('active');
      if (banner) banner.style.display = 'block';
      document.body.classList.add('demo-active');
    } else {
      btn?.classList.remove('active');
      if (banner) banner.style.display = 'none';
      document.body.classList.remove('demo-active');
    }
  },
};

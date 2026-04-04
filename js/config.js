// ===========================
// config.js - 設定管理
// ===========================

const Config = {
  STORAGE_KEY: 'chirashi_tracker_config',

  defaults: {
    gasUrl: '',
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
    return this.load()[key];
  },
};

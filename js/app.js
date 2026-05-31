// ===========================
// app.js - メインロジック
// ===========================

const App = {
  currentStores:    [],
  collectedData:    [],
  collectedAt:      null,
  noChirashiStores: [],

  init() {
    UI.initSetupPanel();
    this._bindEvents();
    this._bindDemoMode();
    const sheetUrl = Config.get('sheetUrl');
    document.getElementById('btnOpenSheet').style.display = sheetUrl ? 'flex' : 'none';
    // 設定画面初期化
    Settings.init();
  },

  // ── デモモードのボタン制御 ──
  _bindDemoMode() {
    const btn     = document.getElementById('btnDemoMode');
    const exitBtn = document.getElementById('btnExitDemo');
    if (btn) {
      btn.addEventListener('click', () => {
        const isOn = DemoMode.toggle();
        if (isOn) {
          UI.toast('🎬 デモモードON — サンプルデータで動作します', 'info', 5000);
          // デモ用スーパーをすぐ表示
          this._showDemoStores();
        } else {
          UI.toast('デモモードを終了しました', 'info');
          // 画面リセット
          document.getElementById('storesSection').style.display  = 'none';
          document.getElementById('resultsSection').style.display = 'none';
          document.getElementById('emptyState').style.display     = 'block';
        }
      });
    }
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        DemoMode.disable();
        UI.toast('デモモードを終了しました', 'info');
        document.getElementById('storesSection').style.display  = 'none';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('emptyState').style.display     = 'block';
      });
    }
  },

  // ── デモ用スーパーを画面に表示 ──
  _showDemoStores() {
    const stores = this._demoStores('栃木県足利市小俣町');
    this.currentStores = stores;
    UI.renderStores(stores, true);
    setTimeout(() => {
      document.getElementById('storesSection')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  },

  _bindEvents() {
    document.getElementById('btnSearchStores').addEventListener('click',  () => this.searchStores());
    document.getElementById('addressInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.searchStores();
    });
    document.getElementById('addressInput').addEventListener('focus', () => {
      document.getElementById('searchField').style.borderColor = 'var(--lime)';
    });
    document.getElementById('addressInput').addEventListener('blur', () => {
      document.getElementById('searchField').style.borderColor = '';
    });
    document.getElementById('btnSelectAll').addEventListener('click',   () => UI.selectAllStores());
    document.getElementById('btnCollectPrices').addEventListener('click', () => this.collectPrices());
    document.getElementById('btnReCollect').addEventListener('click',    () => this.collectPrices());
    document.getElementById('btnExportSheet').addEventListener('click',  () => this.exportToSheet());
    document.getElementById('btnOpenSheet').addEventListener('click', () => {
      const url = Config.get('sheetUrl');
      if (url) window.open(url, '_blank');
      else UI.toast('設定でスプレッドシートURLを入力してください', 'info');
    });
  },

  // ── スーパー検索 ──
  async searchStores() {
    const address = document.getElementById('addressInput').value.trim();
    if (!address) {
      UI.toast('住所を入力してください', 'error');
      const field = document.getElementById('searchField');
      field.style.animation = 'none'; field.offsetHeight;
      field.style.animation = 'shake 0.4s ease';
      return;
    }

    const btn = document.getElementById('btnSearchStores');
    btn.disabled = true;
    btn.innerHTML = '<span style="opacity:.6">検索中...</span>';

    try {
      let stores;

      // ── デモモード ──
      if (DemoMode.isActive()) {
        await new Promise(r => setTimeout(r, 800));
        stores = this._demoStores(address);
        UI.renderStores(stores, true);
        UI.toast(`🎬 [デモ] ${stores.length}件のスーパーが見つかりました`, 'info');
      } else {
        const gasUrl = Config.get('gasUrl');
        if (gasUrl) {
          const params = new URLSearchParams({ action: 'findStores', address });
          const res    = await fetch(`${gasUrl}?${params}`);
          if (!res.ok) throw new Error(`通信エラー: ${res.status}`);
          const data   = await res.json();
          if (data.error) throw new Error(data.error);
          if (data.geminiError && data.errorInfo) {
            UI.showGeminiError(data.errorInfo);
            return;
          }
          stores = data.stores || [];
          UI.renderStores(stores, false);
          UI.toast(`${stores.length}件のスーパーが見つかりました`, 'success');
        } else {
          await new Promise(r => setTimeout(r, 600));
          stores = this._demoStores(address);
          UI.renderStores(stores, true);
          UI.toast('GAS URLを設定すると実際のお店が検索できます', 'info', 6000);
        }
      }

      this.currentStores = stores;
      if (stores.length > 0) {
        setTimeout(() => {
          document.getElementById('storesSection')
            .scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }

    } catch (e) {
      UI.toast(`検索エラー: ${e.message}`, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'スーパーを探す <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  },

  // ── チラシ収集 ──
  async collectPrices(storesOverride = null) {
    const gasUrl = Config.get('gasUrl');

    // 対象スーパーを決定
    let selected;
    if (storesOverride) {
      selected = storesOverride;
    } else {
      const selectedIds = [...UI.selectedStores];
      if (selectedIds.length === 0) {
        UI.toast('収集するスーパーを選択してください', 'error');
        return;
      }
      selected = this.currentStores.filter(s => selectedIds.includes(s.id));
    }

    const btn = document.getElementById('btnCollectPrices');
    if (btn) btn.disabled = true;
    UI.showCollecting(selected.length);
    this.collectedAt = new Date().toISOString();
    const results    = [];
    const noChirashi = [];

    for (let i = 0; i < selected.length; i++) {
      const store = selected[i];
      UI.updateCollectingProgress(store.name, i, selected.length);
      try {
        const result = DemoMode.isActive()
          ? { items: await this._demoFetch(store), searchLog: null }
          : gasUrl
            ? await Scraper.fetchStorePricesWithLog(store)
            : { items: await this._demoFetch(store), searchLog: null };

        if (result.items && result.items.geminiError) {
          UI.hideCollecting();
          UI.showGeminiError(result.items.errorInfo);
          if (btn) btn.disabled = false;
          return;
        }

        // デモモードまたはGAS未設定の場合はチラシなし判定しない
        const isReal = !DemoMode.isActive() && gasUrl;
        if (isReal && (!result.items || result.items.length === 0)) {
          noChirashi.push({ ...store, searchLog: result.searchLog });
          results.push({ store, items: [], noChirashi: true });
        } else {
          results.push({ store, items: result.items || [] });
        }
      } catch (e) {
        console.error(store.name, e);
        UI.toast(`${store.name}: 収集失敗`, 'error');
        noChirashi.push(store);
        results.push({ store, items: [], noChirashi: true });
      }
    }

    UI.updateCollectingProgress('完了', selected.length, selected.length);
    await new Promise(r => setTimeout(r, 400));
    UI.hideCollecting();

    const merged = Scraper.mergeAllPrices(results.filter(r => !r.noChirashi));
    this.collectedData    = merged;
    this.collectedStores  = selected;
    this.noChirashiStores = noChirashi;

    UI.renderResults(merged, selected, this.collectedAt, noChirashi);
    if (btn) btn.disabled = false;

    // スプレッドシートに自動保存
    if (gasUrl && merged.length > 0) {
      try {
        await Scraper.saveToSheet(merged, selected, this.collectedAt);
        // 最終収集時間を設定に保存
        Settings.saveLastCollected(this.collectedAt);
      } catch (e) {
        console.warn('自動保存失敗:', e);
      }
    }

    const withChirashi = selected.length - noChirashi.length;
    const demoTag = DemoMode.isActive() ? '🎬 [デモ] ' : '';
    UI.toast(
      `${demoTag}${withChirashi}店のチラシから${merged.length}品目を収集${noChirashi.length > 0 ? `（${noChirashi.length}店はチラシなし）` : ''}`,
      'success', 6000
    );
    setTimeout(() => {
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  },

  async _demoFetch(store) {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 700));
    return Scraper.generateDemoData(store);
  },

  // ── スプレッドシート保存 ──
  async exportToSheet() {
    if (!Config.get('gasUrl')) {
      UI.toast('設定でGAS URLを入力してください', 'error');
      return;
    }
    if (!this.collectedData?.length) {
      UI.toast('先にチラシ収集を実行してください', 'error');
      return;
    }
    const btn = document.getElementById('btnExportSheet');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await Scraper.saveToSheet(this.collectedData, this.collectedStores, this.collectedAt);
      UI.showSaveStatus(true, '✓ Googleスプレッドシートに保存しました');
      UI.toast('スプレッドシートに保存しました', 'success');
    } catch (e) {
      UI.showSaveStatus(false, `✕ 保存に失敗しました: ${e.message}`);
      UI.toast('保存に失敗しました', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> シートに保存';
    }
  },

  _demoStores(address) {
    const list  = ['ベルク','カスミ','マルエツ','ヤオコー','コープみらい','イオン','ライフ','オーケー','ロピア','サミット'];
    const count = 5 + Math.floor(Math.random() * 4);
    return Array.from({ length: count }, (_, i) => ({
      id:       `demo_${i}`,
      name:     list[i % list.length] + ['店','フードセンター','マーケット'][i % 3],
      address:  `${address} ${i+1}丁目付近`,
      distance: parseFloat((0.2 + i * 0.45).toFixed(1)),
      rating:   parseFloat((3.0 + Math.random() * 1.8).toFixed(1)),
      openNow:  i % 4 !== 3,
      website:  null,
    }));
  },
};

// ===========================
// Settings - 設定管理
// ===========================
const Settings = {
  STORAGE_KEY: 'kakaku_settings',

  // 設定をlocalStorageから読み込む
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
    } catch { return {}; }
  },

  save(data) {
    const current = this.load();
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ ...current, ...data }));
  },

  // 登録スーパーを取得
  getStores() {
    return this.load().registeredStores || [];
  },

  // 登録スーパーを保存
  saveStores(stores) {
    this.save({ registeredStores: stores });
    this.renderRegisteredStores();
  },

  // スーパーを追加
  addStore(store) {
    const stores = this.getStores();
    if (stores.some(s => s.name === store.name)) {
      UI.toast('すでに登録されています', 'info');
      return false;
    }
    stores.push(store);
    this.saveStores(stores);

    // GASにも保存
    const gasUrl = Config.get('gasUrl');
    if (gasUrl) this._saveStoresToGas(stores);
    return true;
  },

  // スーパーを削除
  removeStore(name) {
    const stores = this.getStores().filter(s => s.name !== name);
    this.saveStores(stores);
    const gasUrl = Config.get('gasUrl');
    if (gasUrl) this._saveStoresToGas(stores);
  },

  // GASにスーパー一覧を保存
  async _saveStoresToGas(stores) {
    const gasUrl = Config.get('gasUrl');
    if (!gasUrl) return;
    try {
      await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveStores', stores }),
      });
    } catch (e) { console.warn('GAS保存失敗:', e); }
  },

  // 自動収集ON/OFFを取得
  getAutoCollect() {
    return this.load().autoCollect === true;
  },

  // 自動収集ON/OFFを保存
  saveAutoCollect(val) {
    this.save({ autoCollect: val });
    const gasUrl = Config.get('gasUrl');
    if (gasUrl) this._saveSettingToGas('autoCollect', val ? 'ON' : 'OFF');
  },

  // GASに設定を保存
  async _saveSettingToGas(key, value) {
    const gasUrl = Config.get('gasUrl');
    if (!gasUrl) return;
    try {
      await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveSetting', key, value }),
      });
    } catch (e) { console.warn('GAS設定保存失敗:', e); }
  },

  // 最終収集時間を保存
  saveLastCollected(isoStr) {
    this.save({ lastCollectedAt: isoStr });
    this._updateLastCollectedDisplay(isoStr);
    this._saveSettingToGas('lastCollectedAt', isoStr);
  },

  _updateLastCollectedDisplay(isoStr) {
    const el = document.getElementById('lastCollectedAt');
    if (!el) return;
    if (!isoStr) { el.textContent = '最終収集: 未収集'; return; }
    const d = new Date(isoStr);
    el.textContent = '最終収集: ' + d.toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  },

  // スケジュール時間リストを取得
  getScheduleTimes() {
    return this.load().scheduleTimes || [{ hour: 10, minute: 0 }];
  },

  // スケジュール時間リストを保存
  saveScheduleTimes(times) {
    this.save({ scheduleTimes: times });
  },

  // 設定画面を初期化
  init() {
    this._initToggle();
    this._initSchedule();
    this._initStoreSearchRows();
    this._initAddRowBtn();
    this._initCollectNowBtn();
    this._initSaveBtn();
    this.renderRegisteredStores();
    const cfg = this.load();
    this._updateLastCollectedDisplay(cfg.lastCollectedAt || null);
  },

  // トグルボタン初期化
  _initToggle() {
    const btn = document.getElementById('btnAutoCollect');
    if (!btn) return;
    const isOn = this.getAutoCollect();
    btn.dataset.on = isOn;
    btn.addEventListener('click', () => {
      const newVal = btn.dataset.on !== 'true';
      btn.dataset.on = newVal;
      this.saveAutoCollect(newVal);
      UI.toast(`スケジュール収集を${newVal ? 'ON' : 'OFF'}にしました`, 'success');
    });
  },

  // スケジュール時間UI初期化
  _initSchedule() {
    const times = this.getScheduleTimes();
    times.forEach((t, i) => this._addScheduleRow(t.hour, t.minute, i === 0));
    const addBtn = document.getElementById('btnAddSchedule');
    if (!addBtn) return;
    addBtn.addEventListener('click', () => {
      const list  = document.getElementById('scheduleTimeList');
      const count = list.querySelectorAll('.schedule-time-row').length;
      if (count >= 5) { UI.toast('スケジュールは最大5つまでです', 'info'); return; }
      this._addScheduleRow(10, 0, false);
    });
  },

  // スケジュール時間行を追加
  _addScheduleRow(hour, minute, isFirst) {
    const list = document.getElementById('scheduleTimeList');
    if (!list) return;
    const index    = list.querySelectorAll('.schedule-time-row').length;
    const row      = document.createElement('div');
    row.className  = 'schedule-time-row';
    const hourOpts = Array.from({ length: 24 }, (_, i) =>
      `<option value="${i}" ${i === hour ? 'selected' : ''}>${String(i).padStart(2,'0')}</option>`
    ).join('');
    const minOpts  = [0,5,10,15,20,25,30,35,40,45,50,55].map(m =>
      `<option value="${m}" ${m === minute ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`
    ).join('');
    row.innerHTML = `
      <span class="schedule-label">⏰ 時刻 ${index + 1}</span>
      <div class="schedule-time-selects">
        <select class="schedule-select schedule-hour">${hourOpts}</select>
        <span class="schedule-colon">:</span>
        <select class="schedule-select schedule-minute">${minOpts}</select>
      </div>
      ${!isFirst ? `<button class="schedule-del-btn" title="削除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>` : ''}
    `;
    if (!isFirst) {
      row.querySelector('.schedule-del-btn').addEventListener('click', () => {
        row.remove();
        list.querySelectorAll('.schedule-time-row .schedule-label').forEach((el, i) => {
          el.textContent = `⏰ 時刻 ${i + 1}`;
        });
      });
    }
    list.appendChild(row);
  },

  // スケジュール時間をUIから取得
  _getScheduleTimesFromUI() {
    return [...document.querySelectorAll('.schedule-time-row')].map(row => ({
      hour:   parseInt(row.querySelector('.schedule-hour').value),
      minute: parseInt(row.querySelector('.schedule-minute').value),
    }));
  },

  // スーパー検索行の初期化
  _initStoreSearchRows() {
    const rows = document.getElementById('storeSearchRows');
    if (!rows) return;
    this._bindSearchRow(rows.querySelector('.store-search-row'));
  },

  // 検索欄追加ボタン
  _initAddRowBtn() {
    const btn = document.getElementById('btnAddStoreRow');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const rows  = document.getElementById('storeSearchRows');
      const count = rows.querySelectorAll('.store-search-row').length;
      const div   = document.createElement('div');
      div.className = 'store-search-row';
      div.dataset.row = count;
      div.innerHTML = `
        <div class="store-search-input-wrap">
          <input type="text" class="field-input store-address-input" placeholder="例: 栃木県足利市小俣町">
          <button class="ghost-btn store-search-btn">検索</button>
          <button class="registered-store-del remove-row-btn" title="この欄を削除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="store-candidates" style="display:none"></div>
      `;
      div.querySelector('.remove-row-btn').addEventListener('click', () => div.remove());
      rows.appendChild(div);
      this._bindSearchRow(div);
    });
  },

  // 今すぐ収集ボタン
  _initCollectNowBtn() {
    const btn = document.getElementById('btnCollectNow');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const stores = this.getStores();
      if (stores.length === 0) {
        UI.toast('スーパーを登録してください', 'error');
        return;
      }
      // 設定パネルを閉じる
      document.getElementById('settingsOverlay').style.display = 'none';
      await App.collectPrices(stores);
    });
  },

  // 保存ボタン（GAS URL・スプレッドシートURL・スケジュール・トリガー更新）
  _initSaveBtn() {
    const btn = document.getElementById('btnSaveConfig');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const gasUrl   = document.getElementById('gasUrl').value.trim();
      const sheetUrl = document.getElementById('sheetUrl').value.trim();
      Config.save({ gasUrl, sheetUrl });
      document.getElementById('btnOpenSheet').style.display = sheetUrl ? 'flex' : 'none';

      // スケジュール時間を保存
      const times  = this._getScheduleTimesFromUI();
      this.saveScheduleTimes(times);

      // GASにスケジュール設定を送信してトリガーを自動更新
      if (gasUrl) {
        btn.textContent = '保存・トリガー更新中...';
        btn.disabled    = true;
        try {
          const autoOn = this.getAutoCollect();
          const res    = await fetch(gasUrl, {
            method: 'POST',
            body: JSON.stringify({
              action:        'updateTriggers',
              scheduleTimes: times,
              autoCollect:   autoOn ? 'ON' : 'OFF',
            }),
          });
          const data = await res.json();
          if (data.success) {
            UI.toast(
              `設定を保存しました。トリガー${data.triggerCount}件を更新しました`,
              'success', 5000
            );
          } else {
            UI.toast('設定を保存しました（トリガー更新失敗）', 'info');
          }
        } catch (e) {
          UI.toast('設定を保存しました（トリガー更新失敗）', 'info');
          console.warn('トリガー更新失敗:', e);
        } finally {
          btn.textContent = '保存する';
          btn.disabled    = false;
        }
      } else {
        UI.toast('設定を保存しました', 'success');
      }

      document.getElementById('settingsOverlay').style.display = 'none';
    });
  },

  // 検索行にイベントをバインド
  _bindSearchRow(row) {
    if (!row) return;
    const searchBtn  = row.querySelector('.store-search-btn');
    const input      = row.querySelector('.store-address-input');
    const candidates = row.querySelector('.store-candidates');

    const doSearch = async () => {
      const address = input.value.trim();
      if (!address) { UI.toast('住所を入力してください', 'error'); return; }

      searchBtn.disabled = true;
      searchBtn.textContent = '検索中...';
      candidates.style.display = 'none';
      candidates.innerHTML = '';

      try {
        const gasUrl = Config.get('gasUrl');
        if (!gasUrl) { UI.toast('GAS URLを設定してください', 'error'); return; }

        const params = new URLSearchParams({ action: 'findStores', address });
        const res    = await fetch(`${gasUrl}?${params}`);
        const data   = await res.json();

        if (data.geminiError && data.errorInfo) {
          UI.showGeminiError(data.errorInfo);
          return;
        }

        const stores = data.stores || [];
        if (stores.length === 0) {
          UI.toast('スーパーが見つかりませんでした', 'info');
          return;
        }

        // 候補リストを表示
        candidates.style.display = 'flex';
        stores.forEach(store => {
          const item = document.createElement('div');
          item.className = 'store-candidate-item';
          item.innerHTML = `
            <div>
              <div class="store-candidate-name">${UI._e(store.name)}</div>
              <div class="store-candidate-addr">${UI._e(store.address || address)}</div>
            </div>
            <span class="store-candidate-add">＋ 登録</span>
          `;
          item.addEventListener('click', () => {
            const ok = Settings.addStore({
              id:         store.id || 'reg_' + Date.now(),
              name:       store.name,
              address:    store.address || address,
              tokubaiUrl: store.tokubaiUrl || '',
            });
            if (ok) {
              item.querySelector('.store-candidate-add').textContent = '✓ 登録済み';
              item.querySelector('.store-candidate-add').style.color = 'var(--text3)';
              UI.toast(`${store.name}を登録しました`, 'success');
            }
          });
          candidates.appendChild(item);
        });

      } catch (e) {
        UI.toast(`検索エラー: ${e.message}`, 'error');
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = '検索';
      }
    };

    searchBtn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  },

  // 登録済みスーパー一覧を描画
  renderRegisteredStores() {
    const stores  = this.getStores();
    const section = document.getElementById('registeredStoresSection');
    const list    = document.getElementById('registeredStoresList');
    if (!section || !list) return;

    section.style.display = stores.length > 0 ? 'block' : 'none';
    list.innerHTML = '';

    stores.forEach(store => {
      const item = document.createElement('div');
      item.className = 'registered-store-item';
      item.innerHTML = `
        <div class="registered-store-info">
          <span class="registered-store-name">${UI._e(store.name)}</span>
          <span class="registered-store-addr">${UI._e(store.address || '—')}</span>
        </div>
        <button class="registered-store-del" data-name="${UI._e(store.name)}" title="削除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      `;
      item.querySelector('.registered-store-del').addEventListener('click', e => {
        const name = e.currentTarget.dataset.name;
        if (confirm(`「${name}」を削除しますか？`)) {
          this.removeStore(name);
          UI.toast(`${name}を削除しました`, 'success');
        }
      });
      list.appendChild(item);
    });
  },
};

const _shakeStyle = document.createElement('style');
_shakeStyle.textContent = `@keyframes shake {
  0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)}
  40%{transform:translateX(6px)} 60%{transform:translateX(-4px)}
  80%{transform:translateX(4px)}
}`;
document.head.appendChild(_shakeStyle);

document.addEventListener('DOMContentLoaded', () => App.init());

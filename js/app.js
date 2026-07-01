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
    this._updateSheetLink();
    this._bindCommandModal();
    this._bindClearFilter();
    // 設定画面初期化
    Settings.init();
  },

  // コマンドモーダル
  _bindCommandModal() {
    const btn      = document.getElementById('btnGetPrice');
    const modal    = document.getElementById('commandModal');
    const closeBtn = document.getElementById('btnCloseModal');
    const closeBtn2 = document.getElementById('btnCloseModal2');
    if (!btn || !modal) return;

    btn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
    [closeBtn, closeBtn2].forEach(b => {
      if (b) b.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  },

  // フィルタークリア
  _bindClearFilter() {
    const btn = document.getElementById('btnClearFilter');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // 住所フィルターをリセット
      const addressSelect = document.getElementById('historyAddressSelect');
      const keyword       = document.getElementById('historyStoreKeyword');
      const dateSelect    = document.getElementById('historyDateSelect');
      if (addressSelect) addressSelect.value = '';
      if (keyword) keyword.value = '';
      if (dateSelect) dateSelect.innerHTML = '<option value="">スーパーを選択してください</option>';

      // 表示中の価格一覧をクリア
      const historyResult = document.getElementById('historyResult');
      if (historyResult) historyResult.innerHTML = '';

      // 設定画面を閉じる
      document.getElementById('settingsOverlay').style.display = 'none';

      UI.toast('フィルターをクリアしました', 'success');
    });
  },

  _updateSheetLink() {
    // prices.htmlでは価格履歴ボタンを非表示のまま維持
    if (document.body.dataset.page === 'prices') return;
    const sheetUrl = Config.get('sheetUrl');
    const btn      = document.getElementById('btnOpenSheet');
    if (!btn) return;
    if (sheetUrl) {
      btn.href          = sheetUrl;
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
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
          UI.toast('設定画面でGAS URLを入力してください', 'error');
          return;
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
          // 部分取得の場合もチラシなし一覧に追加（ただし結果は表示）
          if (isReal && result.searchLog && result.searchLog.incomplete) {
            noChirashi.push({ ...store, searchLog: result.searchLog });
          }
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

  // GASにスーパー一覧を保存（POST no-cors）
  async _saveStoresToGas(stores) {
    const gasUrl = Config.get('gasUrl');
    if (!gasUrl) return;
    try {
      await fetch(gasUrl, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'saveStores', stores: stores }),
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

  // 保存ボタン（スケジュール・スーパー登録・トリガー更新）
  _initSaveBtn() {
    const btn = document.getElementById('btnSaveConfig');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const gasUrl   = Config.get('gasUrl');
      const sheetUrl = document.getElementById('sheetUrl')?.value.trim() || '';
      if (sheetUrl) Config.save({ sheetUrl });

      // スケジュール時間を保存
      const times = this._getScheduleTimesFromUI();
      this.saveScheduleTimes(times);

      if (gasUrl) {
        btn.textContent = '保存中...';
        btn.disabled    = true;
        try {
          // ① 登録スーパーをスプレッドシートに保存（全件まとめてPOST no-cors）
          const stores = this.getStores();
          if (stores.length > 0) {
            // データが大きいのでPOSTのno-corsで送信
            await fetch(gasUrl, {
              method:  'POST',
              mode:    'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ action: 'saveStores', stores: stores }),
            });
          }

          // ② トリガーを更新
          const autoOn = this.getAutoCollect();
          const triggerParams = new URLSearchParams({
            action:        'updateTriggers',
            scheduleTimes: JSON.stringify(times),
            autoCollect:   autoOn ? 'ON' : 'OFF',
          });
          const res  = await fetch(`${gasUrl}?${triggerParams}`);
          const data = await res.json();

          if (data.success) {
            UI.toast(
              `設定を保存しました。トリガー${data.triggerCount}件を更新しました`,
              'success', 5000
            );
          } else {
            UI.toast('設定を保存しました（トリガー更新失敗: ' + (data.error || '不明') + '）', 'info');
          }
        } catch (e) {
          UI.toast('設定を保存しました（一部失敗）', 'info');
          console.warn('保存失敗:', e);
        } finally {
          btn.textContent = '保存する';
          btn.disabled    = false;
        }
      } else {
        UI.toast('設定を保存しました', 'success');
      }

      document.getElementById('settingsOverlay').style.display = 'none';
      App._updateSheetLink();
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
      if (!address) { UI.toast('キーワードを入力してください', 'error'); return; }

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
          UI.toast(data.error || '該当するスーパーが見つかりませんでした', 'info');
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

// ===========================
// History - 履歴タブ管理
// ===========================
const History = {
  filterOptions: { addresses: [], addressMap: {}, allStores: [] },
  currentMode:   'normal',
  allData:       [],

  init() {
    this._loadFilterOptions();
    this._bindEvents();
  },

  // プルダウン複数選択を作成
  _createMultiSelect(wrapperId, items, placeholder, accentColor = '#89b4fa') {
    const wrap = document.getElementById(wrapperId);
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="multi-select-wrap" id="${wrapperId}_wrap">
        <button class="multi-select-btn" id="${wrapperId}_btn" type="button">
          <span id="${wrapperId}_label">${placeholder}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="multi-select-dropdown" id="${wrapperId}_dropdown">
          <label class="multi-select-item all-item">
            <input type="checkbox" id="${wrapperId}_all" style="accent-color:#b4f082">
            全て選択
          </label>
          ${items.map(item => `
            <label class="multi-select-item">
              <input type="checkbox" class="${wrapperId}_item" value="${item}" style="accent-color:${accentColor}">
              ${item}
            </label>
          `).join('')}
        </div>
      </div>
    `;

    // ボタンクリックでドロップダウン開閉
    const btn      = document.getElementById(`${wrapperId}_btn`);
    const dropdown = document.getElementById(`${wrapperId}_dropdown`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 他のドロップダウンを閉じる
      document.querySelectorAll('.multi-select-dropdown.open').forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      dropdown.classList.toggle('open');
    });

    // 欄外クリックで閉じる・反映
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.classList.remove('open');
      }
    });

    // ドロップダウン内クリックは閉じない
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 全選択
    const allCb = document.getElementById(`${wrapperId}_all`);
    if (allCb) {
      allCb.addEventListener('change', () => {
        document.querySelectorAll(`.${wrapperId}_item`).forEach(cb => cb.checked = allCb.checked);
        this._updateMultiSelectLabel(wrapperId, placeholder);
        this._renderResults();
      });
    }

    // 各アイテム
    document.querySelectorAll(`.${wrapperId}_item`).forEach(cb => {
      cb.addEventListener('change', () => {
        const all     = document.querySelectorAll(`.${wrapperId}_item`);
        const checked = document.querySelectorAll(`.${wrapperId}_item:checked`);
        if (allCb) allCb.checked = all.length === checked.length;
        this._updateMultiSelectLabel(wrapperId, placeholder);
        this._renderResults();
      });
    });
  },

  _updateMultiSelectLabel(wrapperId, placeholder) {
    const checked = document.querySelectorAll(`.${wrapperId}_item:checked`);
    const label   = document.getElementById(`${wrapperId}_label`);
    if (!label) return;
    if (checked.length === 0) {
      label.textContent = placeholder;
    } else {
      const all = document.querySelectorAll(`.${wrapperId}_item`);
      label.textContent = all.length === checked.length
        ? '全て選択中'
        : `${checked.length}件選択中`;
    }
  },

  _getMultiSelected(wrapperId) {
    return Array.from(document.querySelectorAll(`.${wrapperId}_item:checked`)).map(cb => cb.value);
  },

  async _loadFilterOptions() {
    const addressSelect = document.getElementById('historyAddressSelect');
    if (!addressSelect) return;
    addressSelect.innerHTML = '<option value="">読み込み中...</option>';
    try {
      const gasUrl = Config.get('gasUrl');
      const res    = await fetch(`${gasUrl}?${new URLSearchParams({ action: 'getFilterOptions' })}`);
      const data   = await res.json();
      this.filterOptions = data;

      addressSelect.innerHTML = '<option value="">すべての住所</option>';
      (data.addresses || []).forEach(addr => {
        const opt = document.createElement('option');
        opt.value = addr; opt.textContent = addr;
        addressSelect.appendChild(opt);
      });

      await this._loadDates();
      this._createMultiSelect('storeMultiSelect', data.allStores || [], 'スーパーを選択...');
    } catch(e) {
      addressSelect.innerHTML = '<option value="">取得失敗</option>';
    }
  },

  async _loadDates() {
    const dateSelect = document.getElementById('historyDateSelect');
    if (!dateSelect) return;
    dateSelect.innerHTML = '<option value="">読み込み中...</option>';
    try {
      const gasUrl = Config.get('gasUrl');
      const res    = await fetch(`${gasUrl}?${new URLSearchParams({ action: 'getHistoryDates' })}`);
      const data   = await res.json();
      dateSelect.innerHTML = '<option value="">すべての日付</option>';
      (data.dates || []).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        dateSelect.appendChild(opt);
      });
    } catch(e) {
      dateSelect.innerHTML = '<option value="">取得失敗</option>';
    }
  },

  _updateItemMultiSelect(items) {
    const box = document.getElementById('itemMultiSelectWrap');
    if (!box) return;

    const itemNames = [...new Set(items.map(i => i.itemName || '').filter(Boolean))].sort();
    if (itemNames.length === 0) {
      box.style.display = 'none';
      return;
    }

    box.style.display = 'block';
    this._createMultiSelect('itemMultiSelect', itemNames, '品種を選択...', '#cba6f7');
  },

  _bindEvents() {
    const addressSelect = document.getElementById('historyAddressSelect');
    const loadBtn       = document.getElementById('btnLoadHistory');
    const btnNormal     = document.getElementById('btnModeNormal');
    const btnCheapest   = document.getElementById('btnModeCheapest');

    if (addressSelect) {
      addressSelect.addEventListener('change', () => {
        const addr   = addressSelect.value;
        const stores = addr
          ? (this.filterOptions.addressMap?.[addr] || [])
          : (this.filterOptions.allStores || []);
        this._createMultiSelect('storeMultiSelect', stores, 'スーパーを選択...');
        this._loadDates();
      });
    }

    const typeFilter = document.getElementById('historyTypeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => this._renderResults());
    }

    if (btnNormal) {
      btnNormal.addEventListener('click', () => {
        this.currentMode = 'normal';
        btnNormal.classList.add('active');
        btnCheapest.classList.remove('active');
        this._renderResults();
      });
    }

    if (btnCheapest) {
      btnCheapest.addEventListener('click', () => {
        this.currentMode = 'cheapest';
        btnCheapest.classList.add('active');
        btnNormal.classList.remove('active');
        this._renderResults();
      });
    }

    if (loadBtn) {
      loadBtn.addEventListener('click', () => this._loadData());
    }
  },

  async _loadData() {
    const date   = document.getElementById('historyDateSelect')?.value || '';
    const gasUrl = Config.get('gasUrl');

    UI.toast('データを読み込み中...', 'info', 2000);

    try {
      const params = new URLSearchParams({ action: 'getHistoryData' });
      if (date) params.append('date', date);
      const res  = await fetch(`${gasUrl}?${params}`);
      const data = await res.json();
      this.allData = data.items || [];

      this._updateItemMultiSelect(this.allData);
      this._renderResults();

      const section = document.getElementById('historyResultsSection');
      if (section) section.style.display = 'block';
      const empty = document.getElementById('historyEmptyState');
      if (empty) empty.style.display = 'none';

    } catch(e) {
      UI.toast('データ取得に失敗しました', 'error');
    }
  },

  _getFilteredData() {
    const FOOD_CATEGORIES  = ['野菜・果物', '肉・鶏', '魚介類', '乳製品・卵', 'パン・米', '飲料', '冷凍食品', '調味料'];
    const DAILY_CATEGORIES = ['生活雑貨'];

    const selectedStores = this._getMultiSelected('storeMultiSelect');
    const selectedItems  = this._getMultiSelected('itemMultiSelect');
    const typeFilter     = document.getElementById('historyTypeFilter')?.value || '';

    return this.allData.filter(item => {
      if (selectedStores.length > 0 && !selectedStores.includes(item.storeName)) return false;
      if (selectedItems.length > 0 && !selectedItems.includes(item.itemName)) return false;
      if (typeFilter === 'food'  && !FOOD_CATEGORIES.includes(item.category))  return false;
      if (typeFilter === 'daily' && !DAILY_CATEGORIES.includes(item.category)) return false;
      if (typeFilter === 'other' && (FOOD_CATEGORIES.includes(item.category) || DAILY_CATEGORIES.includes(item.category))) return false;
      return true;
    });
  },

  _renderResults() {
    const filtered = this._getFilteredData();
    if (this.currentMode === 'cheapest') {
      this._renderCheapest(filtered);
    } else {
      this._renderNormal(filtered);
    }
  },

  _renderNormal(items) {
    const tbody = document.getElementById('historyTableBody');
    const thead = document.getElementById('historyTableHead');
    if (!tbody || !thead) return;

    thead.innerHTML = `<tr>
      <th>品目</th><th>商品名</th><th>カテゴリ</th>
      <th>スーパー</th><th>価格</th><th>特売</th>
    </tr>`;

    tbody.innerHTML = '';
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3)">データがありません</td></tr>';
      return;
    }

    items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.itemName || ''}</td>
        <td>${item.name || ''}</td>
        <td><span class="cat-chip">${item.category || ''}</span></td>
        <td>${item.storeName || ''}</td>
        <td class="price-cell">¥${Number(item.price).toLocaleString()}</td>
        <td>${item.isSale ? '<span class="sale-badge">特売</span>' : ''}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  _renderCheapest(items) {
    const tbody = document.getElementById('historyTableBody');
    const thead = document.getElementById('historyTableHead');
    if (!tbody || !thead) return;

    // 品目別・スーパー別に集計
    const itemMap = {};
    items.forEach(item => {
      const name  = item.itemName || item.name || '';
      const store = item.storeName || '';
      if (!name) return;
      if (!itemMap[name]) itemMap[name] = {};
      if (!itemMap[name][store] || item.price < itemMap[name][store].price) {
        itemMap[name][store] = {
          price:    item.price,
          detail:   item.detail || '',
          category: item.category || '',
        };
      }
    });

    thead.innerHTML = `<tr>
      <th>品目</th><th>スーパー</th><th>価格</th><th>詳細</th><th>カテゴリ</th><th>備考</th>
    </tr>`;

    tbody.innerHTML = '';

    if (Object.keys(itemMap).length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3)">データがありません</td></tr>';
      return;
    }

    Object.keys(itemMap).sort().forEach(itemName => {
      const storeData  = itemMap[itemName];
      const storeNames = Object.keys(storeData);
      const cheapest   = storeNames.reduce((a, b) => storeData[a].price <= storeData[b].price ? a : b);
      const isMulti    = storeNames.length > 1;

      storeNames.sort((a, b) => storeData[a].price - storeData[b].price).forEach((store, idx) => {
        const tr      = document.createElement('tr');
        const isCheap = store === cheapest;
        tr.style.cssText = isCheap && isMulti ? 'background:rgba(166,227,161,0.08)' : '';
        tr.innerHTML = `
          <td style="font-weight:${idx === 0 ? '600' : '400'}">${idx === 0 ? itemName : ''}</td>
          <td>${store}</td>
          <td class="price-cell" style="${isCheap && isMulti ? 'color:#a6e3a1;font-weight:700' : ''}">
            ¥${Number(storeData[store].price).toLocaleString()}
          </td>
          <td style="font-size:12px;color:var(--text3)">${storeData[store].detail}</td>
          <td><span class="cat-chip" style="font-size:11px">${storeData[store].category}</span></td>
          <td>${isCheap && isMulti ? '<span class="sale-badge" style="background:rgba(166,227,161,0.2);color:#a6e3a1">★最安値</span>' : ''}</td>
        `;
        tbody.appendChild(tr);
      });
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  History.init();
});

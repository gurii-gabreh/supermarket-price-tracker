// ===========================
// app.js - メインロジック
// ===========================

const App = {
  currentStores: [],
  collectedData: [],
  collectedAt: null,

  init() {
    UI.initSetupPanel();
    this._initEventListeners();
    this._updateSheetButton();
  },

  _initEventListeners() {
    // スーパー検索
    document.getElementById('btnSearchStores').addEventListener('click', () => this.searchStores());
    document.getElementById('addressInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.searchStores();
    });

    // 全選択
    document.getElementById('btnSelectAll').addEventListener('click', () => UI.selectAllStores());

    // 価格収集
    document.getElementById('btnCollectPrices').addEventListener('click', () => this.collectPrices());
    document.getElementById('btnReCollect').addEventListener('click', () => this.collectPrices());

    // スプレッドシート保存・表示
    document.getElementById('btnExportSheet').addEventListener('click', () => this.exportToSheet());
    document.getElementById('btnOpenSheet').addEventListener('click', () => {
      const url = Config.get('sheetUrl');
      if (url) window.open(url, '_blank');
      else UI.toast('設定でGoogleスプレッドシートのURLを入力してください', 'info');
    });
  },

  _updateSheetButton() {
    const btn = document.getElementById('btnOpenSheet');
    btn.style.display = Config.get('sheetUrl') ? 'flex' : 'none';
  },

  // ── スーパーを検索（住所テキストベース） ──
  async searchStores() {
    const address = document.getElementById('addressInput').value.trim();
    if (!address) { UI.toast('住所を入力してください', 'error'); return; }

    const btn = document.getElementById('btnSearchStores');
    btn.disabled = true;
    btn.textContent = '🔍 検索中...';

    try {
      const gasUrl = Config.get('gasUrl');

      if (gasUrl) {
        // 本番: GASでスーパー検索
        const params = new URLSearchParams({ action: 'findStores', address });
        const res = await fetch(`${gasUrl}?${params}`);
        if (!res.ok) throw new Error(`GASリクエスト失敗: ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.currentStores = data.stores || [];
      } else {
        // デモモード: サンプルスーパーを生成
        await new Promise(r => setTimeout(r, 500));
        this.currentStores = this._getDemoStores(address);
      }

      UI.renderStores(this.currentStores, !gasUrl);
      if (this.currentStores.length > 0) {
        UI.toast(`${this.currentStores.length}件のスーパーが見つかりました！`, 'success');
        // 住所入力欄の直下にスーパー一覧が表示されるようスクロール
        setTimeout(() => {
          document.getElementById('storesSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        UI.toast('スーパーが見つかりませんでした', 'info');
      }
    } catch (e) {
      UI.toast(`エラー: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 スーパーを探す';
    }
  },

  // ── チラシ情報を収集 ──
  async collectPrices() {
    const selectedIds = [...UI.selectedStores];
    if (selectedIds.length === 0) {
      UI.toast('収集するスーパーを選択してください', 'error');
      return;
    }

    const selectedStores = this.currentStores.filter(s => selectedIds.includes(s.id));
    const btn = document.getElementById('btnCollectPrices');
    btn.disabled = true;
    UI.showCollecting(selectedStores.length);

    const storeResults = [];
    this.collectedAt = new Date().toISOString();
    const gasUrl = Config.get('gasUrl');

    for (let i = 0; i < selectedStores.length; i++) {
      const store = selectedStores[i];
      UI.updateCollectingProgress(store.name, i, selectedStores.length);
      try {
        const items = gasUrl
          ? await Scraper.fetchStorePrices(store)
          : await this._demoFetch(store);
        storeResults.push({ store, items });
      } catch (e) {
        console.error(`${store.name} 収集エラー:`, e);
        UI.toast(`${store.name}: 収集に失敗しました`, 'error');
        storeResults.push({ store, items: [] });
      }
    }

    UI.updateCollectingProgress('完了', selectedStores.length, selectedStores.length);
    await new Promise(r => setTimeout(r, 400));
    UI.hideCollecting();

    const mergedItems = Scraper.mergeAllPrices(storeResults);
    this.collectedData = mergedItems;
    this.collectedStores = selectedStores;

    UI.renderResults(mergedItems, selectedStores, this.collectedAt);
    btn.disabled = false;

    UI.toast(`✨ ${mergedItems.length}品目の価格情報を収集しました！${gasUrl ? '' : ' (デモ)'}`, 'success', 5000);
    setTimeout(() => {
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  },

  async _demoFetch(store) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 700));
    return Scraper.generateDemoData(store);
  },

  // ── スプレッドシートにエクスポート ──
  async exportToSheet() {
    if (!Config.get('gasUrl')) {
      UI.toast('設定でGoogle Apps Script URLを入力してください', 'error');
      return;
    }
    if (!this.collectedData?.length) {
      UI.toast('先にチラシ情報を収集してください', 'error');
      return;
    }

    const btn = document.getElementById('btnExportSheet');
    btn.disabled = true;
    btn.textContent = '⏳ 保存中...';

    try {
      await Scraper.saveToSheet(this.collectedData, this.collectedStores, this.collectedAt);
      UI.showSaveStatus(true, '✅ Googleスプレッドシートに保存しました！価格履歴ボタンで確認できます。');
      UI.toast('スプレッドシートに保存しました！', 'success');
      this._updateSheetButton();
    } catch (e) {
      UI.showSaveStatus(false, `❌ 保存に失敗しました: ${e.message}`);
      UI.toast(`保存エラー: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📊 スプレッドシートに保存';
    }
  },

  // ── デモ用サンプルスーパー生成 ──
  _getDemoStores(address) {
    const names = [
      'ベルク', 'カスミ', 'マルエツ', 'ヤオコー', 'コープ',
      'イオン', 'ライフ', 'オーケー', 'ロピア', 'サミット'
    ];
    const suffixes = ['店', 'フードセンター', 'スーパー'];
    const count = 5 + Math.floor(Math.random() * 4);
    return Array.from({ length: count }, (_, i) => ({
      id: `demo_${i}`,
      name: `${names[i % names.length]}${suffixes[i % suffixes.length]}`,
      address: `${address} ${i + 1}丁目付近`,
      distance: parseFloat((0.2 + Math.random() * 2.8).toFixed(1)),
      rating: parseFloat((3.2 + Math.random() * 1.5).toFixed(1)),
      openNow: Math.random() > 0.2,
      website: null,
    })).sort((a, b) => a.distance - b.distance);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

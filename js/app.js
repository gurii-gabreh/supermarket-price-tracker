// ===========================
// app.js - メインロジック
// ===========================

const App = {
  currentStores: [],
  collectedData: [],
  collectedAt: null,

  init() {
    UI.initSetupPanel();
    this._bindEvents();
    const sheetUrl = Config.get('sheetUrl');
    document.getElementById('btnOpenSheet').style.display = sheetUrl ? 'flex' : 'none';
  },

  _bindEvents() {
    document.getElementById('btnSearchStores').addEventListener('click', () => this.searchStores());
    document.getElementById('addressInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.searchStores();
    });
    document.getElementById('addressInput').addEventListener('focus', () => {
      document.getElementById('searchField').style.borderColor = 'var(--lime)';
    });
    document.getElementById('addressInput').addEventListener('blur', () => {
      document.getElementById('searchField').style.borderColor = '';
    });
    document.getElementById('btnSelectAll').addEventListener('click', () => UI.selectAllStores());
    document.getElementById('btnCollectPrices').addEventListener('click', () => this.collectPrices());
    document.getElementById('btnReCollect').addEventListener('click', () => this.collectPrices());
    document.getElementById('btnExportSheet').addEventListener('click', () => this.exportToSheet());
    document.getElementById('btnOpenSheet').addEventListener('click', () => {
      const url = Config.get('sheetUrl');
      if (url) window.open(url, '_blank');
      else UI.toast('設定でスプレッドシートURLを入力してください', 'info');
    });
  },

  // ══════════════════════════════════════════
  // スーパー検索
  // GAS設定済み → GAS経由でOverpass検索（確実）
  // GAS未設定   → デモデータ
  // ══════════════════════════════════════════
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
      const gasUrl = Config.get('gasUrl');
      let stores;

      if (gasUrl) {
        // GAS経由でスーパー検索（Googleサーバーから実行→タイムアウトしない）
        const params = new URLSearchParams({ action: 'findStores', address });
        const res    = await fetch(`${gasUrl}?${params}`);
        if (!res.ok) throw new Error(`通信エラー: ${res.status}`);
        const data   = await res.json();
        if (data.error) throw new Error(data.error);
        stores = data.stores || [];
        UI.renderStores(stores, false);
        UI.toast(`${stores.length}件のスーパーが見つかりました`, 'success');
      } else {
        // GAS未設定 → デモ
        await new Promise(r => setTimeout(r, 600));
        stores = this._demoStores(address);
        UI.renderStores(stores, true);
        UI.toast('GAS URLを設定すると実際のお店が検索できます', 'info', 6000);
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
  async collectPrices() {
    const selectedIds = [...UI.selectedStores];
    if (selectedIds.length === 0) {
      UI.toast('収集するスーパーを選択してください', 'error');
      return;
    }
    const selected = this.currentStores.filter(s => selectedIds.includes(s.id));
    const btn = document.getElementById('btnCollectPrices');
    btn.disabled = true;
    UI.showCollecting(selected.length);
    this.collectedAt = new Date().toISOString();
    const results      = [];
    const noChirashi   = []; // チラシなし店舗
    const gasUrl       = Config.get('gasUrl');

    for (let i = 0; i < selected.length; i++) {
      const store = selected[i];
      UI.updateCollectingProgress(store.name, i, selected.length);
      try {
        const items = gasUrl
          ? await Scraper.fetchStorePrices(store)
          : await this._demoFetch(store);

        // GASから空配列が返った＝チラシなし
        if (gasUrl && (!items || items.length === 0)) {
          noChirashi.push(store);
          results.push({ store, items: [], noChirashi: true });
        } else {
          results.push({ store, items });
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
    btn.disabled = false;

    const withChirashi = selected.length - noChirashi.length;
    UI.toast(
      `${withChirashi}店のチラシから${merged.length}品目を収集${noChirashi.length > 0 ? `（${noChirashi.length}店はチラシなし）` : ''}`,
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

  // ── デモ用スーパー生成 ──
  _demoStores(address) {
    const list = ['ベルク','カスミ','マルエツ','ヤオコー','コープみらい','イオン','ライフ','オーケー','ロピア','サミット'];
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

const _shakeStyle = document.createElement('style');
_shakeStyle.textContent = `@keyframes shake {
  0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)}
  40%{transform:translateX(6px)} 60%{transform:translateX(-4px)}
  80%{transform:translateX(4px)}
}`;
document.head.appendChild(_shakeStyle);

document.addEventListener('DOMContentLoaded', () => App.init());

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
    this._autoFillLocation();
  },

  // ── IPから現在地を自動入力 ──
  async _autoFillLocation() {
    const input = document.getElementById('addressInput');
    if (input.value.trim()) return;
    try {
      const res  = await fetch('https://ip-api.com/json/?lang=ja&fields=status,city,regionName');
      const data = await res.json();
      if (data.status === 'success') {
        input.value = [data.regionName, data.city].filter(Boolean).join(' ');
      }
    } catch (e) { /* 無視 */ }
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
  // スーパー検索（OpenStreetMap 完全無料）
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
      // STEP1: Nominatim で住所→座標変換（無料）
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=ja`,
        { headers: { 'Accept-Language': 'ja' } }
      );
      const geoData = await geoRes.json();

      if (!geoData || geoData.length === 0) {
        UI.toast('住所が見つかりませんでした。別の住所を試してください。', 'error');
        return;
      }

      const lat = parseFloat(geoData[0].lat);
      const lon = parseFloat(geoData[0].lon);

      // STEP2: Overpass API でスーパーを検索（無料・半径2km）
      const radius = 2000; // メートル
      const query = `
        [out:json][timeout:20];
        (
          node["shop"="supermarket"](around:${radius},${lat},${lon});
          node["shop"="grocery"](around:${radius},${lat},${lon});
          node["shop"="convenience"](around:${radius},${lat},${lon});
          way["shop"="supermarket"](around:${radius},${lat},${lon});
          way["shop"="grocery"](around:${radius},${lat},${lon});
        );
        out center;
      `;

      const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
      });
      const overpassData = await overpassRes.json();

      // STEP3: 結果をアプリ形式に変換
      const stores = (overpassData.elements || [])
        .filter(el => el.tags && el.tags.name)
        .map(el => {
          const elLat = el.lat ?? el.center?.lat ?? lat;
          const elLon = el.lon ?? el.center?.lon ?? lon;
          const dist  = this._calcDistance(lat, lon, elLat, elLon);
          return {
            id:       `osm_${el.id}`,
            name:     el.tags.name,
            address:  el.tags['addr:full'] || el.tags['addr:city'] || address,
            distance: Math.round(dist * 10) / 10,
            rating:   null,
            openNow:  null,
            website:  el.tags.website || null,
            lat: elLat,
            lon: elLon,
          };
        })
        .sort((a, b) => a.distance - b.distance);

      this.currentStores = stores;

      if (stores.length > 0) {
        UI.renderStores(stores, false);
        UI.toast(`${stores.length}件のスーパーが見つかりました`, 'success');
        setTimeout(() => {
          document.getElementById('storesSection')
            .scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        // OpenStreetMapに登録がない場合はデモにフォールバック
        const demoStores = this._demoStores(address);
        this.currentStores = demoStores;
        UI.renderStores(demoStores, true);
        UI.toast('付近のスーパー情報が見つからないためサンプルを表示します', 'info', 6000);
      }

    } catch (e) {
      UI.toast(`検索エラー: ${e.message}`, 'error');
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'スーパーを探す <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  },

  // 2点間距離計算（km）
  _calcDistance(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 +
                 Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
                 Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
    const results = [];
    const gasUrl  = Config.get('gasUrl');

    for (let i = 0; i < selected.length; i++) {
      const store = selected[i];
      UI.updateCollectingProgress(store.name, i, selected.length);
      try {
        const items = gasUrl
          ? await Scraper.fetchStorePrices(store)
          : await this._demoFetch(store);
        results.push({ store, items });
      } catch (e) {
        console.error(store.name, e);
        UI.toast(`${store.name}: 収集失敗`, 'error');
        results.push({ store, items: [] });
      }
    }

    UI.updateCollectingProgress('完了', selected.length, selected.length);
    await new Promise(r => setTimeout(r, 400));
    UI.hideCollecting();

    const merged = Scraper.mergeAllPrices(results);
    this.collectedData   = merged;
    this.collectedStores = selected;

    UI.renderResults(merged, selected, this.collectedAt);
    btn.disabled = false;

    UI.toast(`${merged.length}品目の価格を収集しました${gasUrl ? '' : '（デモ）'}`, 'success', 5000);
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

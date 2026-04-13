// ===========================
// ui.js - UI管理
// ===========================

const UI = {
  selectedStores: new Set(),
  currentCategory: 'all',
  currentViewMode: 'ranking',   // 'ranking' | 'discount' | 'byStore'
  currentStoreFilter: null,     // byStoreモード時の選択店舗ID
  mergedItems: [],
  allStores: [],
  sortColumn: 'name',
  sortAsc: true,

  // ── トースト ──
  toast(message, type = 'info', duration = 4000) {
    const icons = { success: '✓', error: '✕', info: 'i' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span style="font-weight:700;font-family:var(--font-en)">${icons[type]}</span><span>${message}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration);
  },

  // ── 設定パネル ──
  initSetupPanel() {
    const cfg = Config.load();
    if (cfg.gasUrl)   document.getElementById('gasUrl').value   = cfg.gasUrl;
    if (cfg.sheetUrl) document.getElementById('sheetUrl').value = cfg.sheetUrl;

    const overlay = document.getElementById('settingsOverlay');
    document.getElementById('btnToggleSetup').addEventListener('click', () => { overlay.style.display = 'flex'; });
    document.getElementById('drawerClose').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });

    document.getElementById('btnSaveConfig').addEventListener('click', () => {
      const gasUrl   = document.getElementById('gasUrl').value.trim();
      const sheetUrl = document.getElementById('sheetUrl').value.trim();
      Config.save({ gasUrl, sheetUrl });
      this.toast('設定を保存しました', 'success');
      overlay.style.display = 'none';
      document.getElementById('btnOpenSheet').style.display = sheetUrl ? 'flex' : 'none';
    });
  },

  // ── スーパーカード ──
  renderStores(stores, isDemo = false) {
    this.allStores = stores;
    this.selectedStores.clear();

    const grid    = document.getElementById('storesGrid');
    const section = document.getElementById('storesSection');
    const empty   = document.getElementById('emptyState');

    grid.innerHTML = '';
    document.getElementById('storeCount').textContent = stores.length + '件';
    section.style.display = 'block';
    empty.style.display   = 'none';

    if (isDemo) {
      const notice = document.createElement('p');
      notice.className = 'demo-notice';
      notice.textContent = '⚡ デモモード: サンプルのお店を表示しています。GAS URLを設定すると実際のお店が取得できます。';
      grid.appendChild(notice);
    }

    if (stores.length === 0) {
      grid.innerHTML += '<p style="color:var(--text2);padding:20px;grid-column:1/-1;font-size:14px">この住所付近にスーパーが見つかりませんでした。</p>';
      return;
    }

    stores.forEach(store => {
      const card = document.createElement('div');
      card.className = 'store-card';
      card.dataset.id = store.id;

      const openTag   = store.openNow === true  ? '<span class="store-tag open">営業中</span>'
                      : store.openNow === false ? '<span class="store-tag closed">閉店中</span>' : '';
      const distTag   = store.distance != null
        ? `<span class="store-tag">${store.distance < 1 ? Math.round(store.distance*1000)+'m' : store.distance.toFixed(1)+'km'}</span>` : '';
      const ratingTag = store.rating ? `<span class="store-tag">★ ${store.rating}</span>` : '';

      card.innerHTML = `
        <div class="store-check">✓</div>
        <div class="store-name">${this._e(store.name)}</div>
        <div class="store-address">${this._e(store.address)}</div>
        <div class="store-tags">${distTag}${ratingTag}${openTag}</div>
      `;
      card.addEventListener('click', () => this._toggleStore(store.id, card));
      grid.appendChild(card);
    });

    stores.forEach(s => {
      const card = grid.querySelector(`[data-id="${s.id}"]`);
      if (card) this._toggleStore(s.id, card);
    });
  },

  _toggleStore(id, card) {
    if (this.selectedStores.has(id)) {
      this.selectedStores.delete(id); card?.classList.remove('selected');
    } else {
      this.selectedStores.add(id);   card?.classList.add('selected');
    }
  },

  selectAllStores() {
    const grid = document.getElementById('storesGrid');
    this.allStores.forEach(s => {
      if (!this.selectedStores.has(s.id)) {
        const card = grid.querySelector(`[data-id="${s.id}"]`);
        if (card) this._toggleStore(s.id, card);
      }
    });
  },

  // ── 収集プログレス ──
  showCollecting(total) {
    document.getElementById('collectingOverlay').style.display = 'flex';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressText').textContent = `0 / ${total}`;
  },
  updateCollectingProgress(name, current, total) {
    document.getElementById('collectingStoreName').textContent = name;
    document.getElementById('progressBar').style.width = `${Math.round(current/total*100)}%`;
    document.getElementById('progressText').textContent = `${current} / ${total}`;
  },
  hideCollecting() {
    document.getElementById('collectingOverlay').style.display = 'none';
  },

  // ── 結果レンダリング（メイン） ──
  renderResults(items, stores, collectedAt) {
    this.mergedItems = items;
    this.allStores   = stores;
    this.currentViewMode   = 'ranking';
    this.currentCategory   = 'all';
    this.currentStoreFilter = stores[0]?.id || null;

    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('resultDate').textContent =
      new Date(collectedAt).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });

    this._renderRanking(items, stores);
    this._renderViewModeTabs(items, stores);
    this._renderCurrentView();
  },

  // ── 最安値ランキングカード ──
  _renderRanking(items, stores) {
    const medals  = ['🥇','🥈','🥉','🏅'];
    const scores  = stores.map(s => {
      let wins = 0, savings = 0;
      items.forEach(item => {
        if (item.minStoreId === s.id) {
          wins++;
          const prices = Object.values(item.stores).map(d => d.price);
          savings += Math.max(...prices) - item.minPrice;
        }
      });
      return { store: s, wins, savings };
    }).sort((a, b) => b.wins - a.wins);

    const el = document.getElementById('bestDealSection');
    el.innerHTML = '';
    scores.slice(0, 4).forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'ranking-card';
      card.innerHTML = `
        <div class="ranking-medal">${medals[i]}</div>
        <div class="ranking-store">${this._e(r.store.name)}</div>
        <div class="ranking-wins">${r.wins}品目で最安値</div>
        <div class="ranking-saving">¥${r.savings.toLocaleString()} 節約可能</div>
      `;
      el.appendChild(card);
    });
  },

  // ── 表示モードタブ ──
  _renderViewModeTabs(items, stores) {
    const tabsEl = document.getElementById('categoryTabs');
    tabsEl.innerHTML = '';

    // ── 表示モード切り替えボタン ──
    const modes = [
      { key: 'ranking',  label: '🏆 最安値ランキング表' },
      { key: 'discount', label: '🔥 値引き率が高い順' },
      { key: 'byStore',  label: '🏪 スーパー別最安値' },
    ];

    const modeRow = document.createElement('div');
    modeRow.className = 'mode-row';

    modes.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'mode-tab' + (m.key === this.currentViewMode ? ' active' : '');
      btn.textContent = m.label;
      btn.addEventListener('click', () => {
        this.currentViewMode = m.key;
        modeRow.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderCurrentView();
      });
      modeRow.appendChild(btn);
    });

    tabsEl.appendChild(modeRow);

    // ── カテゴリフィルター（ranking/discountモード用） ──
    const cats = ['すべて', ...[...new Set(items.map(i => i.category))]];
    const catRow = document.createElement('div');
    catRow.className = 'cat-row';
    catRow.id = 'catRow';

    cats.forEach(cat => {
      const key   = cat === 'すべて' ? 'all' : cat;
      const count = cat === 'すべて' ? items.length : items.filter(i => i.category === cat).length;
      const btn   = document.createElement('button');
      btn.className = 'filter-tab' + (key === this.currentCategory ? ' active' : '');
      btn.textContent = `${cat} ${count}`;
      btn.addEventListener('click', () => {
        this.currentCategory = key;
        catRow.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderCurrentView();
      });
      catRow.appendChild(btn);
    });

    tabsEl.appendChild(catRow);

    // ── スーパー選択（byStoreモード用） ──
    const storeRow = document.createElement('div');
    storeRow.className = 'store-filter-row';
    storeRow.id = 'storeFilterRow';
    storeRow.style.display = 'none';

    stores.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'store-filter-btn' + (s.id === this.currentStoreFilter ? ' active' : '');
      btn.textContent = s.name;
      btn.dataset.storeId = s.id;
      btn.addEventListener('click', () => {
        this.currentStoreFilter = s.id;
        storeRow.querySelectorAll('.store-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderCurrentView();
      });
      storeRow.appendChild(btn);
    });

    tabsEl.appendChild(storeRow);
  },

  // ── 現在のモードに応じた描画 ──
  _renderCurrentView() {
    const catRow      = document.getElementById('catRow');
    const storeRow    = document.getElementById('storeFilterRow');
    const tableWrap   = document.querySelector('.table-container');

    if (this.currentViewMode === 'ranking') {
      catRow.style.display   = 'flex';
      storeRow.style.display = 'none';
      this._renderRankingTable(this.mergedItems, this.allStores);
    } else if (this.currentViewMode === 'discount') {
      catRow.style.display   = 'flex';
      storeRow.style.display = 'none';
      this._renderDiscountTable(this.mergedItems);
    } else if (this.currentViewMode === 'byStore') {
      catRow.style.display   = 'none';
      storeRow.style.display = 'flex';
      this._renderByStoreTable(this.mergedItems, this.allStores);
    }
  },

  // ══════════════════════════════════════
  // モード1: 最安値ランキング表
  // 横軸 = 1位・2位・3位（スーパー名併記）
  // ══════════════════════════════════════
  _renderRankingTable(allItems, stores) {
    const items = this.currentCategory === 'all'
      ? allItems : allItems.filter(i => i.category === this.currentCategory);

    const thead = document.getElementById('priceTableHead');
    const tbody = document.getElementById('priceTableBody');

    // 最大3位まで
    const RANK = 3;
    const rankLabels = ['🥇 1位', '🥈 2位', '🥉 3位'];

    thead.innerHTML = `<tr>
      <th>商品名</th>
      ${rankLabels.map(l => `<th style="text-align:right">${l}</th>`).join('')}
    </tr>`;

    tbody.innerHTML = '';

    items.forEach(item => {
      // 価格を安い順にソート
      const ranked = Object.entries(item.stores)
        .map(([storeId, d]) => ({ storeId, ...d, store: stores.find(s => s.id === storeId) }))
        .filter(d => d.store)
        .sort((a, b) => a.price - b.price);

      const tr = document.createElement('tr');
      const rankCells = rankLabels.map((_, i) => {
        const d = ranked[i];
        if (!d) return `<td class="price-cell"><span class="price-none">—</span></td>`;
        const orig = d.originalPrice
          ? `<span style="text-decoration:line-through;font-size:11px;color:var(--text3)">¥${d.originalPrice.toLocaleString()}</span> ` : '';
        const sale = d.isSale ? '<span class="sale-badge">SALE</span>' : '';
        const cls  = i === 0 ? 'best' : d.isSale ? 'sale' : 'normal';
        return `<td class="price-cell">
          <div>${orig}<span class="price-tag ${cls}">¥${d.price.toLocaleString()}</span>${sale}</div>
          <div class="rank-store-name">${this._e(d.store.name)}</div>
        </td>`;
      }).join('');

      tr.innerHTML = `
        <td>
          <div class="item-name">${this._e(item.name)}</div>
          <span class="item-cat">${this._e(item.category)}</span>
          ${item.validDate && item.validDate !== '期間中' ? `<span class="valid-date-badge">${this._e(item.validDate)}</span>` : ''}
        </td>
        ${rankCells}
      `;
      tbody.appendChild(tr);
    });

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text3)">データがありません</td></tr>`;
    }
  },

  // ══════════════════════════════════════
  // モード2: 値引き率が高い順
  // 全商品を値引き額・率でフラットに並べる
  // ══════════════════════════════════════
  _renderDiscountTable(allItems) {
    const items = this.currentCategory === 'all'
      ? allItems : allItems.filter(i => i.category === this.currentCategory);

    // 全店舗×全商品の「値引きあり」エントリをフラット化
    const discountRows = [];
    items.forEach(item => {
      Object.entries(item.stores).forEach(([storeId, d]) => {
        if (d.originalPrice && d.originalPrice > d.price) {
          const saving    = d.originalPrice - d.price;
          const savingPct = Math.round(saving / d.originalPrice * 100);
          const store     = this.allStores.find(s => s.id === storeId);
          if (store) {
            discountRows.push({
              itemName: item.name,
              category: item.category,
              storeName: store.name,
              price: d.price,
              originalPrice: d.originalPrice,
              saving,
              savingPct,
            });
          }
        }
      });
    });

    // 値引き額の高い順にソート
    discountRows.sort((a, b) => b.saving - a.saving);

    const thead = document.getElementById('priceTableHead');
    const tbody = document.getElementById('priceTableBody');

    thead.innerHTML = `<tr>
      <th>商品名</th>
      <th>スーパー</th>
      <th style="text-align:right">元値</th>
      <th style="text-align:right">特売価格</th>
      <th style="text-align:right">値引き額</th>
      <th style="text-align:right">値引き率</th>
    </tr>`;

    tbody.innerHTML = '';

    if (discountRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3)">
        値引き情報がありません（SALEタグ付きの商品のみ表示されます）
      </td></tr>`;
      return;
    }

    discountRows.forEach((row, i) => {
      const tr = document.createElement('tr');
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
      tr.innerHTML = `
        <td>
          <div class="item-name">${medal}${this._e(row.itemName)}</div>
          <span class="item-cat">${this._e(row.category)}</span>
        </td>
        <td style="color:var(--text2);font-size:13px">${this._e(row.storeName)}</td>
        <td class="price-cell"><span style="text-decoration:line-through;color:var(--text3);font-size:13px">¥${row.originalPrice.toLocaleString()}</span></td>
        <td class="price-cell"><span class="price-tag sale">¥${row.price.toLocaleString()}</span></td>
        <td class="price-cell"><span class="discount-saving">－¥${row.saving.toLocaleString()}</span></td>
        <td class="price-cell"><span class="discount-pct">${row.savingPct}% OFF</span></td>
      `;
      tbody.appendChild(tr);
    });
  },

  // ══════════════════════════════════════
  // モード3: スーパー別最安値
  // 選択した店舗の商品を安い順に表示
  // ══════════════════════════════════════
  _renderByStoreTable(allItems, stores) {
    const storeId = this.currentStoreFilter;
    const store   = stores.find(s => s.id === storeId);
    if (!store) return;

    // 選択店舗の商品をすべて取得して安い順にソート
    const storeItems = [];
    allItems.forEach(item => {
      const d = item.stores[storeId];
      if (d) {
        const isMinOverall = item.minStoreId === storeId;
        storeItems.push({ ...item, storeData: d, isMinOverall });
      }
    });
    storeItems.sort((a, b) => a.storeData.price - b.storeData.price);

    const thead = document.getElementById('priceTableHead');
    const tbody = document.getElementById('priceTableBody');

    thead.innerHTML = `<tr>
      <th>商品名</th>
      <th style="text-align:right">${this._e(store.name)} の価格</th>
      <th style="text-align:right">他店最安値</th>
      <th style="text-align:right">比較</th>
    </tr>`;

    tbody.innerHTML = '';

    if (storeItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text3)">この店舗のデータがありません</td></tr>`;
      return;
    }

    storeItems.forEach(item => {
      const d = item.storeData;
      const orig = d.originalPrice
        ? `<span style="text-decoration:line-through;font-size:11px;color:var(--text3)">¥${d.originalPrice.toLocaleString()}</span> ` : '';
      const sale = d.isSale ? '<span class="sale-badge">SALE</span>' : '';

      // 他店の最安値
      const otherPrices = Object.entries(item.stores)
        .filter(([sid]) => sid !== storeId)
        .map(([, data]) => data.price);
      const otherMin = otherPrices.length ? Math.min(...otherPrices) : null;

      let compareCell = '<span class="price-none">—</span>';
      if (otherMin !== null) {
        const diff = d.price - otherMin;
        if (diff > 0) {
          compareCell = `<span class="compare-worse">＋¥${diff.toLocaleString()} 高い</span>`;
        } else if (diff < 0) {
          compareCell = `<span class="compare-best">－¥${Math.abs(diff).toLocaleString()} 安い ✓</span>`;
        } else {
          compareCell = `<span style="color:var(--text2)">同額</span>`;
        }
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="item-name">${this._e(item.name)}</div>
          <span class="item-cat">${this._e(item.category)}</span>
        </td>
        <td class="price-cell">
          ${orig}<span class="price-tag ${item.isMinOverall ? 'best' : d.isSale ? 'sale' : 'normal'}">¥${d.price.toLocaleString()}</span>${sale}
        </td>
        <td class="price-cell">
          ${otherMin !== null ? `<span class="price-tag normal">¥${otherMin.toLocaleString()}</span>` : '<span class="price-none">—</span>'}
        </td>
        <td class="price-cell">${compareCell}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  showSaveStatus(ok, msg) {
    const el = document.getElementById('saveStatus');
    el.className = `save-feedback ${ok ? 'success' : 'error'}`;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  },

  _e(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
};

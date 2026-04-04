// ===========================
// ui.js - UI管理
// ===========================

const UI = {
  selectedStores: new Set(),
  currentCategory: 'all',
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

    // 開閉
    document.getElementById('btnToggleSetup').addEventListener('click', () => {
      overlay.style.display = 'flex';
    });
    document.getElementById('drawerClose').addEventListener('click', () => {
      overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });

    // 保存
    document.getElementById('btnSaveConfig').addEventListener('click', () => {
      const gasUrl   = document.getElementById('gasUrl').value.trim();
      const sheetUrl = document.getElementById('sheetUrl').value.trim();
      Config.save({ gasUrl, sheetUrl });
      this.toast('設定を保存しました', 'success');
      overlay.style.display = 'none';
      // 価格履歴ボタン表示更新
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

      const openTag = store.openNow === true
        ? '<span class="store-tag open">営業中</span>'
        : store.openNow === false
          ? '<span class="store-tag closed">閉店中</span>'
          : '';
      const distTag = store.distance != null
        ? `<span class="store-tag">${store.distance < 1 ? Math.round(store.distance * 1000) + 'm' : store.distance.toFixed(1) + 'km'}</span>`
        : '';
      const ratingTag = store.rating
        ? `<span class="store-tag">★ ${store.rating}</span>` : '';

      card.innerHTML = `
        <div class="store-check">✓</div>
        <div class="store-name">${this._e(store.name)}</div>
        <div class="store-address">${this._e(store.address)}</div>
        <div class="store-tags">${distTag}${ratingTag}${openTag}</div>
      `;
      card.addEventListener('click', () => this._toggleStore(store.id, card));
      grid.appendChild(card);
    });

    // デフォルト全選択
    stores.forEach(s => {
      const card = grid.querySelector(`[data-id="${s.id}"]`);
      if (card) this._toggleStore(s.id, card);
    });
  },

  _toggleStore(id, card) {
    if (this.selectedStores.has(id)) {
      this.selectedStores.delete(id);
      card?.classList.remove('selected');
    } else {
      this.selectedStores.add(id);
      card?.classList.add('selected');
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
    document.getElementById('progressBar').style.width = `${Math.round(current / total * 100)}%`;
    document.getElementById('progressText').textContent = `${current} / ${total}`;
  },
  hideCollecting() {
    document.getElementById('collectingOverlay').style.display = 'none';
  },

  // ── 結果レンダリング ──
  renderResults(items, stores, collectedAt) {
    this.mergedItems = items;
    this.allStores   = stores;

    const section = document.getElementById('resultsSection');
    section.style.display = 'block';
    document.getElementById('resultDate').textContent =
      new Date(collectedAt).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });

    this._renderRanking(items, stores);
    this._renderTabs(items);
    this._renderTable(items, stores);
  },

  _renderRanking(items, stores) {
    const medals = ['🥇','🥈','🥉','🏅'];
    const scores = stores.map(s => {
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

  _renderTabs(items) {
    const cats = ['すべて', ...[...new Set(items.map(i => i.category))]];
    const el   = document.getElementById('categoryTabs');
    el.innerHTML = '';
    cats.forEach(cat => {
      const key   = cat === 'すべて' ? 'all' : cat;
      const count = cat === 'すべて' ? items.length : items.filter(i => i.category === cat).length;
      const btn   = document.createElement('button');
      btn.className = 'filter-tab' + (key === this.currentCategory ? ' active' : '');
      btn.textContent = `${cat} ${count}`;
      btn.addEventListener('click', () => {
        this.currentCategory = key;
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this._renderTable(this.mergedItems, this.allStores);
      });
      el.appendChild(btn);
    });
  },

  _renderTable(allItems, stores) {
    const items = this.currentCategory === 'all'
      ? allItems : allItems.filter(i => i.category === this.currentCategory);

    // ヘッダー
    const thead = document.getElementById('priceTableHead');
    thead.innerHTML = `<tr>
      <th class="sortable" data-col="name">商品名</th>
      ${stores.map(s => `<th class="sortable" data-col="store_${s.id}" style="text-align:right">${this._e(s.name)}</th>`).join('')}
      <th class="sortable" data-col="minPrice" style="text-align:right">最安値</th>
    </tr>`;
    thead.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        this.sortAsc = this.sortColumn === col ? !this.sortAsc : true;
        this.sortColumn = col;
        this._renderTable(allItems, stores);
      });
    });

    // ボディ
    const sorted = this._sort([...items], stores);
    const tbody  = document.getElementById('priceTableBody');
    tbody.innerHTML = '';

    sorted.forEach(item => {
      const tr = document.createElement('tr');
      const priceCells = stores.map(s => {
        const d = item.stores[s.id];
        if (!d) return `<td class="price-cell"><span class="price-none">—</span></td>`;
        const isBest = s.id === item.minStoreId;
        const orig   = d.originalPrice
          ? `<span style="text-decoration:line-through;font-size:11px;color:var(--text3);margin-right:3px">¥${d.originalPrice.toLocaleString()}</span>` : '';
        const sale   = d.isSale ? '<span class="sale-badge">SALE</span>' : '';
        return `<td class="price-cell">
          ${orig}<span class="price-tag ${isBest ? 'best' : d.isSale ? 'sale' : 'normal'}">¥${d.price.toLocaleString()}</span>${sale}
        </td>`;
      }).join('');

      tr.innerHTML = `
        <td>
          <div class="item-name">${this._e(item.name)}</div>
          <span class="item-cat">${this._e(item.category)}</span>
        </td>
        ${priceCells}
        <td class="price-cell">
          ${item.minPrice != null
            ? `<span class="price-tag best">¥${item.minPrice.toLocaleString()}</span>`
            : '<span class="price-none">—</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr><td colspan="99" style="text-align:center;padding:32px;color:var(--text3);font-size:14px">データがありません</td></tr>`;
    }
  },

  _sort(items, stores) {
    return items.sort((a, b) => {
      let av, bv;
      if      (this.sortColumn === 'name')     { av = a.name;     bv = b.name; }
      else if (this.sortColumn === 'minPrice') { av = a.minPrice ?? Infinity; bv = b.minPrice ?? Infinity; }
      else if (this.sortColumn.startsWith('store_')) {
        const sid = this.sortColumn.replace('store_', '');
        av = a.stores[sid]?.price ?? Infinity;
        bv = b.stores[sid]?.price ?? Infinity;
      }
      if (av < bv) return this.sortAsc ? -1 : 1;
      if (av > bv) return this.sortAsc ?  1 : -1;
      return 0;
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

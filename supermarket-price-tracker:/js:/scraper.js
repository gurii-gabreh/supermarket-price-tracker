// ===========================
// scraper.js - チラシ情報収集
// ===========================

const Scraper = {

  // GASにスクレイピングを依頼
  async fetchStorePrices(store) {
    const gasUrl = Config.get('gasUrl');
    if (!gasUrl) throw new Error('Google Apps Script URLが設定されていません');

    const params = new URLSearchParams({
      action: 'scrape',
      storeName: store.name,
      storeAddress: store.address,
      website: store.website || '',
      placeId: store.id,
    });

    const response = await fetch(`${gasUrl}?${params.toString()}`, {
      method: 'GET',
      mode: 'cors',
    });

    if (!response.ok) throw new Error(`GASリクエスト失敗: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.items || [];
  },

  // スプレッドシートに保存
  async saveToSheet(allPrices, stores, collectedAt) {
    const gasUrl = Config.get('gasUrl');
    if (!gasUrl) throw new Error('Google Apps Script URLが設定されていません');

    const payload = {
      action: 'save',
      collectedAt,
      stores: stores.map(s => ({ id: s.id, name: s.name, address: s.address })),
      items: allPrices,
    };

    const response = await fetch(gasUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`保存失敗: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  // デモ用サンプルデータ生成（GAS未設定時）
  generateDemoData(store) {
    const items = [
      { category: '野菜・果物', name: '国産キャベツ 1玉', unit: '1玉' },
      { category: '野菜・果物', name: 'にんじん 3本入り', unit: '袋' },
      { category: '野菜・果物', name: 'トマト 4個入り', unit: '袋' },
      { category: '野菜・果物', name: 'ほうれん草', unit: '束' },
      { category: '野菜・果物', name: 'バナナ', unit: '房' },
      { category: '肉・鶏', name: '鶏もも肉 300g', unit: '300g' },
      { category: '肉・鶏', name: '豚バラ 200g', unit: '200g' },
      { category: '肉・鶏', name: '牛こま切れ 200g', unit: '200g' },
      { category: '魚介類', name: '鮭切身 2切れ', unit: '2切れ' },
      { category: '魚介類', name: 'サバ缶 味噌煮', unit: '1缶' },
      { category: '乳製品・卵', name: '卵 10個入り', unit: '10個' },
      { category: '乳製品・卵', name: '牛乳 1L', unit: '1L' },
      { category: '乳製品・卵', name: 'ヨーグルト 400g', unit: '400g' },
      { category: 'パン・米', name: '食パン 6枚切り', unit: '1袋' },
      { category: 'パン・米', name: '白米 5kg', unit: '5kg' },
      { category: '飲料', name: 'お茶 2L', unit: '2L' },
      { category: '飲料', name: '炭酸水 500ml×6本', unit: '6本' },
      { category: '冷凍食品', name: '冷凍唐揚げ 500g', unit: '500g' },
      { category: '調味料', name: '醤油 1L', unit: '1L' },
      { category: '生活雑貨', name: 'トイレットペーパー 12ロール', unit: '12R' },
      { category: '生活雑貨', name: '洗濯洗剤 900g', unit: '900g' },
      { category: '生活雑貨', name: 'ティッシュ 5箱入り', unit: '5箱' },
    ];

    // ランダムに一部省略してリアルなチラシっぽくする
    const available = items.filter(() => Math.random() > 0.25);

    const basePrices = {
      '国産キャベツ 1玉': 198, 'にんじん 3本入り': 148, 'トマト 4個入り': 248,
      'ほうれん草': 98, 'バナナ': 148, '鶏もも肉 300g': 398, '豚バラ 200g': 348,
      '牛こま切れ 200g': 498, '鮭切身 2切れ': 298, 'サバ缶 味噌煮': 138,
      '卵 10個入り': 198, '牛乳 1L': 198, 'ヨーグルト 400g': 188,
      '食パン 6枚切り': 148, '白米 5kg': 1980, 'お茶 2L': 148,
      '炭酸水 500ml×6本': 398, '冷凍唐揚げ 500g': 498, '醤油 1L': 298,
      'トイレットペーパー 12ロール': 498, '洗濯洗剤 900g': 498, 'ティッシュ 5箱入り': 398,
    };

    return available.map(item => {
      const base = basePrices[item.name] || 200;
      const variance = (Math.random() - 0.5) * 0.4; // ±20%
      const price = Math.round(base * (1 + variance) / 10) * 10 - 1;
      const isSale = Math.random() < 0.3;
      return {
        ...item,
        price,
        originalPrice: isSale ? Math.round(price * 1.2 / 10) * 10 - 1 : null,
        isSale,
        storeId: store.id,
        storeName: store.name,
      };
    });
  },

  // 全店舗の価格データを商品名でマージ
  mergeAllPrices(storeResults) {
    const itemMap = new Map();

    storeResults.forEach(({ store, items }) => {
      items.forEach(item => {
        const key = item.name;
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            name: item.name,
            category: item.category,
            unit: item.unit,
            stores: {},
          });
        }
        itemMap.get(key).stores[store.id] = {
          price: item.price,
          originalPrice: item.originalPrice,
          isSale: item.isSale,
          storeName: store.name,
        };
      });
    });

    // 最安値を計算
    itemMap.forEach(item => {
      let minPrice = Infinity;
      let minStoreId = null;
      Object.entries(item.stores).forEach(([storeId, data]) => {
        if (data.price < minPrice) {
          minPrice = data.price;
          minStoreId = storeId;
        }
      });
      item.minPrice = minPrice === Infinity ? null : minPrice;
      item.minStoreId = minStoreId;
    });

    return Array.from(itemMap.values()).sort((a, b) => {
      const catOrder = ['野菜・果物', '肉・鶏', '魚介類', '乳製品・卵', 'パン・米', '飲料', '冷凍食品', '調味料', '生活雑貨'];
      const ai = catOrder.indexOf(a.category);
      const bi = catOrder.indexOf(b.category);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.name.localeCompare(b.name, 'ja');
    });
  },

  // カテゴリ一覧を取得
  getCategories(mergedItems) {
    const cats = [...new Set(mergedItems.map(i => i.category))];
    return cats;
  },

  // 最安値サマリーを取得（カテゴリ別最安値店）
  getBestDeals(mergedItems, stores) {
    const storeScores = {};
    stores.forEach(s => { storeScores[s.id] = { store: s, wins: 0, totalSavings: 0 }; });

    mergedItems.forEach(item => {
      if (item.minStoreId) {
        if (storeScores[item.minStoreId]) storeScores[item.minStoreId].wins++;
        // 節約額計算
        const prices = Object.values(item.stores).map(s => s.price);
        const maxPrice = Math.max(...prices);
        if (item.minStoreId && storeScores[item.minStoreId]) {
          storeScores[item.minStoreId].totalSavings += maxPrice - item.minPrice;
        }
      }
    });

    return Object.values(storeScores).sort((a, b) => b.wins - a.wins);
  }
};

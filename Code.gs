/**
 * ===================================================
 * チラシ価格トラッカー - Google Apps Script
 * ===================================================
 *
 * ▼▼▼ 設定箇所 ▼▼▼
 *
 * 【9行目】SPREADSHEET_ID
 *   GoogleスプレッドシートのIDを設定してください。
 *   スプレッドシートのURLの /d/〇〇〇/edit の〇〇〇部分です。
 *
 * 【10行目】GEMINI_API_KEY
 *   Google AI StudioのAPIキーを設定してください。
 *   https://aistudio.google.com/app/apikey で取得できます。
 *
 * 【11行目】GEMINI_MODEL
 *   使用するGeminiモデルを設定してください。
 *   現在: gemini-2.5-flash-lite（無料枠1000リクエスト/日）
 *
 * ▲▲▲ 設定箇所ここまで ▲▲▲
 *
 * ===================================================
 */
const SPREADSHEET_ID = '1VThcmRG6N-Ui-VmSzKdvLI8vOhfovWUqQsZb2rFJ3TY';
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // Google AI StudioのAPIキーに置き換えてください

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/'
                     + GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;

const SHEET_NAMES = { PRICES: '価格履歴', SUMMARY: 'サマリー', STORES: 'スーパー一覧' };

// ===================================================
// GETリクエスト処理
// ===================================================
function doGet(e) {
  var params = e.parameter;
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    if (params.action === 'findStores') {
      output.setContent(JSON.stringify(findNearbyStores(params.address)));
    } else if (params.action === 'scrape') {
      output.setContent(JSON.stringify(scrapeStorePrices(
        params.storeName, params.storeAddress, params.tokubaiUrl
      )));
    } else if (params.action === 'updateTriggers') {
      var times       = parseJsonSafe(params.scheduleTimes || '[]') || [];
      var autoCollect = params.autoCollect || 'OFF';
      output.setContent(JSON.stringify(updateScheduleTriggers(times, autoCollect)));
    } else if (params.action === 'getHistoryDates') {
      // 収集日一覧を取得
      output.setContent(JSON.stringify(getHistoryDates(params.storeName)));
    } else if (params.action === 'getHistoryData') {
      // 指定日・スーパーのデータを取得
      output.setContent(JSON.stringify(getHistoryData(params.storeName, params.date)));
    } else if (params.action === 'getRegisteredStoresFromSheet') {
      // スプレッドシートから登録スーパー一覧を取得
      output.setContent(JSON.stringify({ stores: getRegisteredStores() }));
    } else if (params.action === 'saveStores') {
      // スーパー一覧をスプレッドシートに保存
      var stores = parseJsonSafe(params.stores || '[]') || [];
      output.setContent(JSON.stringify(saveStoresToSheet(stores)));
    } else if (params.action === 'getFilterOptions') {
      // フィルター用住所・スーパー一覧を取得
      output.setContent(JSON.stringify(getFilterOptions()));
    } else if (params.action === 'saveAddresses') {
      // 住所を保存してトクバイでスーパーを自動取得
      var addresses = parseJsonSafe(params.addresses || '[]') || [];
      output.setContent(JSON.stringify(saveAddressesToSheet(addresses)));
    } else {
      output.setContent(JSON.stringify({ error: '不明なアクション: ' + params.action }));
    }
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    output.setContent(JSON.stringify({ error: err.message }));
  }
  return output;
}

// ===================================================
// POSTリクエスト処理
// ===================================================
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action === 'save') {
      output.setContent(JSON.stringify(
        savePricesToSheet(payload.items, payload.stores, payload.collectedAt)
      ));
    } else if (payload.action === 'saveStores') {
      output.setContent(JSON.stringify(
        saveStoresToSheet(payload.stores)
      ));
    } else if (payload.action === 'saveAddresses') {
      output.setContent(JSON.stringify(
        saveAddressesToSheet(payload.addresses)
      ));
    } else if (payload.action === 'saveSetting') {
      output.setContent(JSON.stringify(
        saveSettingToSheet(payload.key, payload.value)
      ));
    } else if (payload.action === 'updateTriggers') {
      output.setContent(JSON.stringify(
        updateScheduleTriggers(payload.scheduleTimes, payload.autoCollect)
      ));
    } else {
      output.setContent(JSON.stringify({ error: '不明なアクション' }));
    }
  } catch (err) {
    output.setContent(JSON.stringify({ error: err.message }));
  }
  return output;
}

// ===================================================
// ① トクバイで住所検索してスーパー一覧を取得
// ===================================================
function findNearbyStores(address) {
  if (!address) return { stores: [] };

  try {
    var allStores = [];
    var page      = 1;
    var maxPages  = 3; // 最大3ページ（60件）まで取得

    while (page <= maxPages) {
      var searchUrl = 'https://tokubai.co.jp/search?latitude=&longitude=&from=&bargain_keyword='
        + encodeURIComponent(address) + '&page=' + page;

      Logger.log('トクバイ検索: ' + searchUrl);

      var res = UrlFetchApp.fetch(searchUrl, {
        muteHttpExceptions: true,
        followRedirects:    true,
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control':   'no-cache',
          'Pragma':          'no-cache',
        },
      });

      Logger.log('トクバイ応答コード(' + page + 'ページ): ' + res.getResponseCode());
      if (res.getResponseCode() !== 200) break;

      var html   = res.getContentText('UTF-8');
      var stores = parseTokubaiSearchResults(html, address);
      Logger.log(page + 'ページ: ' + stores.length + '件取得');

      if (stores.length === 0) break; // これ以上ページがない

      allStores = allStores.concat(stores);
      page++;

      Utilities.sleep(500); // レート制限対策
    }

    Logger.log('合計取得店舗数: ' + allStores.length);

    if (allStores.length === 0) {
      return { stores: [], error: '該当するスーパーが見つかりませんでした' };
    }

    // 重複除去
    var seen      = {};
    var unique    = allStores.filter(function(s) {
      if (seen[s.id]) return false;
      seen[s.id] = true;
      return true;
    });

    return { stores: unique.slice(0, 50) };

  } catch (e) {
    Logger.log('findNearbyStores error: ' + e.message);
    return { stores: [], error: 'エラーが発生しました: ' + e.message };
  }
}

// ===================================================
// トクバイ検索結果HTMLから店舗一覧を抽出
// ===================================================
function parseTokubaiSearchResults(html, baseAddress) {
  var stores = [];

  // <li id='shop_数字ID'> ... </li> を1件ずつ抽出
  var liPattern = /<li id='shop_(\d+)'>([\s\S]*?)<\/li>/gi;
  var m;

  while ((m = liPattern.exec(html)) !== null) {
    var shopId   = m[1];
    var liHtml   = m[2];

    // href="/チェーン名/ID" を取得
    var hrefMatch = liHtml.match(/href="([^"]+)"/);
    if (!hrefMatch) continue;
    var path    = hrefMatch[1];
    var fullUrl = 'https://tokubai.co.jp' + path;

    // 店舗名を取得（shop_nameクラス）
    var nameMatch = liHtml.match(/class='shop_name'>\s*([\s\S]*?)<span/);
    if (!nameMatch) continue;
    var storeName = nameMatch[1].replace(/<[^>]+>/g, '').trim();
    if (storeName.length < 2) continue;

    // 住所を取得（shop_addressクラス）
    var addrMatch = liHtml.match(/class='shop_address'>\s*([^<]+)/);
    var address   = addrMatch ? addrMatch[1].trim() : baseAddress;

    Logger.log('店舗取得: ' + storeName + ' → ' + fullUrl + ' / ' + address);

    stores.push({
      id:         'tokubai_' + shopId,
      name:       storeName,
      address:    address,
      tokubaiUrl: fullUrl,
      distance:   null,
      rating:     null,
      openNow:    null,
    });
  }

  Logger.log('パース結果: ' + stores.length + '件');
  return stores;
}

// ===================================================
// トクバイURLを検証・修正
// ===================================================
function verifyAndFixTokubaiUrl(storeName, tokubaiUrl) {
  // URLがない場合は検索
  if (!tokubaiUrl) {
    return searchTokubaiUrl(storeName);
  }

  try {
    var res = UrlFetchApp.fetch(tokubaiUrl, {
      muteHttpExceptions: true,
      followRedirects:    true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ja',
      },
    });

    if (res.getResponseCode() !== 200) {
      Logger.log(storeName + ': URL無効(' + res.getResponseCode() + ')→再検索');
      return searchTokubaiUrl(storeName);
    }

    var html = res.getContentText('UTF-8');

    // ① 店舗名全体で確認（最優先）
    if (html.indexOf(storeName) !== -1) {
      Logger.log(storeName + ': URL検証OK（店舗名一致）');
      return tokubaiUrl;
    }

    // ② 店舗名から地名部分を抽出して確認
    // 例: 「ヤオコー 桐生境野店」→「桐生境野」
    var locationMatch = storeName.match(/[一-鿿぀-ゟ゠-ヿ]+(?:店|センター|マーケット)/);
    if (locationMatch && html.indexOf(locationMatch[0]) !== -1) {
      Logger.log(storeName + ': URL検証OK（店舗地名一致: ' + locationMatch[0] + '）');
      return tokubaiUrl;
    }

    // ③ 一致しなければ再検索
    Logger.log(storeName + ': 店舗名不一致→再検索');
    return searchTokubaiUrl(storeName);

  } catch (e) {
    Logger.log(storeName + ': URL検証エラー→再検索: ' + e.message);
    return searchTokubaiUrl(storeName);
  }
}

// ===================================================
// トクバイで店舗名を検索して正しいURLを取得（2段階検索）
// ===================================================
function searchTokubaiUrl(storeName) {
  try {
    // 店舗名を分解: 「ヤオコー 桐生境野店」→ chainName:「ヤオコー」 branchName:「桐生境野店」
    var parts      = storeName.trim().split(/\s+|　+/);
    var chainName  = parts[0];
    var branchName = parts.slice(1).join('');

    Logger.log(storeName + ': チェーン名=' + chainName + ' 店舗名=' + branchName);

    // ① チェーン名でトクバイ検索
    var searchUrl = 'https://tokubai.co.jp/search/stores?keyword=' + encodeURIComponent(chainName);
    var res = UrlFetchApp.fetch(searchUrl, {
      muteHttpExceptions: true,
      followRedirects:    true,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ja',
      },
    });

    if (res.getResponseCode() !== 200) {
      Logger.log(storeName + ': トクバイ検索失敗');
      return '';
    }

    var html = res.getContentText('UTF-8');

    // ② 店舗リンクと店舗名を抽出
    // トクバイの店舗リンクパターン: /チェーン名/数字ID
    var linkPattern = /href="(\/[^"\/]+\/(\d+))"[^>]*>([^<]*)</g;
    var m;
    var candidates  = [];

    while ((m = linkPattern.exec(html)) !== null) {
      var id       = parseInt(m[2]);
      var linkText = m[3].trim();
      if (id > 100 && linkText.length > 0) {
        candidates.push({
          url:  'https://tokubai.co.jp' + m[1],
          id:   id,
          text: linkText,
        });
      }
    }

    // 重複除去
    var seen = {};
    candidates = candidates.filter(function(c) {
      if (seen[c.url]) return false;
      seen[c.url] = true;
      return true;
    });

    Logger.log(storeName + ': 候補数=' + candidates.length);

    if (candidates.length === 0) {
      Logger.log(storeName + ': トクバイ検索結果なし');
      return '';
    }

    // ③ branchNameがある場合は店舗名で絞り込む
    if (branchName && branchName.length > 0) {
      // 完全一致を優先
      var exact = candidates.find(function(c) {
        return c.text.indexOf(branchName) !== -1 ||
               c.url.indexOf(encodeURIComponent(branchName)) !== -1;
      });
      if (exact) {
        Logger.log(storeName + ': 完全一致URL → ' + exact.url);
        return exact.url;
      }

      // 部分一致（地名の一部）で絞り込む
      // 例: 「桐生境野店」→「桐生」「境野」で検索
      var locationChars = branchName.replace(/[店センターマーケットフード]/g, '');
      var partial = candidates.find(function(c) {
        return c.text.indexOf(locationChars) !== -1 ||
               c.url.indexOf(encodeURIComponent(locationChars)) !== -1;
      });
      if (partial) {
        Logger.log(storeName + ': 部分一致URL → ' + partial.url);
        return partial.url;
      }
    }

    // ④ 絞り込めなければ先頭を返す
    Logger.log(storeName + ': 先頭URL → ' + candidates[0].url);
    return candidates[0].url;

  } catch (e) {
    Logger.log('searchTokubaiUrl error: ' + e.message);
    return '';
  }
}

// ===================================================
// ② トクバイからチラシ画像URL取得 → Geminiで解析
// ===================================================
function scrapeStorePrices(storeName, storeAddress, tokubaiUrl) {
  var searchLog = {
    storeName:   storeName,
    storeAddress: storeAddress,
    tokubaiUrl:  tokubaiUrl || '',
    searchedUrl: '',
    imageCount:  0,
    reason:      '',
  };

  try {
    Logger.log('チラシ収集開始: ' + storeName + ' / URL: ' + tokubaiUrl);

    // トクバイURLが不明な場合はGeminiで検索
    if (!tokubaiUrl) {
      tokubaiUrl = findTokubaiUrl(storeName, storeAddress);
      searchLog.tokubaiUrl  = tokubaiUrl;
      searchLog.searchedUrl = 'Gemini Groundingで検索: "' + storeName + ' ' + storeAddress + ' トクバイ"';
    } else {
      searchLog.searchedUrl = tokubaiUrl;
    }

    var chirashiResult = { imageUrls: [], chirashiUrl: '', reason: '' };
    if (tokubaiUrl) {
      chirashiResult   = getChirashiImageUrls(tokubaiUrl);
      searchLog.imageCount  = chirashiResult.imageUrls.length;
      searchLog.chirashiUrl = chirashiResult.chirashiUrl || tokubaiUrl;
      Logger.log('チラシ画像取得数: ' + chirashiResult.imageUrls.length);
    }

    if (chirashiResult.imageUrls.length === 0) {
      searchLog.reason = chirashiResult.reason ||
        (tokubaiUrl
          ? 'トクバイページにチラシ画像が見つかりませんでした'
          : 'トクバイURLが見つかりませんでした');
      Logger.log(storeName + ': ' + searchLog.reason);
      return { items: [], storeName: storeName, searchLog: searchLog };
    }

    // Geminiにチラシ画像を1枚ずつ送信して価格解析
    var items        = analyzeChirashiImages(chirashiResult.imageUrls, storeName);
    var successCount = items._successCount || 0;
    var totalCount   = items._totalCount   || chirashiResult.imageUrls.length;
    Logger.log(storeName + ': ' + items.length + '品目取得');

    if (items.length === 0) {
      searchLog.reason = 'チラシ画像の解析結果が0件でした（' + successCount + '/' + totalCount + '枚解析成功）';
      searchLog.incomplete = true;
    } else if (successCount < totalCount) {
      searchLog.reason     = successCount + '/' + totalCount + '枚のみ解析成功（残り' + (totalCount - successCount) + '枚は取得失敗）';
      searchLog.incomplete = true;
    }

    return { items: items, storeName: storeName, scrapedAt: new Date().toISOString(), searchLog: searchLog };

  } catch (e) {
    Logger.log('scrapeStorePrices error: ' + e.message);
    if (e.geminiError && e.info) {
      return { geminiError: true, errorInfo: e.info, items: [], storeName: storeName, searchLog: searchLog };
    }
    searchLog.reason = 'エラーが発生しました: ' + e.message;
    return { items: [], storeName: storeName, searchLog: searchLog };
  }
}

// ===================================================
// トクバイURLをGemini Groundingで検索
// ===================================================
function findTokubaiUrl(storeName, storeAddress) {
  try {
    var prompt =
      '「' + storeName + '」（' + storeAddress + '）のトクバイ店舗ページURLを教えてください。\n' +
      'トクバイ（tokubai.co.jp）で検索して、URLのみを返してください。\n' +
      'URLは https://tokubai.co.jp/店舗名/数字ID の形式です。\n' +
      '見つからない場合は空文字を返してください。\n' +
      'JSON形式: {"url": "https://tokubai.co.jp/..."}\n';

    var text   = callGeminiWithGrounding(prompt);
    var parsed = parseJsonSafe(text);
    var url    = parsed && parsed.url ? parsed.url : '';

    Logger.log(storeName + ' トクバイURL: ' + url);
    return url;

  } catch (e) {
    Logger.log('findTokubaiUrl error: ' + e.message);
    return '';
  }
}

// ===================================================
// トクバイ店舗ページから本日有効なチラシ画像URLを取得
// ===================================================
function getChirashiImageUrls(tokubaiUrl) {
  try {
    var res = UrlFetchApp.fetch(tokubaiUrl, {
      muteHttpExceptions: true,
      followRedirects:    true,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept':          'text/html,application/xhtml+xml',
      },
    });

    var code = res.getResponseCode();
    Logger.log('トクバイページ応答: ' + code + ' / URL: ' + tokubaiUrl);
    if (code !== 200) return { imageUrls: [], chirashiUrl: '', reason: 'ページ取得失敗: ' + code };

    var html     = res.getContentText('UTF-8');
    var now      = new Date();
    var jstNow   = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    var todayYear  = jstNow.getUTCFullYear();
    var todayMonth = jstNow.getUTCMonth() + 1;
    var todayDay   = jstNow.getUTCDate();

    Logger.log('本日: ' + todayYear + '/' + todayMonth + '/' + todayDay);

    // チラシブロックを抽出: href="/チェーン名/ID/leaflets/チラシID"
    var leafletPattern = /href="([^"]+\/leaflets\/(\d+))"/gi;
    var leafletIds     = [];
    var seen           = {};
    var m;

    while ((m = leafletPattern.exec(html)) !== null) {
      if (!seen[m[2]]) {
        seen[m[2]] = true;
        leafletIds.push({ url: 'https://tokubai.co.jp' + m[1], id: m[2] });
      }
    }

    Logger.log('チラシ数: ' + leafletIds.length);

    if (leafletIds.length === 0) {
      return { imageUrls: [], chirashiUrl: tokubaiUrl, reason: 'チラシが見つかりませんでした' };
    }

    // 各チラシページにアクセスして有効期間を確認
    var validLeaflets = [];

    leafletIds.forEach(function(leaflet) {
      var lRes = UrlFetchApp.fetch(leaflet.url, {
        muteHttpExceptions: true,
        followRedirects:    true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja' },
      });
      if (lRes.getResponseCode() !== 200) return;

      var lHtml = lRes.getContentText('UTF-8');

      // 有効期間を抽出: 「2026年5月29日〜6月11日までのチラシ」
      var periodMatch = lHtml.match(/(\d{4})年(\d+)月(\d+)日〜(\d+)月(\d+)日/);
      if (periodMatch) {
        var startYear  = parseInt(periodMatch[1]);
        var startMonth = parseInt(periodMatch[2]);
        var startDay   = parseInt(periodMatch[3]);
        var endMonth   = parseInt(periodMatch[4]);
        var endDay     = parseInt(periodMatch[5]);
        var endYear    = startYear;
        // 年をまたぐ場合（例: 12月〜1月）
        if (endMonth < startMonth) endYear++;

        var startDate = new Date(startYear, startMonth - 1, startDay);
        var endDate   = new Date(endYear,   endMonth   - 1, endDay);
        var today     = new Date(todayYear, todayMonth - 1, todayDay);

        Logger.log('チラシ ' + leaflet.id + ' 期間: ' + startMonth + '/' + startDay + '〜' + endMonth + '/' + endDay);

        if (today >= startDate && today <= endDate) {
          Logger.log('→ 本日有効');
          validLeaflets.push({ url: leaflet.url, html: lHtml });
        } else {
          Logger.log('→ 期間外');
        }
      } else {
        // 有効期間不明の場合は含める
        Logger.log('チラシ ' + leaflet.id + ': 有効期間不明 → 含める');
        validLeaflets.push({ url: leaflet.url, html: lHtml });
      }
    });

    Logger.log('本日有効チラシ数: ' + validLeaflets.length);

    if (validLeaflets.length === 0) {
      return { imageUrls: [], chirashiUrl: tokubaiUrl, reason: '本日有効なチラシがありません' };
    }

    // 有効チラシの画像URLを全て取得
    var imageUrls   = [];
    var seenImg     = {};
    var chirashiUrl = validLeaflets[0].url;

    validLeaflets.forEach(function(leaflet) {
      // JSONデータ内のhigh_resolution_image_urlを抽出
      var imgPattern = /high_resolution_image_url&quot;:&quot;(https:\/\/image\.tokubai\.co\.jp\/[^&]+)&quot;/g;
      var im;
      while ((im = imgPattern.exec(leaflet.html)) !== null) {
        var imgUrl = im[1];
        if (!seenImg[imgUrl]) {
          seenImg[imgUrl] = true;
          imageUrls.push(imgUrl);
          Logger.log('画像取得: ' + imgUrl.substring(0, 80));
        }
      }

      // data-srcも念のため確認
      var dataSrcPattern = /data-src="(https:\/\/image\.tokubai\.co\.jp\/images\/bargain_office_leaflets\/[^"]+)"/gi;
      while ((im = dataSrcPattern.exec(leaflet.html)) !== null) {
        var imgUrl = im[1];
        if (imgUrl.includes('w=100') || imgUrl.includes('h=137')) continue;
        imgUrl = imgUrl.replace(/w=\d+/, 'w=1200').replace(/aw=\d+/, 'aw=1200');
        if (!seenImg[imgUrl]) {
          seenImg[imgUrl] = true;
          imageUrls.push(imgUrl);
        }
      }
    });

    Logger.log('最終チラシ画像数: ' + imageUrls.length);
    return { imageUrls: imageUrls, chirashiUrl: chirashiUrl, reason: '' };

  } catch (e) {
    Logger.log('getChirashiImageUrls error: ' + e.message);
    return { imageUrls: [], chirashiUrl: '', reason: 'エラー: ' + e.message };
  }
}

// ===================================================
// Geminiにチラシ画像を1枚ずつ送信して価格解析（分割取得）
// ===================================================
function analyzeChirashiImages(imageUrls, storeName) {
  var allItems    = [];
  var successCount = 0;
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年MM月dd日');
  var collectedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");

  var prompt =
    '今日は' + today + 'です。\n\n' +
    'このスーパー「' + storeName + '」のチラシ画像から、\n' +
    '掲載されている【全ての商品】を漏れなく抽出してください。\n\n' +
    '【重要ルール】\n' +
    '1. 目玉商品だけでなく、チラシに載っている全商品を抽出してください\n' +
    '2. 今日（' + today + '）に該当しない日付限定商品は除外してください\n' +
    '3. priceは、チラシに印刷されている数字をそのまま使ってください。あなたが税込計算・割引計算などをして数値を作り出すことは絶対禁止です。税抜価格しか書かれていない場合は、その税抜価格の数字をそのまま使ってください（税込に換算しない）。price は必ず整数（小数点なし）で出力してください\n' +
    '4. 朝市・タイムセール等の時間限定商品も含めてください\n' +
    '5. itemNameは「ティッシュ」「鮭」「バナナ」「キャベツ」のような品目名を入れてください\n' +
    '6. detailは産地・内容量・枚数・切り身数・グラム等の詳細情報を入れてください\n' +
    '7. 同一商品・同一価格のものを重複して抽出しないでください（1商品につき1件）\n' +
    '8. itemName・name・detailの表記は以下のルールで統一してください：\n' +
    '   - 英数字は半角で統一する（全角数字・全角アルファベットは使わない）\n' +
    '   - 括弧やスラッシュ等の記号は半角で統一する（全角「（）」ではなく半角「()」）\n' +
    '   - 商品名の区切りに使う中点「・」やスペースの使い方を統一する\n\n' +
    '必ず以下のJSON形式のみで返してください。説明文は不要です。\n' +
    '{\n' +
    '  "items": [\n' +
    '    {\n' +
    '      "itemName": "ティッシュ",\n' +
    '      "name": "ティッシュペーパー 200組×5個パック",\n' +
    '      "detail": "200組×5個パック",\n' +
    '      "price": 338,\n' +
    '      "originalPrice": null,\n' +
    '      "isSale": false,\n' +
    '      "unit": "5個パック",\n' +
    '      "category": "生活雑貨",\n' +
    '      "validDate": "期間中"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'itemNameのルール:\n' +
    '- 野菜: キャベツ/にんじん/トマト/玉ねぎ/じゃがいも/大根/ほうれん草/ピーマン等\n' +
    '- 肉: 鶏もも/豚バラ/牛こま/ひき肉/ソーセージ/ハム等\n' +
    '- 魚: 鮭/サバ/まぐろ/えび/いか/あじ/さんま等\n' +
    '- 日用品: ティッシュ/トイレットペーパー/洗剤/シャンプー等\n' +
    'detailのルール:\n' +
    '- 食品: 産地（国産/チリ産等）+ 量/個数/グラム\n' +
    '- 日用品: 枚数/個数/容量\n' +
    'カテゴリ: 野菜, 果物, 肉・鶏, 魚介類, 乳製品, 卵, パン, 米, 飲料, 冷凍食品, 調味料, 生活雑貨, その他\n' +
    '元値なし→originalPrice:null、有効期限なし→validDate:"期間中"\n' +
    'storeName: 必ず「' + storeName + '」をそのまま入力してください。省略・変更禁止。';

  // 1枚ずつ送信
  imageUrls.forEach(function(url, idx) {
    try {
      Logger.log('画像' + (idx + 1) + '/' + imageUrls.length + '枚目を解析: ' + url.substring(0, 60));

      // 画像をBase64に変換
      var imgRes = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (imgRes.getResponseCode() !== 200) {
        Logger.log('画像取得失敗: ' + url);
        return;
      }

      var blob     = imgRes.getBlob();
      var base64   = Utilities.base64Encode(blob.getBytes());
      var mimeType = blob.getContentType() || 'image/jpeg';
      Logger.log('画像取得成功: ' + url.substring(0, 60));

      var payload = {
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: base64 } },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
      };

      var res = UrlFetchApp.fetch(GEMINI_API_URL, {
        method:             'post',
        contentType:        'application/json',
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      Logger.log('Gemini応答(' + (idx + 1) + '枚目): ' + res.getResponseCode());

      if (res.getResponseCode() !== 200) {
        var errInfo = makeGeminiError(res.getResponseCode(), res.getContentText());
        Logger.log('Geminiエラー(' + (idx + 1) + '枚目): ' + errInfo.message);
        return; // この枚は失敗、次へ
      }

      var data = JSON.parse(res.getContentText());
      if (!data.candidates || data.candidates.length === 0) return;

      var text = '';
      data.candidates[0].content.parts.forEach(function(p) { if (p.text) text += p.text; });

      var parsed = parseJsonSafe(text);
      if (!parsed || !parsed.items) return;

      var items = parsed.items.map(function(item) {
        return {
          itemName:      String(item.itemName      || item.name || '').trim(),
          name:          String(item.name          || '').trim(),
          detail:        String(item.detail        || '').trim(),
          price:         Number(item.price) || 0,
          originalPrice: item.originalPrice ? parseInt(item.originalPrice) : null,
          isSale:        !!item.isSale,
          unit:          String(item.unit           || ''),
          category:      String(item.category       || 'その他'),
          validDate:     String(item.validDate      || '期間中'),
          storeName:     storeName,
        };
      }).filter(function(item) {
        // 小数点のある価格（Geminiが税込計算等で作り出した疑いのある値）は除外する
        if (item.price > 0 && !Number.isInteger(item.price)) {
          Logger.log('価格に小数点があるため除外: ' + item.name + ' ¥' + item.price);
          return false;
        }
        return item.price > 0 && item.name.length > 0;
      });

      Logger.log('(' + (idx + 1) + '枚目) ' + items.length + '品目取得');
      allItems = allItems.concat(items);
      successCount++;

      // レート制限対策: gemini-2.5-flash無料枠10RPM対応（1分1リクエスト）
      Utilities.sleep(60000);

    } catch (e) {
      Logger.log('画像' + (idx + 1) + '枚目エラー: ' + e.message);
    }
  });

  Logger.log(storeName + ': 合計' + allItems.length + '品目取得（' + successCount + '/' + imageUrls.length + '枚成功）');

  // 部分取得の場合はsearchLogに記録するためにメタ情報を付与
  allItems._successCount  = successCount;
  allItems._totalCount    = imageUrls.length;

  return allItems;
}

// ===================================================
// Geminiエラー情報を生成
// ===================================================
function makeGeminiError(code, resText) {
  var now       = new Date();
  var jstOffset = 9 * 60 * 60 * 1000;
  var jst       = new Date(now.getTime() + jstOffset);

  // リトライ時間を計算
  var retryAfter = '';
  try {
    var body = JSON.parse(resText);
    // retryDelayが含まれている場合は取得
    if (body.error && body.error.details) {
      body.error.details.forEach(function(d) {
        if (d.retryDelay) {
          var sec = parseInt(d.retryDelay.replace('s',''));
          var retryTime = new Date(now.getTime() + sec * 1000 + jstOffset);
          retryAfter = retryTime.getHours() + '時' + ('0'+retryTime.getMinutes()).slice(-2) + '分頃';
        }
      });
    }
  } catch(e) {}

  if (code === 429) {
    // 翌日0時にリセット
    var tomorrow = new Date(jst);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    var resetTime = tomorrow.getHours() + '時' + ('0'+tomorrow.getMinutes()).slice(-2) + '分';
    return {
      geminiError: true,
      errorCode:   429,
      errorType:   'quota',
      message:     '1日のリクエスト上限に達しました。明日の午前0時にリセットされます。',
      retryAt:     '明日 ' + resetTime + '以降',
    };
  } else if (code === 503) {
    var retry = retryAfter || '数分後';
    return {
      geminiError: true,
      errorCode:   503,
      errorType:   'busy',
      message:     'Geminiサーバーが混雑しています。しばらく待ってから再試行してください。',
      retryAt:     retry,
    };
  } else {
    return {
      geminiError: true,
      errorCode:   code,
      errorType:   'unknown',
      message:     'Gemini APIエラーが発生しました（コード: ' + code + '）',
      retryAt:     '数分後',
    };
  }
}

// ===================================================
// Gemini API呼び出し（Grounding有効）
// ===================================================
function callGeminiWithGrounding(prompt) {
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };

  var res = UrlFetchApp.fetch(GEMINI_API_URL, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code    = res.getResponseCode();
  var resText = res.getContentText();
  Logger.log('Gemini Grounding応答コード: ' + code);

  if (code !== 200) {
    Logger.log('Gemini APIエラー: ' + resText.substring(0, 300));
    var errInfo = makeGeminiError(code, resText);
    throw { geminiError: true, info: errInfo, message: errInfo.message };
  }

  var data  = JSON.parse(resText);
  var parts = data.candidates[0].content.parts;
  var text  = '';
  parts.forEach(function(p) { if (p.text) text += p.text; });
  return text;
}

// ===================================================
// JSON安全パース（MAX_TOKENSで途中切れにも対応）
// ===================================================
function parseJsonSafe(text) {
  try {
    var clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    var start = clean.indexOf('{');
    var end   = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.substring(start, end + 1);
    return JSON.parse(clean);
  } catch (e) {
    // MAX_TOKENSで途中切れの場合、itemsの配列を部分的に救済
    try {
      var itemsStart = text.indexOf('"items"');
      if (itemsStart === -1) return null;
      var arrStart = text.indexOf('[', itemsStart);
      if (arrStart === -1) return null;

      // 完結しているオブジェクト（}で終わるもの）だけを抽出
      var items  = [];
      var depth  = 0;
      var objStart = -1;
      for (var i = arrStart; i < text.length; i++) {
        var c = text[i];
        if (c === '{') {
          if (depth === 0) objStart = i;
          depth++;
        } else if (c === '}') {
          depth--;
          if (depth === 0 && objStart !== -1) {
            try {
              var obj = JSON.parse(text.substring(objStart, i + 1));
              items.push(obj);
            } catch(e2) {}
            objStart = -1;
          }
        }
      }

      if (items.length > 0) {
        Logger.log('部分パース成功: ' + items.length + '件');
        return { items: items };
      }
    } catch(e3) {}

    Logger.log('JSON parse error: ' + e.message);
    return null;
  }
}

// ===================================================
// 重複判定用：商品名・スーパー名の表記ゆれを吸収する正規化
// ===================================================
function _normalizeForDedup(s) {
  return String(s || '')
    .normalize('NFKC')            // 全角英数字・全角記号・全角スペース等を半角に統一
    .replace(/[ー－―‐−]/g, '-')   // 長音記号・各種ダッシュをハイフンに統一
    .replace(/[・･]/g, '')        // 中点（・）を除去
    .replace(/\s+/g, '')          // 残りの空白を除去
    .toLowerCase();
}

// ===================================================
// 重複判定用：収集日時から「日付(YYYY-MM-DD)」だけを取り出す
//
// 収集日時(収集日時列)には秒単位のタイムスタンプが入っており、
// 収集を実行するたびに毎回異なる値になる。この値をそのまま重複判定
// キーに使うと「同じ商品・同じスーパー・同じ価格」でも時刻が違うだけで
// 別レコード扱いになり、自動収集のたびに重複登録されてしまう。
// そのため重複判定では日付単位まで丸めて比較する。
// シートから読み戻した値はGoogle Sheetsによって自動的にDate型へ
// 変換されている場合があるため、Date型・文字列どちらも扱う。
// ===================================================
function _extractDateOnly(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var s = String(value || '');
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/) || s.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return s;
}

// ===================================================
// レーベンシュタイン距離（2つの文字列がどれくらい違うか）
// ===================================================
function _levenshtein(a, b) {
  a = String(a || '');
  b = String(b || '');
  var m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  var dp = [];
  for (var i = 0; i <= m; i++) { dp.push([i]); }
  for (var j = 0; j <= n; j++) { dp[0][j] = j; }

  for (i = 1; i <= m; i++) {
    for (j = 1; j <= n; j++) {
      var cost = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 削除
        dp[i][j - 1] + 1,      // 挿入
        dp[i - 1][j - 1] + cost // 置換
      );
    }
  }
  return dp[m][n];
}

// 商品名の表記ゆれ許容範囲（この文字数までの違いは「同じ商品」とみなす）
var SIMILAR_NAME_MAX_DISTANCE = 3;

// 同じスーパー・同じ品目の中で、既に登録されている商品名に近ければその表記へ揃える
// canonicalMap は { "スーパー名|品目名": [{original, normalized}, ...] } を保持し、
// 呼び出しをまたいで使い回すことで、同一バッチ内の表記ゆれも統一する
function _alignToExistingName(name, storeName, itemName, canonicalMap) {
  var groupKey = _normalizeForDedup(storeName) + '|' + _normalizeForDedup(itemName);
  if (!canonicalMap[groupKey]) canonicalMap[groupKey] = [];
  var candidates = canonicalMap[groupKey];

  var normName = _normalizeForDedup(name);
  var best = null;
  var bestDist = Infinity;
  candidates.forEach(function(c) {
    var dist = _levenshtein(normName, c.normalized);
    if (dist < bestDist) { bestDist = dist; best = c; }
  });

  if (best && bestDist <= SIMILAR_NAME_MAX_DISTANCE) {
    return best.original; // 既存の表記に揃える
  }
  // 近いものがなければ、この商品名を新しい基準として登録
  candidates.push({ original: name, normalized: normName });
  return name;
}

// ===================================================
// スプレッドシートに価格を保存
// ===================================================
function savePricesToSheet(items, stores, collectedAt) {
  // 同時実行（二重クリック・リトライ等）によるレース重複を防ぐため、
  // 読み込み～書き込みの間はスクリプトロックで排他する
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName(SHEET_NAMES.PRICES);

    if (!priceSheet) {
      priceSheet = ss.insertSheet(SHEET_NAMES.PRICES);
      priceSheet.getRange(1, 1, 1, 10).setValues([[
        '収集日時', '品目名', '商品名', 'カテゴリ', '単位', 'スーパー名', '価格(税込)', '元値', '特売', '有効期限'
      ]]);
      priceSheet.getRange(1, 1, 1, 10)
        .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
      priceSheet.setFrozenRows(1);
    }

    var rows = [];

    // autoCollect経由（フラットなitemsの配列）
    if (items.length > 0 && items[0].storeName !== undefined && items[0].price !== undefined) {
      items.forEach(function(item) {
        rows.push([
          collectedAt,
          item.itemName  || '',
          item.name      || item.itemName || '',
          item.category  || 'その他',
          item.unit      || item.detail   || '',
          item.storeName || '',
          item.price     || 0,
          item.originalPrice || '',
          item.isSale ? 'YES' : '',
          item.validDate || '期間中',
        ]);
      });
    } else {
      // フロントから渡される品目グループ形式（item.stores が配列）
      items.forEach(function(item) {
        if (!item.stores) return;
        stores.forEach(function(store) {
          var products = item.stores[store.id];
          if (!products) return;
          // 配列の場合
          if (Array.isArray(products)) {
            products.forEach(function(p) {
              rows.push([
                collectedAt,
                item.itemName || '',
                p.name      || item.itemName || '',
                item.category || 'その他',
                p.unit      || p.detail || '',
                store.name,
                p.price     || 0,
                p.originalPrice || '',
                p.isSale ? 'YES' : '',
                p.validDate || '期間中',
              ]);
            });
          } else {
            // 旧形式（オブジェクト直接）
            rows.push([
              collectedAt,
              item.itemName || '',
              item.name || item.itemName || '',
              item.category || 'その他',
              item.unit || '',
              store.name,
              products.price || 0,
              products.originalPrice || '',
              products.isSale ? 'YES' : '',
              products.validDate || '期間中',
            ]);
          }
        });
      });
    }

    // ── 既存データを1回だけ読み込み、類似名寄せ・重複除去の両方に使う ──
    var canonicalMap = {};
    var existingKeys = {};
    if (priceSheet.getLastRow() > 1) {
      var existingData = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 7).getValues();
      var seenNames = {};
      existingData.forEach(function(r) {
        // 重複除去キー(収集日・商品名・スーパー名・価格)
        // 収集「日時」の秒単位までは見ず、日付単位に丸めて比較する
        // （そうしないと同じ日に何度収集しても毎回別レコード扱いになる）
        var dedupKey = _extractDateOnly(r[0]) + '|' + _normalizeForDedup(r[2]) + '|' + _normalizeForDedup(r[5]) + '|' + String(r[6]);
        existingKeys[dedupKey] = true;

        // 類似名寄せの候補（スーパー名・品目名でグループ化）
        var groupKey = _normalizeForDedup(r[5]) + '|' + _normalizeForDedup(r[1]);
        var normName = _normalizeForDedup(r[2]);
        var seenKey  = groupKey + '::' + normName;
        if (seenNames[seenKey]) return; // 同じ表記は1回だけ候補として登録
        seenNames[seenKey] = true;
        if (!canonicalMap[groupKey]) canonicalMap[groupKey] = [];
        canonicalMap[groupKey].push({ original: r[2], normalized: normName });
      });
    }

    // 類似名寄せ：新規行の商品名を、既存（またはバッチ内で先に出た）表記に揃える
    rows.forEach(function(row) {
      row[2] = _alignToExistingName(row[2], row[5], row[1], canonicalMap);
    });

    // ── 重複除去（収集日・商品名・スーパー名・価格が一致する行はスキップ） ──
    // 商品名・スーパー名は全角/半角や記号の表記ゆれを吸収した上で比較する
    var uniqueRows = [];
    var batchKeys  = {};
    var skippedCount = 0;
    rows.forEach(function(row) {
      var key = _extractDateOnly(row[0]) + '|' + _normalizeForDedup(row[2]) + '|' + _normalizeForDedup(row[5]) + '|' + String(row[6]);
      if (existingKeys[key] || batchKeys[key]) {
        skippedCount++;
        return;
      }
      batchKeys[key] = true;
      uniqueRows.push(row);
    });
    rows = uniqueRows;

    if (rows.length > 0) {
      var lastRow = priceSheet.getLastRow();
      priceSheet.getRange(lastRow + 1, 1, rows.length, 10).setValues(rows);
    }

    var sumSheet = ss.getSheetByName(SHEET_NAMES.SUMMARY) || ss.insertSheet(SHEET_NAMES.SUMMARY);
    sumSheet.clearContents();
    sumSheet.getRange(1, 1, 4, 2).setValues([
      ['収集日時', collectedAt],
      ['対象スーパー数', stores.length],
      ['収集商品数', rows.length],
      ['重複除外数', skippedCount],
    ]);

    return { success: true, rowsAdded: rows.length, duplicatesSkipped: skippedCount, sheetUrl: ss.getUrl() };

  } finally {
    lock.releaseLock();
  }
}

// ===================================================
// スーパー一覧をスプレッドシートに保存
// ===================================================
function saveStoresToSheet(stores) {
  var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  var storeSheet = ss.getSheetByName(SHEET_NAMES.STORES);

  if (!storeSheet) {
    storeSheet = ss.insertSheet(SHEET_NAMES.STORES);
    storeSheet.getRange(1, 1, 1, 4).setValues([['店舗名', '住所', 'トクバイURL', '登録日']]);
    storeSheet.getRange(1, 1, 1, 4)
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    storeSheet.setFrozenRows(1);
  }

  // 全データを上書き
  storeSheet.getRange(2, 1, Math.max(storeSheet.getLastRow(), 2), 4).clearContent();
  if (stores.length > 0) {
    var rows = stores.map(function(s) {
      return [s.name, s.address || '', s.tokubaiUrl || '',
              Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd')];
    });
    storeSheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  return { success: true };
}

// ===================================================
// 住所をシートに保存 + トクバイでスーパーを自動取得
// ===================================================
function saveAddressesToSheet(addresses) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // 設定シートに住所を保存
    saveSettingToSheet('registeredAddresses', JSON.stringify(addresses));

    // 全住所のスーパーを取得してスーパー一覧シートに保存
    var allStores = [];
    addresses.forEach(function(address) {
      if (!address) return;
      Logger.log('住所検索: ' + address);
      var result = findNearbyStores(address);
      var stores = result.stores || [];
      Logger.log(address + ': ' + stores.length + '件取得');
      stores.forEach(function(store) {
        if (!allStores.some(function(s) { return s.name === store.name; })) {
          allStores.push(store);
        }
      });
    });

    Logger.log('合計スーパー数: ' + allStores.length);

    // スーパー一覧シートに保存
    if (allStores.length > 0) {
      saveStoresToSheet(allStores);
    }

    return { success: true, storeCount: allStores.length };
  } catch(e) {
    Logger.log('saveAddressesToSheet error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===================================================
// チラシ更新日チェック（Gemini API不使用）
// ===================================================
function checkChirashiUpdates() {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var storeSheet = ss.getSheetByName(SHEET_NAMES.STORES);
    if (!storeSheet || storeSheet.getLastRow() < 2) {
      Logger.log('スーパー一覧なし');
      return;
    }

    var stores = storeSheet.getRange(2, 1, storeSheet.getLastRow() - 1, 3).getValues();

    // チラシ更新日シートを準備
    var logSheet = ss.getSheetByName('チラシ更新日');
    if (!logSheet) {
      logSheet = ss.insertSheet('チラシ更新日');
      logSheet.getRange(1, 1, 1, 5).setValues([['店舗名', 'トクバイURL', '前回更新日', '今回更新日', '更新有無']]);
      logSheet.setFrozenRows(1);
    }

    var headers = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'ja,en;q=0.9',
    };

    var today    = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-M-d');
    var logData  = logSheet.getLastRow() > 1
      ? logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 5).getValues()
      : [];

    // 前回の更新日を店舗名をキーにしたマップに変換
    var prevDates = {};
    logData.forEach(function(row) {
      if (row[0]) prevDates[row[0]] = row[3] || row[2] || '';
    });

    var updatedStores = [];

    stores.forEach(function(row) {
      var storeName  = String(row[0] || '');
      var tokubaiUrl = String(row[2] || '');
      if (!storeName || !tokubaiUrl) return;

      try {
        var res  = UrlFetchApp.fetch(tokubaiUrl, { muteHttpExceptions: true, headers: headers });
        if (res.getResponseCode() !== 200) return;
        var html = res.getContentText('UTF-8');

        // チラシ更新日を抽出
        var dateMatch = html.match(/(\d{4})年(\d+)月(\d+)日/);
        var updateDate = dateMatch
          ? dateMatch[1] + '-' + parseInt(dateMatch[2]) + '-' + parseInt(dateMatch[3])
          : '';

        var prevDate  = prevDates[storeName] || '';
        var isUpdated = updateDate && updateDate !== prevDate;

        Logger.log(storeName + ': 前回=' + prevDate + ' 今回=' + updateDate + ' 更新=' + isUpdated);

        // ログに記録
        logSheet.appendRow([storeName, tokubaiUrl, prevDate, updateDate, isUpdated ? '更新あり' : '変更なし']);

        if (isUpdated) {
          updatedStores.push({ name: storeName, tokubaiUrl: tokubaiUrl });
        }

        Utilities.sleep(500);
      } catch(e) {
        Logger.log(storeName + ' エラー: ' + e.message);
      }
    });

    Logger.log('更新あり店舗数: ' + updatedStores.length);
    return { updated: updatedStores };

  } catch(e) {
    Logger.log('checkChirashiUpdates error: ' + e.message);
    return { updated: [] };
  }
}

// ===================================================
// 設定シートに保存
// ===================================================
function saveSettingToSheet(key, value) {
  var ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
  var setSheet  = ss.getSheetByName('設定');

  if (!setSheet) {
    setSheet = ss.insertSheet('設定');
    setSheet.getRange(1, 1, 1, 2).setValues([['キー', '値']]);
    setSheet.getRange(1, 1, 1, 2)
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    setSheet.setFrozenRows(1);
  }

  // 既存のキーを検索して更新、なければ追加
  var data    = setSheet.getDataRange().getValues();
  var updated = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      setSheet.getRange(i + 1, 2).setValue(value);
      updated = true;
      break;
    }
  }
  if (!updated) {
    var lastRow = setSheet.getLastRow();
    setSheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
  }

  return { success: true };
}

// ===================================================
// フィルター用住所・スーパー一覧を取得
// ===================================================
function getFilterOptions() {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName(SHEET_NAMES.PRICES);
    var storeSheet = ss.getSheetByName(SHEET_NAMES.STORES);

    // 価格履歴からデータがあるスーパー名を取得（表記ゆれ吸収のため正規化キーで保持）
    var storeNamesWithData = {};
    if (priceSheet && priceSheet.getLastRow() >= 2) {
      var priceData = priceSheet.getRange(2, 6, priceSheet.getLastRow() - 1, 1).getValues();
      priceData.forEach(function(row) {
        if (row[0]) storeNamesWithData[_normalizeForDedup(row[0])] = true;
      });
    }

    // スーパー一覧から住所とスーパー名を取得
    var addressMap = {}; // 住所 → [スーパー名]
    var allStores  = [];

    if (storeSheet && storeSheet.getLastRow() >= 2) {
      var storeData = storeSheet.getRange(2, 1, storeSheet.getLastRow() - 1, 3).getValues();
      storeData.forEach(function(row) {
        var name    = String(row[0] || '').trim();
        var address = String(row[1] || '').trim();
        if (!name) return;

        // データがあるスーパーのみ（表記ゆれを吸収した上で照合）
        if (!storeNamesWithData[_normalizeForDedup(name)]) return;

        // 住所から市区町村レベルを抽出
        var cityMatch = address.match(/(.+?[都道府県])(.+?[市区町村])/);
        var city      = cityMatch ? cityMatch[1] + cityMatch[2] : address;

        if (!addressMap[city]) addressMap[city] = [];
        if (!addressMap[city].includes(name)) addressMap[city].push(name);

        if (!allStores.includes(name)) allStores.push(name);
      });
    }

    return {
      addresses: Object.keys(addressMap).sort(),
      addressMap: addressMap,
      allStores:  allStores.sort(),
    };

  } catch (e) {
    Logger.log('getFilterOptions error: ' + e.message);
    return { addresses: [], addressMap: {}, allStores: [] };
  }
}
function getHistoryDates(storeName) {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName(SHEET_NAMES.PRICES);
    if (!priceSheet || priceSheet.getLastRow() < 2) return { dates: [] };

    var data  = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 6).getValues();
    var dates = {};

    data.forEach(function(row) {
      var rawDate  = row[0];
      var dateStr  = '';
      if (rawDate) {
        var s = String(rawDate);
        var match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          var y = parseInt(match[1]);
          var m = parseInt(match[2]);
          var d = parseInt(match[3]);
          dateStr = y + '-' + m + '-' + d;
        }
      }
      var store = String(row[5] || '');
      if (!dateStr) return;
      if (storeName && store !== storeName) return;
      dates[dateStr] = true;
    });

    var dateList = Object.keys(dates).sort().reverse();
    return { dates: dateList };

  } catch (e) {
    Logger.log('getHistoryDates error: ' + e.message);
    return { dates: [] };
  }
}

// ===================================================
// 指定日・スーパーの価格データを取得
// ===================================================
function getHistoryData(storeName, date) {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName(SHEET_NAMES.PRICES);
    if (!priceSheet || priceSheet.getLastRow() < 2) return { items: [] };

    // 登録住所に紐づく全スーパーを取得
    var registeredStores = getRegisteredStores().map(function(s) { return s.name; });

    var data  = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 10).getValues();
    var items = [];

    data.forEach(function(row) {
      var rawDate  = row[0];
      var rowDate  = '';
      if (rawDate) {
        var dateStr = String(rawDate);
        var match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          rowDate = parseInt(match[1]) + '-' + parseInt(match[2]) + '-' + parseInt(match[3]);
        }
      }
      var rowStore = String(row[5] || '');

      if (date && rowDate !== date) return;
      if (storeName && rowStore !== storeName) return;
      // 登録スーパーのデータのみ返す
      if (registeredStores.length > 0 && registeredStores.indexOf(rowStore) === -1) return;
      if (!row[2]) return;

      items.push({
        itemName:      String(row[1] || ''),
        name:          String(row[2] || ''),
        category:      String(row[3] || 'その他'),
        unit:          String(row[4] || ''),
        storeName:     rowStore,
        price:         parseInt(row[6]) || 0,
        originalPrice: row[7] ? parseInt(row[7]) : null,
        isSale:        row[8] === 'YES',
        validDate:     String(row[9] || '期間中'),
        detail:        String(row[4] || ''),
        collectedAt:   String(row[0] || ''),
      });
    });

    var storeNames = [...new Set(items.map(function(i) { return i.storeName; }))];
    return { items: items, stores: storeNames, date: date };

  } catch (e) {
    Logger.log('getHistoryData error: ' + e.message);
    return { items: [], stores: [] };
  }
}

// ===================================================
// スプレッドシートから収集済みスーパー名一覧を取得
// ===================================================
function getCollectedStoreNames() {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName(SHEET_NAMES.PRICES);
    if (!priceSheet || priceSheet.getLastRow() < 2) return { stores: [] };

    var data   = priceSheet.getRange(2, 5, priceSheet.getLastRow() - 1, 1).getValues();
    var stores = {};
    data.forEach(function(row) { if (row[0]) stores[row[0]] = true; });
    return { stores: Object.keys(stores).sort() };

  } catch (e) {
    return { stores: [] };
  }
}
function getRegisteredStores() {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var storeSheet = ss.getSheetByName(SHEET_NAMES.STORES);
    if (!storeSheet || storeSheet.getLastRow() < 2) return [];

    var data   = storeSheet.getRange(2, 1, storeSheet.getLastRow() - 1, 4).getValues();
    var stores = [];
    data.forEach(function(row, i) {
      if (row[0]) {
        stores.push({
          id:         'reg_' + i,
          name:       row[0],
          address:    row[1] || '',
          tokubaiUrl: row[2] || '',
        });
      }
    });
    return stores;
  } catch (e) {
    Logger.log('getRegisteredStores error: ' + e.message);
    return [];
  }
}

// ===================================================
// 設定シートから値を取得
// ===================================================
function getSetting(key) {
  try {
    var ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
    var setSheet = ss.getSheetByName('設定');
    if (!setSheet) return null;

    var data = setSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) return data[i][1];
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ===================================================
// 毎朝10時の自動実行（GASトリガーで実行）
// ① チラシ更新日チェック → ② 更新店舗のみ収集 → ③ 平均価格集計
// ===================================================
function autoCollect() {
  var autoOn = getSetting('autoCollect');
  if (autoOn !== 'ON') {
    Logger.log('自動収集はOFFです。スキップします。');
    return;
  }

  Logger.log('=== 自動収集開始 ===');

  // ① チラシ更新日チェック
  Logger.log('① チラシ更新日チェック開始');
  var updateResult = checkChirashiUpdates();
  var updatedStores = updateResult.updated || [];
  Logger.log('更新あり店舗: ' + updatedStores.length + '件');

  if (updatedStores.length === 0) {
    Logger.log('更新された店舗がないため収集をスキップします');
    return;
  }

  // ② 更新があった店舗のみ価格データを収集ログに記録
  // ※実際の価格取得はPythonスクリプトが担当
  // GASからPythonを直接起動できないため、収集待ちリストをシートに記録
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var pendingSheet = ss.getSheetByName('収集待ちリスト');
  if (!pendingSheet) {
    pendingSheet = ss.insertSheet('収集待ちリスト');
    pendingSheet.getRange(1, 1, 1, 3).setValues([['店舗名', 'トクバイURL', '登録日時']]);
    pendingSheet.setFrozenRows(1);
  }

  // 収集待ちリストをクリアして更新店舗を登録
  if (pendingSheet.getLastRow() > 1) {
    pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, 3).clearContent();
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var pendingRows = updatedStores.map(function(store) {
    return [store.name, store.tokubaiUrl, now];
  });
  pendingSheet.getRange(2, 1, pendingRows.length, 3).setValues(pendingRows);
  Logger.log('収集待ちリストに' + pendingRows.length + '件登録しました');

  // ③ 平均価格集計
  Logger.log('③ 平均価格集計開始');
  calcAveragePrices();

  Logger.log('=== 自動実行完了 ===');
}

// ===================================================
// 平均価格集計（住所ごと・品目ごと）
// ===================================================
function calcAveragePrices() {
  try {
    var ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
    var priceSheet = ss.getSheetByName('価格履歴');
    if (!priceSheet || priceSheet.getLastRow() < 2) return;

    var data = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 10).getValues();

    // 住所ごとのスーパーマッピングを取得
    var filterOptions = getFilterOptions();
    var addressMap    = filterOptions.addressMap || {};

    // 品目・住所ごとに価格を集計
    var stats = {}; // { '住所|品目': [price1, price2, ...] }

    data.forEach(function(row) {
      var itemName  = String(row[1] || '');
      var storeName = String(row[5] || '');
      var price     = parseInt(row[6]) || 0;
      if (!itemName || !storeName || !price) return;

      // どの住所に属するか判定
      Object.keys(addressMap).forEach(function(address) {
        if (addressMap[address].indexOf(storeName) !== -1) {
          var key = address + '|' + itemName;
          if (!stats[key]) stats[key] = [];
          stats[key].push(price);
        }
      });
    });

    // 平均価格シートを準備
    var avgSheet = ss.getSheetByName('平均価格');
    if (!avgSheet) {
      avgSheet = ss.insertSheet('平均価格');
      avgSheet.getRange(1, 1, 1, 6).setValues([['住所', '品目', '平均価格', '最安値', '最高値', '集計日']]);
      avgSheet.setFrozenRows(1);
    }

    // 全データを上書き
    if (avgSheet.getLastRow() > 1) {
      avgSheet.getRange(2, 1, avgSheet.getLastRow() - 1, 6).clearContent();
    }

    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-M-d');
    var rows  = [];

    Object.keys(stats).sort().forEach(function(key) {
      var parts   = key.split('|');
      var address = parts[0];
      var item    = parts[1];
      var prices  = stats[key];
      var avg     = Math.round(prices.reduce(function(a, b) { return a + b; }, 0) / prices.length);
      var min     = Math.min.apply(null, prices);
      var max     = Math.max.apply(null, prices);
      rows.push([address, item, avg, min, max, today]);
    });

    if (rows.length > 0) {
      avgSheet.getRange(2, 1, rows.length, 6).setValues(rows);
    }

    Logger.log('平均価格集計完了: ' + rows.length + '件');
  } catch(e) {
    Logger.log('calcAveragePrices error: ' + e.message);
  }
}

// ===================================================
// スケジュールトリガーを更新（保存時に自動呼び出し）
// ===================================================
function updateScheduleTriggers(scheduleTimes, autoCollect) {
  try {
    // 既存のautoCollectトリガーを全削除
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'autoCollect') {
        ScriptApp.deleteTrigger(t);
      }
    });

    // autoCollectをスプレッドシートに保存
    saveSettingToSheet('autoCollect', autoCollect);

    // OFFの場合はトリガーを作らずに終了
    if (autoCollect !== 'ON') {
      Logger.log('スケジュール収集がOFFのためトリガーを作成しません');
      return { success: true, triggerCount: 0 };
    }

    // スケジュール時間が未指定の場合はデフォルト10時
    var times = scheduleTimes && scheduleTimes.length > 0
      ? scheduleTimes : [{ hour: 10, minute: 0 }];

    // 最大5つまで
    times = times.slice(0, 5);

    // 各時間のトリガーを作成
    var created = 0;
    times.forEach(function(t) {
      var hour   = parseInt(t.hour)   || 10;
      var minute = parseInt(t.minute) || 0;

      // GASトリガーは時間単位のみ指定可能
      // 分指定は近似値で対応（hourAtを使い、minuteはautoCollect関数内で判定）
      ScriptApp.newTrigger('autoCollect')
        .timeBased()
        .everyDays(1)
        .atHour(hour)
        .inTimezone('Asia/Tokyo')
        .create();

      Logger.log('トリガー作成: ' + hour + '時' + minute + '分');
      created++;
    });

    // スケジュール時間をスプレッドシートに保存
    saveSettingToSheet('scheduleTimes', JSON.stringify(times));

    Logger.log('トリガー更新完了: ' + created + '件');
    return { success: true, triggerCount: created };

  } catch (e) {
    Logger.log('updateScheduleTriggers error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===================================================
// テスト用関数
// ===================================================
function testFindStores() {
  var result = findNearbyStores('栃木県足利市小俣町');
  Logger.log(JSON.stringify(result));
}

function testScrape() {
  var result = scrapeStorePrices(
    'ドラッグストアコスモス 小俣店',
    '栃木県足利市小俣町1773-1',
    'https://tokubai.co.jp/%E3%83%89%E3%83%A9%E3%83%83%E3%82%B0%E3%82%B9%E3%83%88%E3%82%A2%E3%82%B3%E3%82%B9%E3%83%A2%E3%82%B9/193434'
  );
  Logger.log(JSON.stringify(result));
}

function testAutoCollect() {
  autoCollect();
}

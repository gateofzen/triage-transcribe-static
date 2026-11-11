/* ============================================================
 * parse.js - QRコード・テキスト解析
 * ============================================================ */

const Parser = {

  // ===== 時刻・シフト関連 =====
  _extractTime(dtStr) {
    if (!dtStr) return null;
    const m = dtStr.match(/(\d{1,2}):(\d{2})/g);
    if (!m) return null;
    const last = m[m.length - 1];
    const [h, min] = last.split(':').map(Number);
    return { h, m: min, minutes: h * 60 + min };
  },

  detectShift(dtStr) {
    try {
      const t = this._extractTime(dtStr);
      if (!t) return '夜勤';
      if (t.minutes >= 8 * 60 + 30 && t.minutes < 16 * 60 + 30) return '日勤';
      return '夜勤';
    } catch (e) { return '夜勤'; }
  },

  getShiftIdentity(dtStr) {
    // (shift_date_iso, shift_type) を返す
    try {
      const t = this._extractTime(dtStr);
      if (!t) return null;
      const dateM = dtStr.match(/(\d{1,4})[/／](\d{1,2})[/／]?(\d{0,2})/);
      let year, mo, d;
      if (!dateM) {
        const today = new Date();
        year = today.getFullYear();
        mo = today.getMonth() + 1;
        d = today.getDate();
      } else {
        const g1 = dateM[1], g2 = dateM[2], g3 = dateM[3];
        if (g1.length === 4) {
          year = parseInt(g1);
          mo = parseInt(g2);
          d = parseInt(g3) || 1;
        } else {
          year = new Date().getFullYear();
          mo = parseInt(g1);
          d = parseInt(g2);
          // 未来日なら前年扱い
          const testDate = new Date(year, mo - 1, d);
          const today = new Date();
          if (testDate.getTime() > today.getTime() + 86400000) year--;
        }
      }
      let shift, recDate;
      if (t.minutes >= 8 * 60 + 30 && t.minutes < 16 * 60 + 30) {
        shift = '日勤';
        recDate = new Date(year, mo - 1, d);
      } else {
        shift = '夜勤';
        recDate = new Date(year, mo - 1, d);
        if (t.minutes < 8 * 60 + 30) {
          // 深夜早朝は前日夜勤
          recDate.setDate(recDate.getDate() - 1);
        }
      }
      // ローカルタイムでYYYY-MM-DD（toISOStringはUTC変換で前日になるため使わない）
      const iso = `${recDate.getFullYear()}-${String(recDate.getMonth() + 1).padStart(2, '0')}-${String(recDate.getDate()).padStart(2, '0')}`;
      return { shiftDate: iso, shift };
    } catch (e) { return null; }
  },

  autoCaseNo(records, dtStr, excludeKey = null, excludeDrafts = false) {
    const target = this.getShiftIdentity(dtStr);
    if (!target) return 1;
    let count = 0;
    for (const [k, rec] of Object.entries(records)) {
      if (excludeKey && k === excludeKey) continue;
      if (excludeDrafts && rec.is_draft) continue;
      const rid = this.getShiftIdentity(rec.data?.dt_str || '');
      if (rid && rid.shiftDate === target.shiftDate && rid.shift === target.shift) {
        count++;
      }
    }
    return Math.min(count + 1, 15);
  },

  makeUniqueKey(data, records) {
    const kanji = (data.kanji || '').trim();
    const kana = (data.kana || '').trim();
    const dt = (data.dt_str || '').trim();
    let base = kanji || kana || '不明';
    let suffix = '';
    const m = dt.match(/(\d{1,2})[/／](\d{1,2}).*?(\d{1,2}):(\d{2})/);
    if (m) {
      suffix = `_${m[1]}-${m[2]}-${m[3]}${m[4]}`;
    } else if (dt) {
      suffix = '_' + dt.replace(/[^\w]/g, '');
    }
    let candidate = base + suffix;
    if (!records[candidate]) return candidate;
    let n = 2;
    while (records[`${candidate}_${n}`]) n++;
    return `${candidate}_${n}`;
  },

  // ===== テキスト解析 =====
  parseDispatchText(txt) {
    if (!txt) return null;
    const data = {
      dt_str: '', kanji: '', kana: '',
      birth_y: '', birth_m: '', birth_d: '',
      age: '', gender: '',
      complaint: '', history: '', jcs: '0',
      o2_flow: '', o2_device: '',
      bp_s: '', bp_d: '', hr: '', rr: '', bt: '', spo2: '',
      spo2_before: '', team_name: '', items: [],
    };

    // 日時: メッセージ作成タイムスタンプ最優先
    let dtMatch = null;
    const tsM = txt.match(/メッセージ作成タイムスタンプ[^\d]*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (tsM) {
      dtMatch = tsM;
    } else {
      const allMatches = [...txt.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g)];
      const badPositions = new Set();
      for (const bm of txt.matchAll(/最終食事[：:]?\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g)) {
        badPositions.add(bm.index);
      }
      const good = allMatches.filter(m => !badPositions.has(m.index));
      if (good.length) dtMatch = good[good.length - 1];
      else if (allMatches.length) dtMatch = allMatches[allMatches.length - 1];
    }
    if (dtMatch) {
      const [_, y, mo, dy, hh, mm] = dtMatch;
      const wdList = ['月', '火', '水', '木', '金', '土', '日'];
      let wd = '';
      try {
        const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(dy));
        wd = wdList[(dt.getDay() + 6) % 7]; // JSは日曜=0、日本では月=0
      } catch (e) {}
      data.dt_str = `${parseInt(mo)}/${parseInt(dy)}(${wd})${hh}:${mm}`;
    }

    // 氏名（漢字＋カナ）: "矢内　聖子（ヤナイ　セイコ）"
    const nameM = txt.match(/([一-龥]{1,4}[　\s]+[一-龥]{1,6})\s*[（(]([ァ-ヶー\s　]+)[）)]/);
    if (nameM) {
      data.kanji = nameM[1].trim();
      data.kana = nameM[2].trim();
    }

    // 年齢・性別: "62歳 女性"
    const ageGenderM = txt.match(/(\d{1,3})歳[\s　]+([男女])/);
    if (ageGenderM) {
      data.age = ageGenderM[1];
      data.gender = ageGenderM[2] === '男' ? '1' : '2';
    } else {
      const ageM = txt.match(/(\d{1,3})\s*[歳才]/);
      if (ageM) data.age = ageM[1];
    }

    // 主訴
    const compM = txt.match(/＜主訴＞\s*\n(.+?)(?=\n＜|\n<)/s);
    if (compM) data.complaint = compM[1].trim();

    // 現病歴
    const histM = txt.match(/＜現病歴＞\s*\n(.+?)(?=\n＜|\n<)/s);
    if (histM) data.history = histM[1].trim();

    // 血圧
    const bpM = txt.match(/血圧\s*(\d{2,3})[/／](\d{2,3})/) || txt.match(/BP\s*(\d{2,3})[/／](\d{2,3})/);
    if (bpM) { data.bp_s = bpM[1]; data.bp_d = bpM[2]; }

    // 脈拍
    const hrM = txt.match(/(?:脈拍|HR|PR)\s*(\d{2,3})/);
    if (hrM) data.hr = hrM[1];

    // 呼吸
    const rrM = txt.match(/(?:呼吸|RR)\s*(\d{1,3})/);
    if (rrM) data.rr = rrM[1];

    // SpO2
    const spo2M = txt.match(/(?:SPO2|SpO2|Sp02|酸素飽和度)\s*(\d{2,3})/i);
    if (spo2M) { data.spo2 = spo2M[1]; data.spo2_before = spo2M[1]; }

    // BT
    const btM = txt.match(/(?:BT|体温|KT)\s*(\d{2}\.?\d)/);
    if (btM) data.bt = btM[1];

    // JCS
    const jcsM = txt.match(/JCS\s*(\d+|[IVX\-]+)/);
    if (jcsM) data.jcs = jcsM[1];

    // 酸素
    const o2M = txt.match(/(\d{1,2})[Ll]酸素/);
    if (o2M) data.o2_flow = o2M[1];

    // 救急隊: "平岸５救急"
    const teamM = txt.match(/([一-龥ぁ-んァ-ヶー]+?)[\d０-９]*救急/);
    if (teamM) data.team_name = teamM[1];

    if (data.kana || data.kanji || data.complaint || data.dt_str || data.age) {
      return data;
    }
    return null;
  },

  // ===== QRデータ解析（Base64エンコードされたCSV） =====
  parseQR(raw) {
    let decoded = raw;
    try {
      decoded = atob(raw);
      try {
        decoded = decodeURIComponent(escape(decoded));
      } catch (e) {}
    } catch (e) {
      decoded = raw;
    }
    const items = decoded.split(',');
    const safe = (i, d = '') => i < items.length ? items[i].trim() : d;

    const data = {
      dt_str: '', kanji: '', kana: '',
      birth_y: '', birth_m: '', birth_d: '',
      age: '', gender: '',
      complaint: '', history: '', jcs: '0',
      o2_flow: '', o2_device: '',
      bp_s: '', bp_d: '', hr: '', rr: '', bt: '', spo2: '',
      spo2_before: '', team_name: '', items: items,
    };

    // 氏名
    const nameRaw = safe(4);
    if (nameRaw.includes('θ')) {
      const parts = nameRaw.split('θ');
      data.kanji = parts[0].trim();
      data.kana = (parts[1] || '').trim();
    } else {
      data.kanji = nameRaw;
    }

    // 依頼日時: items[1]
    const dtRaw = safe(1);
    const m = dtRaw.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (m) {
      const wdList = ['月', '火', '水', '木', '金', '土', '日'];
      try {
        const dt = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
        const wd = wdList[(dt.getDay() + 6) % 7];
        data.dt_str = `${parseInt(m[2])}/${parseInt(m[3])}(${wd})${m[4]}:${m[5]}`;
      } catch (e) { data.dt_str = dtRaw; }
    } else {
      data.dt_str = dtRaw;
    }

    // 生年月日: items[13]
    const bRaw = safe(13);
    if (bRaw.length === 8 && /^\d+$/.test(bRaw)) {
      data.birth_y = bRaw.slice(0, 4);
      data.birth_m = String(parseInt(bRaw.slice(4, 6)));
      data.birth_d = String(parseInt(bRaw.slice(6, 8)));
    }

    // 主訴
    let complaint = safe(8);
    if (!complaint) {
      for (const idx of [10, 11]) {
        const v = safe(idx);
        if (v && v.length <= 30 && !/^\d+$/.test(v)) {
          complaint = v; break;
        }
      }
    }
    if (!complaint) {
      const h = safe(9);
      for (const sep of ['。', '、', '\n']) {
        if (h.includes(sep)) { complaint = h.split(sep)[0]; break; }
      }
    }
    data.complaint = complaint;
    data.history = safe(9);
    data.gender = safe(5);
    data.age = safe(14);
    data.jcs = safe(15, '0');
    data.bp_s = safe(19);
    data.bp_d = safe(20);
    data.hr = safe(21);
    data.rr = safe(22);
    data.bt = safe(23);
    data.spo2 = safe(24);
    data.spo2_before = safe(24);

    // 救急隊: items[29]
    const teamRaw = safe(29);
    data.team_name = teamRaw.replace(/[\d０-９]+$/, '').trim();

    return data;
  },

  // ===== QR画像からデコード（jsQR + 多段階検出パイプライン） =====
  // 過去の救急隊QRコード読み取りアプリと同じ多段階検出：
  //   Phase 1: オリジナル、複数スケール、両反転
  //   Phase 2: 二値化（しきい値）版
  //   Phase 3: 中央クロップ版（スクショ内に余白がある場合）
  //   Phase 4: 4分割（QRが画像の一部に寄っている場合）
  _loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像の読み込みに失敗')); };
      img.src = url;
    });
  },

  _tryJsQR(imageData) {
    if (typeof jsQR === 'undefined') throw new Error('jsQRライブラリが読み込まれていません');
    for (const inv of ['dontInvert', 'onlyInvert', 'attemptBoth']) {
      try {
        const r = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: inv });
        if (r && r.data) return r.data;
      } catch (e) { /* 次のモードへ */ }
    }
    return null;
  },

  _drawToCanvas(img, w, h, sx = 0, sy = 0, sw = null, sh = null) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if (sw !== null && sh !== null) {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
    return { canvas, ctx };
  },

  // 画像に白い余白（quiet zone）を追加。jsQR は QR周囲の静謐領域を必要とする
  _drawWithPadding(img, padPx, scale = 1.0, smooth = true) {
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const outW = Math.round((w0 + padPx * 2) * scale);
    const outH = Math.round((h0 + padPx * 2) * scale);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // 白で塗りつぶし
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    // 中央に画像を描画
    const dw = Math.round(w0 * scale);
    const dh = Math.round(h0 * scale);
    const dx = Math.round(padPx * scale);
    const dy = Math.round(padPx * scale);
    ctx.imageSmoothingEnabled = smooth;
    if (smooth) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
    return { canvas, ctx };
  },

  _getImageData(ctx, w, h) {
    try { return ctx.getImageData(0, 0, w, h); }
    catch (e) { return null; }
  },

  // 画像を二値化（Otsu風しきい値）してから jsQR
  _binarize(imageData) {
    const d = imageData.data;
    const n = d.length / 4;
    // 平均輝度を閾値に（簡易Otsu代替）
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const mean = sum / n;
    const thresh = mean;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = y < thresh ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return imageData;
  },

  async decodeQRFromBlob(blob) {
    const { img, url } = await this._loadImage(blob);
    try {
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return null;

      // すべてのスケールパターンを試行（小さい画像向けに6x, 8xも追加）
      const scales = [1.0, 2.0, 1.5, 3.0, 0.75, 0.5, 4.0, 0.33, 6.0, 8.0];

      // ===== Phase 0: 白余白(quiet zone)付き - jsQRは画像端にQRが接している場合に失敗するため =====
      //   救急隊ダッシュボードの右クリック画像コピー等、quiet zoneが欠けた画像に有効
      //   padding + scale + smooth/sharp の多パターンを試行
      const padSizes = [40, 80, 20, 60, 100, 120];
      const padScales = [1.0, 1.5, 2.0, 0.75, 0.5, 2.5, 3.0, 1.25];
      for (const padPx of padSizes) {
        for (const scale of padScales) {
          const outW = Math.round((w0 + padPx * 2) * scale);
          const outH = Math.round((h0 + padPx * 2) * scale);
          if (outW < 40 || outW > 4096) continue;
          for (const smooth of [true, false]) {
            const { ctx } = this._drawWithPadding(img, padPx, scale, smooth);
            const data = this._getImageData(ctx, outW, outH);
            if (!data) continue;
            const r = this._tryJsQR(data);
            if (r) { console.log('[QR] Phase0 padding=', padPx, 'scale=', scale, 'smooth=', smooth); return r; }
          }
        }
      }

      // ===== Phase 1: オリジナル、複数スケール =====
      for (const scale of scales) {
        const w = Math.round(w0 * scale);
        const h = Math.round(h0 * scale);
        if (w < 40 || h < 40 || w > 4096 || h > 4096) continue;
        const { ctx } = this._drawToCanvas(img, w, h);
        const data = this._getImageData(ctx, w, h);
        if (!data) continue;
        const r = this._tryJsQR(data);
        if (r) { console.log('[QR] Phase1 scale=', scale); return r; }
      }

      // ===== Phase 2: 二値化バージョン =====
      for (const scale of [1.0, 2.0, 0.75, 1.5]) {
        const w = Math.round(w0 * scale);
        const h = Math.round(h0 * scale);
        if (w < 40 || h < 40 || w > 4096 || h > 4096) continue;
        const { ctx } = this._drawToCanvas(img, w, h);
        const data = this._getImageData(ctx, w, h);
        if (!data) continue;
        this._binarize(data);
        const r = this._tryJsQR(data);
        if (r) { console.log('[QR] Phase2 binarized scale=', scale); return r; }
      }

      // ===== Phase 3: 中央クロップ（60%、80%） =====
      for (const cropRatio of [0.6, 0.8]) {
        const cw = Math.round(w0 * cropRatio);
        const ch = Math.round(h0 * cropRatio);
        const sx = Math.round((w0 - cw) / 2);
        const sy = Math.round((h0 - ch) / 2);
        for (const scale of [1.0, 2.0, 1.5]) {
          const dw = Math.round(cw * scale);
          const dh = Math.round(ch * scale);
          if (dw < 40 || dh < 40 || dw > 4096 || dh > 4096) continue;
          const { ctx } = this._drawToCanvas(img, dw, dh, sx, sy, cw, ch);
          const data = this._getImageData(ctx, dw, dh);
          if (!data) continue;
          const r = this._tryJsQR(data);
          if (r) { console.log('[QR] Phase3 crop=', cropRatio, 'scale=', scale); return r; }
          // 二値化も試す
          this._binarize(data);
          const r2 = this._tryJsQR(data);
          if (r2) { console.log('[QR] Phase3 binarized crop=', cropRatio, 'scale=', scale); return r2; }
        }
      }

      // ===== Phase 4: 4分割（QRが一部分にある場合） =====
      const halfW = Math.round(w0 / 2);
      const halfH = Math.round(h0 / 2);
      const quadrants = [
        [0, 0], [halfW, 0], [0, halfH], [halfW, halfH],
      ];
      for (const [qx, qy] of quadrants) {
        for (const scale of [1.5, 2.0, 1.0]) {
          const dw = Math.round(halfW * scale);
          const dh = Math.round(halfH * scale);
          if (dw < 40 || dh < 40 || dw > 4096 || dh > 4096) continue;
          const { ctx } = this._drawToCanvas(img, dw, dh, qx, qy, halfW, halfH);
          const data = this._getImageData(ctx, dw, dh);
          if (!data) continue;
          const r = this._tryJsQR(data);
          if (r) { console.log('[QR] Phase4 quadrant=', qx, qy, 'scale=', scale); return r; }
        }
      }

      console.log(`[QR] All phases failed. Image size: ${w0}x${h0}`);
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  async decodeQRFromFile(file) {
    return this.decodeQRFromBlob(file);
  },
};

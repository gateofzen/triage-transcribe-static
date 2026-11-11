/* ============================================================
 * app.js - UIメインロジック（転記専用版）
 *
 * 【B案：外部サービスに保存しない】
 *   - GitHub連携なし
 *   - localStorage / sessionStorage / IndexedDB いずれも使用しない
 *   - 患者データは全て JS変数（App.records）のメモリ内のみ
 *   - タブを閉じる・リロードする・エラーが起きるとデータは全消失
 *   - 印刷は紙に出力されるのみ、デジタルコピーは残らない
 * ============================================================ */

const App = {
  records: {},                // メモリ内のみの患者記録。{ key: rec, ... }
  currentEditingData: null,
  currentEditingKey: null,
  currentMode: null,

  init() {
    this.bindEvents();
    this.renderPatientList();
  },

  // ===== イベントバインド =====
  bindEvents() {
    // 強制リロード（SWキャッシュ全消し）
    const forceReload = document.getElementById('force-reload-btn');
    if (forceReload) {
      forceReload.addEventListener('click', async () => {
        if (Object.keys(this.records).length > 0) {
          if (!confirm('⚠️ メモリ内の患者データがすべて消えます。続行しますか？')) return;
        }
        this.setStatus('🔄 キャッシュをクリア中...', 'info');
        try {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          }
        } catch (e) { console.warn('cache clear failed:', e); }
        location.reload();
      });
    }

    // モード選択
    document.getElementById('mode-qr-paste').addEventListener('click', () => this.handleQRPaste());
    document.getElementById('mode-text').addEventListener('click', () => this.showTextMode());
    document.getElementById('mode-manual').addEventListener('click', () => this.showManualMode());

    document.getElementById('text-clear').addEventListener('click', () => {
      document.getElementById('text-input').value = '';
      document.getElementById('text-parse-info').classList.add('hidden');
      this.hideForm();
    });
    document.getElementById('text-input').addEventListener('input', (e) => {
      this.handleTextInput(e.target.value);
    });

    // フォーム
    document.getElementById('add-to-list-btn').addEventListener('click', () => this.addToList());
    document.getElementById('generate-now-btn').addEventListener('click', () => this.generateNow());
    document.getElementById('cancel-input-btn').addEventListener('click', () => this.cancelInput());

    // 救急隊
    document.getElementById('f-origin-sel').addEventListener('change', (e) => {
      const free = document.getElementById('f-origin-free');
      if (e.target.value === 'その他（直接入力）') free.classList.remove('hidden');
      else free.classList.add('hidden');
    });
    // 受診歴
    document.querySelectorAll('input[name="hist"]').forEach(r => {
      r.addEventListener('change', (e) => {
        const dept = document.getElementById('f-hist-dept');
        if (e.target.value === '有') dept.classList.remove('hidden');
        else dept.classList.add('hidden');
      });
    });
    // 判定
    document.querySelectorAll('input[name="decision"]').forEach(r => {
      r.addEventListener('change', (e) => {
        if (e.target.value === '応需') {
          document.getElementById('accept-details').classList.remove('hidden');
          document.getElementById('reject-details').classList.add('hidden');
        } else {
          document.getElementById('accept-details').classList.add('hidden');
          document.getElementById('reject-details').classList.remove('hidden');
        }
      });
    });
    // 初期対応
    document.getElementById('f-init').addEventListener('change', (e) => {
      const el = document.getElementById('f-init-other');
      el.classList.toggle('hidden', e.target.value !== 'その他');
    });
    // 最終転帰
    document.getElementById('f-out').addEventListener('change', (e) => {
      const el = document.getElementById('f-out-other');
      el.classList.toggle('hidden', e.target.value !== 'その他');
      document.getElementById('admit-details').classList.toggle('hidden', e.target.value !== '入院');
    });
    document.getElementById('f-ward').addEventListener('change', (e) => {
      document.getElementById('f-ward-other').classList.toggle('hidden', e.target.value !== 'その他');
    });
    document.getElementById('f-main').addEventListener('change', (e) => {
      document.getElementById('f-main-other').classList.toggle('hidden', e.target.value !== 'その他');
    });
    // 不応需理由
    document.getElementById('f-reason').addEventListener('change', () => this.updateReasonSubFields());

    // よくある理由のワンクリックチップ
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const text = e.currentTarget.dataset.reasonText || '';
        const commentEl = document.getElementById('f-reason-comment');
        if (commentEl) commentEl.value = text;
        document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // 年齢自動計算
    document.getElementById('calc-age-btn').addEventListener('click', () => this.calcAgeFromBirth());

    // 一括操作
    document.getElementById('bulk-generate-btn').addEventListener('click', () => this.bulkGenerate());
    document.getElementById('bulk-clear-btn').addEventListener('click', () => this.bulkClear());

    document.getElementById('print-all-btn').addEventListener('click', () => window.print());
    document.getElementById('close-preview-btn').addEventListener('click', () => {
      document.getElementById('ledger-preview-section').classList.add('hidden');
      document.getElementById('ledger-canvases').innerHTML = '';
    });
  },

  // ===== モード切替 =====
  async handleQRPaste() {
    document.getElementById('text-mode-pane').classList.add('hidden');
    document.getElementById('patient-form').classList.add('hidden');

    // 1. モダン Clipboard API で即座に取得を試みる
    this.setStatus('🔄 クリップボードから画像を取得中...', 'info');
    const got = await this.tryClipboardAPIImmediate();
    if (got === 'success') return;

    // 2. フォールバック：貼り付けゾーンを表示
    const pane = document.getElementById('qr-mode-pane');
    pane.classList.remove('hidden');
    const zone = document.getElementById('qr-paste-zone');
    this.setupQRPasteZone(zone);
    setTimeout(() => { try { zone.focus(); } catch(e) {} }, 50);

    if (got === 'no_image') {
      this.setStatus('⚠️ クリップボードに画像がありません。下の枠で Ctrl+V してください', 'warning');
    } else if (got === 'denied') {
      this.setStatus('ℹ️ クリップボードへのアクセス許可が必要です。下の枠で Ctrl+V してください', 'info');
    } else {
      this.setStatus('ℹ️ 下の枠で Ctrl+V で画像を貼り付けてください', 'info');
    }
  },

  async tryClipboardAPIImmediate() {
    if (!navigator.clipboard || !navigator.clipboard.read) return 'unsupported';
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await this.processQRBlob(blob);
            return 'success';
          }
        }
      }
      return 'no_image';
    } catch (e) {
      console.warn('clipboard.read failed:', e);
      return 'denied';
    }
  },

  setupQRPasteZone(zone) {
    if (zone._qrBound) return;
    zone._qrBound = true;

    zone.addEventListener('paste', async (ev) => {
      ev.preventDefault();
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) {
        this.setStatus('⚠️ クリップボードが取得できません', 'warning');
        return;
      }
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            zone.textContent = '';
            try {
              const img = document.createElement('img');
              img.src = URL.createObjectURL(blob);
              zone.appendChild(img);
            } catch(e) {}
            await this.processQRBlob(blob);
            return;
          }
        }
      }
      this.setStatus('⚠️ クリップボードに画像がありません（テキストの場合は「テキスト貼り付け」モードを使用）', 'warning');
    });

    document.getElementById('qr-mode-close').addEventListener('click', () => {
      document.getElementById('qr-mode-pane').classList.add('hidden');
      zone.textContent = 'ここをクリックして Ctrl+V で画像を貼り付け';
    });
  },

  async processQRBlob(blob) {
    this.setStatus('🔄 QRコード解析中...（複数パターンで試行）', 'info');
    try {
      const raw = await Parser.decodeQRFromBlob(blob);
      if (!raw) {
        this.setStatus('❌ QRコードが認識できませんでした（画像が小さすぎる・鮮明でない・QRコードが含まれていない可能性）', 'error');
        return;
      }
      const data = Parser.parseQR(raw);
      this.currentMode = 'qr';
      this.showForm(data);
      this.setStatus(`✅ QRコード解析成功（${raw.length}文字）`, 'success');
    } catch (e) {
      this.setStatus('❌ ' + (e.message || e), 'error');
    }
  },

  async showTextMode() {
    this.currentMode = 'text';
    document.getElementById('text-mode-pane').classList.remove('hidden');
    document.getElementById('qr-mode-pane').classList.add('hidden');
    this.hideForm();

    const ta = document.getElementById('text-input');

    this.setStatus('🔄 クリップボードからテキストを取得中...', 'info');
    const got = await this.tryClipboardTextImmediate();
    if (got === 'success') return;

    try { ta.focus(); } catch(e) {}
    if (got === 'empty') {
      this.setStatus('⚠️ クリップボードにテキストがありません。下の枠で Ctrl+V してください', 'warning');
    } else if (got === 'denied') {
      this.setStatus('ℹ️ クリップボードへのアクセス許可が必要です。下の枠で Ctrl+V してください', 'info');
    } else {
      this.setStatus('ℹ️ 下の枠に Ctrl+V でテキストを貼り付けてください', 'info');
    }
  },

  async tryClipboardTextImmediate() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return 'unsupported';
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) return 'empty';
      const ta = document.getElementById('text-input');
      ta.value = text;
      this.handleTextInput(text);
      this.setStatus('✅ クリップボードから取得・解析しました', 'success');
      return 'success';
    } catch (e) {
      console.warn('clipboard.readText failed:', e);
      return 'denied';
    }
  },

  handleTextInput(text) {
    if (!text || text.length < 10) {
      document.getElementById('text-parse-info').classList.add('hidden');
      this.hideForm();
      return;
    }
    const data = Parser.parseDispatchText(text);
    const info = document.getElementById('text-parse-info');
    if (data) {
      info.classList.remove('hidden');
      info.classList.remove('warning', 'error');
      info.innerHTML = `✅ 解析成功。受付日時として抽出: <b>${data.dt_str || '(未取得)'}</b><br>違う場合は下の編集欄で修正してください。`;
      this.showForm(data);
    } else {
      info.classList.remove('hidden');
      info.classList.add('warning');
      info.innerHTML = '⚠️ 自動解析できませんでした。手入力モードをお試しください。';
    }
  },

  showManualMode() {
    this.currentMode = 'manual';
    document.getElementById('text-mode-pane').classList.add('hidden');
    this.showForm({});
  },

  // ===== フォーム表示・取得 =====
  showForm(data) {
    this.currentEditingData = data;
    const form = document.getElementById('patient-form');
    form.classList.remove('hidden');

    const now = new Date();
    const wd = ['月', '火', '水', '木', '金', '土', '日'][(now.getDay() + 6) % 7];
    const defaultDt = `${now.getMonth() + 1}/${now.getDate()}(${wd})${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    document.getElementById('f-dt-str').value = data.dt_str || defaultDt;
    document.getElementById('f-kanji').value = data.kanji || '';
    document.getElementById('f-kana').value = data.kana || '';
    document.getElementById('f-birth-y').value = data.birth_y || '';
    document.getElementById('f-birth-m').value = data.birth_m || '';
    document.getElementById('f-birth-d').value = data.birth_d || '';
    document.getElementById('f-age').value = data.age || '';
    const gender = data.gender || '';
    document.querySelectorAll('input[name="gender"]').forEach(r => { r.checked = r.value === gender; });
    document.getElementById('f-complaint').value = data.complaint || '';
    document.getElementById('f-history').value = data.history || '';
    document.getElementById('f-jcs').value = data.jcs || '0';
    document.getElementById('f-bps').value = data.bp_s || '';
    document.getElementById('f-bpd').value = data.bp_d || '';
    document.getElementById('f-hr').value = data.hr || '';
    document.getElementById('f-rr').value = data.rr || '';
    document.getElementById('f-spo2').value = data.spo2 || '';
    document.getElementById('f-bt').value = data.bt || '';
    document.getElementById('f-o2').value = data.o2_flow || '';

    // 救急隊
    const teamName = data.team_name || '';
    const origin = data._origin || teamName;
    const originOpts = Array.from(document.getElementById('f-origin-sel').options).map(o => o.value);
    if (originOpts.includes(origin)) {
      document.getElementById('f-origin-sel').value = origin;
      document.getElementById('f-origin-free').classList.add('hidden');
    } else if (origin) {
      document.getElementById('f-origin-sel').value = 'その他（直接入力）';
      document.getElementById('f-origin-free').value = origin;
      document.getElementById('f-origin-free').classList.remove('hidden');
    } else {
      document.getElementById('f-origin-sel').value = '';
    }

    // No. 自動設定
    const nextNo = Parser.autoCaseNo(this.records, defaultDt);
    document.getElementById('f-case-no').value = String(nextNo);

    // 不応需理由のサブフィールドを一旦リセット
    document.querySelectorAll('input[name="bed_sub"]').forEach(r => { r.checked = false; });
    const commentEl = document.getElementById('f-reason-comment');
    if (commentEl) commentEl.value = '';
    document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
    this.updateReasonSubFields();

    document.getElementById('patient-form-title').textContent =
      this.currentMode === 'edit' ? `✏️ 編集: ${data.kanji || data.kana || '不明'}` : '👤 患者情報';

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  hideForm() {
    document.getElementById('patient-form').classList.add('hidden');
    this.currentEditingData = null;
    this.currentEditingKey = null;
  },

  getFormData() {
    const data = {
      dt_str: document.getElementById('f-dt-str').value.trim(),
      kanji: document.getElementById('f-kanji').value.trim(),
      kana: document.getElementById('f-kana').value.trim(),
      birth_y: document.getElementById('f-birth-y').value.trim(),
      birth_m: document.getElementById('f-birth-m').value.trim(),
      birth_d: document.getElementById('f-birth-d').value.trim(),
      age: document.getElementById('f-age').value.trim(),
      gender: document.querySelector('input[name="gender"]:checked')?.value || '',
      complaint: document.getElementById('f-complaint').value.trim(),
      history: document.getElementById('f-history').value.trim(),
      jcs: document.getElementById('f-jcs').value.trim(),
      bp_s: document.getElementById('f-bps').value.trim(),
      bp_d: document.getElementById('f-bpd').value.trim(),
      hr: document.getElementById('f-hr').value.trim(),
      rr: document.getElementById('f-rr').value.trim(),
      spo2: document.getElementById('f-spo2').value.trim(),
      spo2_before: document.getElementById('f-spo2').value.trim(),
      bt: document.getElementById('f-bt').value.trim(),
      o2_flow: document.getElementById('f-o2').value.trim(),
      o2_device: '',
      team_name: '',
      items: [],
    };

    const originSel = document.getElementById('f-origin-sel').value;
    const originFree = document.getElementById('f-origin-free').value.trim();
    const origin = originSel === 'その他（直接入力）' ? originFree : originSel;

    const histYn = document.querySelector('input[name="hist"]:checked')?.value || '無';
    const histDept = document.getElementById('f-hist-dept').value.trim();

    const decision = document.querySelector('input[name="decision"]:checked')?.value || '応需';
    const res = { decision };
    if (decision === '応需') {
      res.init = document.getElementById('f-init').value;
      if (res.init === 'その他') res.init_other = document.getElementById('f-init-other').value.trim();
      res.out = document.getElementById('f-out').value;
      if (res.out === 'その他') res.out_other = document.getElementById('f-out-other').value.trim();
      if (res.out === '入院') {
        res.ward = document.getElementById('f-ward').value;
        if (res.ward === 'その他') res.ward_other = document.getElementById('f-ward-other').value.trim();
        res.main = document.getElementById('f-main').value;
        if (res.main === 'その他') res.main_other = document.getElementById('f-main-other').value.trim();
      }
    } else {
      res.reason = document.getElementById('f-reason').value;
      if (res.reason.startsWith('2.')) {
        const bed = document.querySelector('input[name="bed_sub"]:checked')?.value || '';
        if (bed) res.bed_sub = bed;
      } else {
        const comment = document.getElementById('f-reason-comment').value.trim();
        if (comment) res.reason_comment = comment;
      }
    }

    const freeNote = document.getElementById('f-free-note').value.trim();

    return {
      data,
      case_no: parseInt(document.getElementById('f-case-no').value) || 1,
      recorder: document.getElementById('f-recorder').value,
      origin,
      history_yn: histYn,
      history_dept: histDept,
      decision,
      res,
      shift: Parser.detectShift(data.dt_str),
      free_note: freeNote,
      is_draft: false,
    };
  },

  calcAgeFromBirth() {
    const y = parseInt(document.getElementById('f-birth-y').value);
    const m = parseInt(document.getElementById('f-birth-m').value);
    const d = parseInt(document.getElementById('f-birth-d').value);
    if (!y || !m || !d) return;
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
    document.getElementById('f-age').value = String(Math.max(0, age));
  },

  // ===== 一覧への追加（メモリ内のみ） =====
  addToList() {
    const rec = this.getFormData();
    if (!rec.data.dt_str) { this.setStatus('⚠️ 受付日時を入力してください', 'warning'); return; }
    const key = this.currentEditingKey || Parser.makeUniqueKey(rec.data, this.records);
    rec.registered_at = new Date().toISOString();
    this.records[key] = rec;
    this.setStatus(`✅ ${key} を一覧に追加しました（メモリ内のみ）`, 'success');
    this.hideForm();
    document.getElementById('text-mode-pane').classList.add('hidden');
    document.getElementById('text-input').value = '';
    this.renderPatientList();
  },

  async generateNow() {
    const rec = this.getFormData();
    if (!rec.data.dt_str) { this.setStatus('⚠️ 受付日時を入力してください', 'warning'); return; }
    // メモリ内一覧にも追加（印刷後も一時的に残しておく）
    const key = this.currentEditingKey || Parser.makeUniqueKey(rec.data, this.records);
    rec.registered_at = new Date().toISOString();
    this.records[key] = rec;
    this.renderPatientList();
    // 台帳生成
    this.setStatus('🖨️ 台帳生成中...', 'info');
    try {
      const canvas = await Renderer.renderTriage(rec);
      this.showLedgerPreview([canvas]);
      this.setStatus('✅ 台帳生成完了（印刷後はタブを閉じて破棄してください）', 'success');
    } catch (e) {
      console.error(e);
      this.setStatus('❌ ' + e.message, 'error');
    }
  },

  cancelInput() {
    this.hideForm();
    document.getElementById('text-mode-pane').classList.add('hidden');
    document.getElementById('text-input').value = '';
    document.getElementById('text-parse-info').classList.add('hidden');
  },

  // ===== 患者リスト描画 =====
  renderPatientList() {
    const container = document.getElementById('patient-list');
    container.innerHTML = '';
    const entries = Object.entries(this.records);
    if (!entries.length) {
      container.innerHTML = '<p style="color:#888;padding:12px">まだ本セッションの患者はいません。</p>';
      return;
    }
    const sorted = entries.sort(([, a], [, b]) => {
      const ida = Parser.getShiftIdentity(a.data?.dt_str || '') || { shiftDate: '', shift: '' };
      const idb = Parser.getShiftIdentity(b.data?.dt_str || '') || { shiftDate: '', shift: '' };
      if (ida.shiftDate !== idb.shiftDate) return ida.shiftDate.localeCompare(idb.shiftDate);
      if (ida.shift !== idb.shift) return ida.shift.localeCompare(idb.shift);
      return (a.case_no || 0) - (b.case_no || 0);
    });

    let currentGroup = null;
    for (const [key, rec] of sorted) {
      const id = Parser.getShiftIdentity(rec.data?.dt_str || '');
      const groupKey = id ? `${id.shiftDate}_${id.shift}` : '不明';
      if (groupKey !== currentGroup) {
        currentGroup = groupKey;
        const icon = id?.shift === '日勤' ? '🌕' : '🌑';
        const header = document.createElement('div');
        header.className = 'shift-divider';
        header.textContent = `${icon} ${id?.shiftDate || '?'} ${id?.shift || '?'}`;
        container.appendChild(header);
      }
      const item = document.createElement('div');
      item.className = 'patient-item';
      const kana = (rec.data?.kana || '').replace(/[　\s]/g, '');
      const name = kana || key.replace(/[　\s]/g, '');
      const dt = rec.data?.dt_str || '';
      const origin = rec.origin || '';
      const age = rec.data?.age || '';
      const ageStr = age ? `(${age}才)` : '';
      const outcome = rec.res?.decision === '不応需' ? '不応需' : (rec.res?.out || '未記入');
      item.innerHTML = `
        <div class="info">
          <b>${rec.case_no || '?'}.${escapeHtml(name)}</b>${ageStr} ${escapeHtml(dt)} 🚑${escapeHtml(origin)} 転帰:${escapeHtml(outcome)}
        </div>
        <div class="actions">
          <button data-key="${key}" data-action="edit">編集</button>
          <button data-key="${key}" data-action="delete">削除</button>
        </div>
      `;
      container.appendChild(item);
    }

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        if (action === 'edit') this.editPatient(key);
        else if (action === 'delete') this.deletePatient(key);
      });
    });
  },

  editPatient(key) {
    const rec = this.records[key];
    if (!rec) return;
    this.currentEditingKey = key;
    this.currentMode = 'edit';
    const data = { ...rec.data, _origin: rec.origin };
    this.showForm(data);
    document.querySelector(`input[name="decision"][value="${rec.decision || '応需'}"]`).checked = true;
    document.querySelector(`input[name="decision"][value="${rec.decision || '応需'}"]`).dispatchEvent(new Event('change'));
    document.querySelector(`input[name="hist"][value="${rec.history_yn || '無'}"]`).checked = true;
    document.querySelector(`input[name="hist"][value="${rec.history_yn || '無'}"]`).dispatchEvent(new Event('change'));
    if (rec.history_dept) document.getElementById('f-hist-dept').value = rec.history_dept;
    document.getElementById('f-case-no').value = String(rec.case_no || 1);
    document.getElementById('f-recorder').value = rec.recorder || '前川';
    const res = rec.res || {};
    if (res.init) document.getElementById('f-init').value = res.init;
    if (res.out) document.getElementById('f-out').value = res.out;
    if (res.ward) document.getElementById('f-ward').value = res.ward;
    if (res.main) document.getElementById('f-main').value = res.main;
    if (res.reason) {
      const normalizedReason = res.reason.replace(/^3\. 既定の応需不可症例/, '3. 既定の応需不可');
      const sel = document.getElementById('f-reason');
      const opts = Array.from(sel.options).map(o => o.value);
      sel.value = opts.includes(normalizedReason) ? normalizedReason :
        (opts.find(o => o.split('.')[0] === normalizedReason.split('.')[0]) || opts[0]);
    }
    if (res.bed_sub) {
      const r = document.querySelector(`input[name="bed_sub"][value="${res.bed_sub}"]`);
      if (r) r.checked = true;
    }
    if (res.reason_comment) document.getElementById('f-reason-comment').value = res.reason_comment;
    document.querySelectorAll('.quick-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.reasonText === (res.reason_comment || ''));
    });
    if (rec.free_note) document.getElementById('f-free-note').value = rec.free_note;
    this.updateReasonSubFields();
  },

  updateReasonSubFields() {
    const reason = document.getElementById('f-reason').value || '';
    const isBed = reason.startsWith('2.');
    const hasComment = /^(3|4|5|6-A|6-B|7)\./.test(reason);
    const isDefault = reason.startsWith('3.');
    document.getElementById('f-bed-sub-row').classList.toggle('hidden', !isBed);
    document.getElementById('f-reason-comment-row').classList.toggle('hidden', !hasComment);
    const quickRow = document.getElementById('f-reason-quick-row');
    if (quickRow) quickRow.classList.toggle('hidden', !isDefault);

    if (isBed) {
      const anyBedChecked = !!document.querySelector('input[name="bed_sub"]:checked');
      if (!anyBedChecked) {
        const er = document.querySelector('input[name="bed_sub"][value="救急外来"]');
        if (er) er.checked = true;
      }
    }

    if (!isDefault) {
      document.querySelectorAll('.quick-chip').forEach(c => c.classList.remove('active'));
    }
  },

  deletePatient(key) {
    if (!confirm(`「${key}」を本セッションから削除しますか？（取り消し不能）`)) return;
    delete this.records[key];
    this.setStatus(`🗑️ ${key} を削除しました`, 'success');
    this.renderPatientList();
  },

  bulkClear() {
    const count = Object.keys(this.records).length;
    if (!count) return;
    if (!confirm(`本セッションの患者${count}人全員を削除しますか？（取り消し不能）`)) return;
    this.records = {};
    this.setStatus(`🗑️ ${count}人を一括削除しました`, 'success');
    this.renderPatientList();
  },

  async bulkGenerate() {
    const entries = Object.entries(this.records);
    if (!entries.length) { this.setStatus('⚠️ 患者がいません', 'warning'); return; }
    this.setStatus(`🖨️ ${entries.length}人の台帳生成中...`, 'info');
    const sorted = entries.sort(([, a], [, b]) => {
      const ida = Parser.getShiftIdentity(a.data?.dt_str || '') || { shiftDate: '', shift: '' };
      const idb = Parser.getShiftIdentity(b.data?.dt_str || '') || { shiftDate: '', shift: '' };
      if (ida.shiftDate !== idb.shiftDate) return ida.shiftDate.localeCompare(idb.shiftDate);
      if (ida.shift !== idb.shift) return ida.shift.localeCompare(idb.shift);
      return (a.case_no || 0) - (b.case_no || 0);
    });
    const canvases = [];
    for (const [, rec] of sorted) {
      try {
        const c = await Renderer.renderTriage(rec);
        canvases.push(c);
      } catch (e) { console.error(e); }
    }
    this.showLedgerPreview(canvases);
    this.setStatus(`✅ ${canvases.length}枚生成完了（印刷後はタブを閉じて破棄してください）`, 'success');
  },

  showLedgerPreview(elements) {
    const section = document.getElementById('ledger-preview-section');
    const container = document.getElementById('ledger-canvases');
    container.innerHTML = '';
    elements.forEach((el, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'ledger-item';
      wrap.dataset.idx = String(i);
      const toolbar = document.createElement('div');
      toolbar.className = 'ledger-item-toolbar';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary btn-print-single';
      btn.textContent = `🖨️ この台帳を印刷（${i + 1}/${elements.length}）`;
      btn.addEventListener('click', () => this.printSingleLedger(wrap));
      toolbar.appendChild(btn);
      wrap.appendChild(toolbar);
      wrap.appendChild(el);
      container.appendChild(wrap);
    });
    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth' });
  },

  printSingleLedger(wrap) {
    const all = document.querySelectorAll('#ledger-canvases .ledger-item');
    all.forEach(el => {
      if (el !== wrap) el.classList.add('print-hidden');
    });
    const restore = () => {
      all.forEach(el => el.classList.remove('print-hidden'));
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 2000);
    window.print();
  },

  // ===== ステータス =====
  setStatus(msg, type = 'info') {
    const bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.className = 'show ' + type;
    if (type === 'success') setTimeout(() => this.clearStatus(), 3000);
  },
  clearStatus() {
    document.getElementById('status-bar').className = '';
  },
};

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 初期化
document.addEventListener('DOMContentLoaded', () => App.init());
// window.Appとして公開（beforeunload用）
window.App = App;

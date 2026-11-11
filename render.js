/* ============================================================
 * render.js - HTML/CSSでトリアージ台帳を描画
 * Canvas版から置き換え。divを返す。
 * ============================================================ */

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function nl2br(s) {
  return esc(s).replace(/\n/g, '<br>');
}

// 判定される選択肢は◯または✓で表示
function mark(selected) {
  return selected ? '<span class="mark">◯</span>' : '';
}
function check(selected) {
  return selected ? '<span class="check">✓</span>' : '';
}
// 選択された選択肢自体を○で囲む（紙の台帳スタイル）
function sel(text, isSelected) {
  if (!text) return '';
  return isSelected ? `<span class="sel">${text}</span>` : text;
}

const Renderer = {
  /**
   * トリアージ台帳のHTML要素を生成（1患者1枚）
   * 戻り値: div要素
   */
  renderTriage(rec) {
    const data = rec.data || {};
    const res = rec.res || {};
    const decision = rec.decision || res.decision || '応需';

    const genderM = data.gender === '1';
    const genderF = data.gender === '2';
    const histYes = rec.history_yn === '有';
    const histNo = !histYes;
    const histDept = (rec.history_dept || '').replace(/科$/, '');

    const isAccept = decision === '応需';
    const isReject = decision === '不応需';

    // 初期対応
    const initWatch  = isAccept && res.init === '当直医';
    const initER     = isAccept && res.init === '救急科';
    const initOther  = isAccept && res.init === 'その他';
    const initOtherTxt = (res.init_other || '').replace(/科$/, '');

    // 転帰
    const outAdmit = isAccept && res.out === '入院';
    const outHome  = isAccept && res.out === '帰宅';
    const outOther = isAccept && res.out === 'その他';

    // 病棟
    const ward4H   = outAdmit && res.ward === '4東';
    const wardHCU  = outAdmit && res.ward === 'HCU';
    const wardICU  = outAdmit && res.ward === 'ICU';
    const wardOther = outAdmit && res.ward === 'その他';
    const wardOtherTxt = res.ward_other || '';

    // 主科
    const mainRin = outAdmit && res.main === '臨研';
    const mainER  = outAdmit && res.main === '救急科';
    const mainOther = outAdmit && res.main === 'その他';
    const mainOtherTxt = (res.main_other || '').replace(/科$/, '');

    // 不応需理由（番号で比較・古い「既定の応需不可症例」表記にも対応）
    const reason = res.reason || '';
    const reasonPrefix = reason.split(/[\s　]/)[0];  // "3."
    const r = (prefix) => isReject && reasonPrefix === prefix;

    // 2. ベッド満床のサブ選択
    const bedSub = res.bed_sub || '';
    const bedER   = r('2.') && bedSub === '救急外来';
    const bedHCU  = r('2.') && bedSub === 'HCU';
    const bed4H   = r('2.') && bedSub === '4東';
    const bedOther = r('2.') && bedSub === 'その他';
    // 3~7のコメント
    const comment = isReject ? (res.reason_comment || '') : '';

    // 依頼日時のシフト判定（dt_strから）
    const shiftId = (typeof Parser !== 'undefined' && Parser.getShiftIdentity)
      ? Parser.getShiftIdentity(data.dt_str || '')
      : null;
    const isDay = shiftId && shiftId.shift === '日勤';
    const isNight = shiftId && shiftId.shift === '夜勤';

    const div = document.createElement('div');
    div.className = 'triage-ledger';
    div.innerHTML = `
      <div class="t-row t-header">
        <div class="t-cell t-no">
          <div class="t-label-top">No.</div>
          <div class="t-value t-no-value">${esc(rec.case_no || '')}</div>
        </div>
        <div class="t-cell t-title">トリアージ台帳</div>
        <div class="t-cell t-recorder">
          <div class="t-label-top">記載者</div>
          <div class="t-value">${esc(rec.recorder || '')}</div>
        </div>
        <div class="t-cell t-stamp">
          <div class="t-label-top">確認印</div>
          <div class="t-value"></div>
        </div>
      </div>

      <div class="t-row">
        <div class="t-cell t-label t-dt-label">
          <div>依頼日時</div>
          <div class="t-dt-shift"><small>(${sel('日勤', isDay)}・${sel('夜勤', isNight)})</small></div>
        </div>
        <div class="t-cell t-value t-wide">${esc(data.dt_str || '')}</div>
        <div class="t-cell t-label">依頼元</div>
        <div class="t-cell t-value">${esc(rec.origin || '')} <span class="t-suffix">救急隊</span></div>
        <div class="t-cell t-label">受診歴</div>
        <div class="t-cell t-value t-hist">
          ${sel('有', histYes)} (${histDept ? esc(histDept) : '　　　　　　　　'})科 ・ ${sel('無', histNo)}
        </div>
      </div>

      <div class="t-row">
        <div class="t-cell t-label t-patientname-label">患者名</div>
        <div class="t-cell t-value t-patientname">
          <div class="t-kana">${esc(data.kana || '')}</div>
          <div class="t-kanji">${esc(data.kanji || '')}</div>
        </div>
        <div class="t-cell t-sublabel">生年月日</div>
        <div class="t-cell t-value t-birth">
          ${esc(data.birth_y || '')}年 ${esc(data.birth_m || '')}月 ${esc(data.birth_d || '')}日
        </div>
      </div>
      <div class="t-row">
        <div class="t-cell t-sublabel t-age-label">年齢</div>
        <div class="t-cell t-value t-age">${esc(data.age || '')} 歳</div>
        <div class="t-cell t-value t-gender">
          ${sel('男', genderM)} ・ ${sel('女', genderF)}
        </div>
      </div>

      <div class="t-row">
        <div class="t-cell t-label">主訴</div>
        <div class="t-cell t-value t-complaint" colspan-x="full">${esc(data.complaint || '')}</div>
      </div>

      <div class="t-row t-main-row">
        <div class="t-cell t-label">経過等</div>
        <div class="t-cell t-value t-history">${nl2br(data.history || '')}</div>
        <div class="t-cell t-vitals-wrap">
          <div class="t-vitals-title">バイタルサイン</div>
          <table class="t-vitals">
            <tr><th>酸素</th><td>${sel(`有 ${esc(data.o2_flow || '')}LPM`, !!data.o2_flow)}<br>${sel('無', !data.o2_flow)}</td></tr>
            <tr><th>意識</th><td>JCS ${esc(data.jcs || '')}</td></tr>
            <tr><th>RR</th><td>${esc(data.rr || '')} <small>回/分</small></td></tr>
            <tr><th>HR</th><td>${esc(data.hr || '')} <small>回/分</small></td></tr>
            <tr><th>BP</th><td>${esc(data.bp_s || '')}/${esc(data.bp_d || '')} <small>mmHg</small></td></tr>
            <tr><th>SpO2</th><td>${esc(data.spo2 || '')} <small>%</small></td></tr>
            <tr><th>BT</th><td>${esc(data.bt || '')} <small>℃</small></td></tr>
          </table>
        </div>
      </div>

      <div class="t-row">
        <div class="t-cell t-label t-decision-label">
          <div>${sel('応需', isAccept)}</div>
          <div>・</div>
          <div>${sel('不応需', isReject)}</div>
        </div>
        <div class="t-cell t-value t-init-wrap" colspan-x="full">
          <div class="t-init-row">
            <div class="t-sublabel">初期対応した科</div>
            <div class="t-init-opts">
              ・${sel('当直医', initWatch)}
              ・${sel('救急科', initER)}
              ・${sel('その他', initOther)} (${initOtherTxt ? esc(initOtherTxt) : '　　　　　　'})科
            </div>
          </div>
          <div class="t-out-row">
            <div class="t-sublabel">最終転帰</div>
            <div class="t-out-opts">
              <div>・${sel('入院', outAdmit)}</div>
              <div>・${sel('帰宅', outHome)}</div>
              <div>・${sel('その他', outOther)}</div>
              <div>(${(res.out_other && res.out_other.trim()) ? esc(res.out_other) : '　　　　　'})</div>
            </div>
            <div class="t-sublabel">入院の場合</div>
            <div class="t-ward-opts">
              <div>病棟：・${sel('4東', ward4H)}　・${sel('HCU', wardHCU)}　・${sel('ICU', wardICU)}</div>
              <div>・${sel(`${wardOtherTxt ? esc(wardOtherTxt) : '(　　　　　　)'}病棟`, wardOther)}</div>
              <div>主科：・${sel('臨研', mainRin)}　・${sel('救急科', mainER)}</div>
              <div>・${sel(`(${mainOtherTxt ? esc(mainOtherTxt) : '　　　　　　'})科`, mainOther)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="t-row">
        <div class="t-cell t-label">不応需<br>理由</div>
        <div class="t-cell t-value t-reasons">
          <div>${sel('1. 緊急性なし', r('1.'))}</div>
          <div>${sel('2. ベッド満床', r('2.'))}：
            ・${sel('救急外来', bedER)}　・${sel('HCU', bedHCU)}　・${sel('4東', bed4H)}　・${sel('その他', bedOther)}
          </div>
          <div>${sel('3. 既定の応需不可', r('3.'))}： ${esc(r('3.') ? comment : '')}</div>
          <div>${sel('4. 対応可能な医師不在', r('4.'))}： ${esc(r('4.') ? comment : '')}</div>
          <div>${sel('5. 緊急手術制限中', r('5.'))}： ${esc(r('5.') ? comment : '')}</div>
          <div>${sel('6-A. 医師処置中につき対応困難', r('6-A.'))}： ${esc(r('6-A.') ? comment : '')}</div>
          <div>${sel('6-B. 看護師処置中につき対応困難', r('6-B.'))}： ${esc(r('6-B.') ? comment : '')}</div>
          <div>${sel('7. その他', r('7.'))}： ${esc(r('7.') ? comment : '')}</div>
        </div>
      </div>

      <div class="t-row t-freenote-row">
        <div class="t-cell t-label">自由<br>記載</div>
        <div class="t-cell t-value t-freenote">${nl2br(rec.free_note || '')}</div>
      </div>
    `;
    return div;
  },
};

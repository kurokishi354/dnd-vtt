// ============================= BATTLE CALC =================================
// Modul "🧮 Kalkulator Battle": alat bantu hitung manual buat battle, dipakai
// bareng di DM Board & Character Sheet. 3 tab:
//   1) 🎯 To-Hit & Damage — hitung d20 vs AC (manual/adv/disadv) + roll damage
//      (auto-double kalau crit), lalu bisa "Isi ke Aksi Roll" biar formula &
//      target-nya kecopy ke panel Aksi Roll asli (yang beneran nge-apply ke HP).
//   2) 🎲 Dice Cepat — kalkulator dice umum (mendukung banyak term, mis.
//      "2d6+1d4+3"), + mode Advantage/Disadvantage (roll 2x, ambil total
//      terbaik/terburuk), plus riwayat roll sekilas.
//   3) 📊 Statistik Battle — dashboard hit/miss/crit/akurasi & total damage-
//      heal (dealt/taken) per nama, dibaca langsung dari state.battle.stats.
// Murni sisi klien: gak nyimpen apa pun ke server sendiri (kecuali tombol
// Reset Statistik yang pakai event server yang sudah ada). Include SETELAH
// battle-fx.js, SEBELUM dm.js / character.js.
(function () {
  let opts = null;
  let modalEl = null;
  let activeTab = 'hit';
  let lastHit = null; // { crit: bool } dari roll to-hit terakhir, buat auto-double damage
  let diceHistory = [];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ensureStyle() {
    if (document.getElementById('bcalcStyle')) return;
    const style = document.createElement('style');
    style.id = 'bcalcStyle';
    style.textContent = `
      .bcalc-box { max-width: 560px; }
      .bcalc-tabs { display:flex; gap:4px; margin:10px 0 0; flex-wrap:wrap; }
      .bcalc-tab { padding:6px 10px; border:1px solid var(--gold); background:var(--parchment-dark); border-radius:6px 6px 0 0; cursor:pointer; font-size:12px; font-family:'Cinzel',serif; }
      .bcalc-tab.active { background:var(--gold); color:#fff; }
      .bcalc-pane { border:1px solid var(--gold); border-radius:0 6px 6px 6px; padding:12px; }
      .bcalc-row { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; align-items:flex-end; }
      .bcalc-field { display:flex; flex-direction:column; gap:2px; flex:1; min-width:100px; }
      .bcalc-field label { font-size:10px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.03em; }
      .bcalc-result { border:1px dashed var(--gold); border-radius:6px; padding:8px 10px; font-size:13px; margin-top:4px; min-height:20px; }
      .bcalc-result .big { font-size:20px; font-weight:700; color:var(--navy); }
      .bcalc-result.hit .big { color:var(--emerald); }
      .bcalc-result.crit .big { color:var(--gold-bright); }
      .bcalc-result.miss .big { color:var(--crimson-bright); }
      .bcalc-hist { max-height:130px; overflow-y:auto; margin-top:8px; font-size:12px; }
      .bcalc-hist-row { padding:3px 0; border-bottom:1px dotted var(--gold); }
      .bcalc-hist-row:last-child { border-bottom:none; }
      table.bcalc-stats-table { width:100%; border-collapse:collapse; font-size:12px; }
      table.bcalc-stats-table th { background:var(--gold); color:#fff; padding:5px 6px; text-align:left; font-family:'Cinzel',serif; font-weight:600; }
      table.bcalc-stats-table td { padding:4px 6px; border-bottom:1px solid rgba(220,190,120,.3); }
      table.bcalc-stats-table tr:nth-child(even) td { background: rgba(220,190,120,.08); }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    ensureStyle();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'battleCalcModal';
    backdrop.innerHTML = `
      <div class="modal-box bcalc-box">
        <div class="row" style="justify-content:space-between; align-items:center; margin:0;">
          <h2 style="margin:0;">🧮 Kalkulator Battle</h2>
          <button type="button" class="small secondary" id="bcalcCloseBtn">✖ Tutup</button>
        </div>
        <p class="hint" style="margin:2px 0 0;">Alat bantu hitung manual — gak langsung ubah HP/MP/SP siapa pun kecuali kamu pilih "Isi ke Aksi Roll".</p>
        <div class="bcalc-tabs">
          <button type="button" class="bcalc-tab" data-bctab="hit">🎯 To-Hit &amp; Damage</button>
          <button type="button" class="bcalc-tab" data-bctab="dice">🎲 Dice Cepat</button>
          <button type="button" class="bcalc-tab" data-bctab="stats">📊 Statistik</button>
        </div>
        <div class="bcalc-pane" id="bcalcPane"></div>
      </div>`;
    document.body.appendChild(backdrop);
    modalEl = backdrop;

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('#bcalcCloseBtn').addEventListener('click', closeModal);
    backdrop.querySelectorAll('.bcalc-tab').forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.bctab; renderActiveTab(); });
    });
    return modalEl;
  }

  function setActiveTabButtons() {
    modalEl.querySelectorAll('.bcalc-tab').forEach(b => b.classList.toggle('active', b.dataset.bctab === activeTab));
  }

  // ---------- Dice roll helpers (klien, terpisah dari server — buat preview cepat) ----------
  function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

  function parseDiceExpr(expr) {
    const s = String(expr || '').trim();
    if (!s) return { total: 0, detail: '0' };
    const norm = (s[0] === '+' || s[0] === '-') ? s : '+' + s;
    const tokens = norm.match(/[+-][^+-]+/g) || [];
    let total = 0;
    const parts = [];
    tokens.forEach(tok => {
      const sign = tok[0] === '-' ? -1 : 1;
      const body = tok.slice(1).trim();
      const m = body.match(/^(\d*)d(\d+)$/i);
      if (m) {
        const n = Math.min(100, parseInt(m[1] || '1', 10));
        const sides = parseInt(m[2], 10);
        const rolls = [];
        let sum = 0;
        for (let i = 0; i < n; i++) { const r = rollDie(sides); rolls.push(r); sum += r; }
        total += sign * sum;
        parts.push(`${sign < 0 ? '-' : (parts.length ? '+' : '')}${n}d${sides}(${rolls.join(',')})`);
      } else {
        const flat = parseFloat(body);
        if (!isNaN(flat)) {
          total += sign * flat;
          parts.push(`${sign < 0 ? '-' : (parts.length ? '+' : '')}${flat}`);
        }
      }
    });
    return { total, detail: parts.join(' ') || String(total) };
  }

  // ---------- Tab 1: To-Hit & Damage ----------
  function getBattleEntries() {
    const state = (opts.getState && opts.getState()) || {};
    return (state.battle && state.battle.entries) || {};
  }

  function renderHitTab() {
    const entries = getBattleEntries();
    const options = Object.values(entries)
      .map(e => `<option value="${e.id}" data-ac="${e.ac != null ? e.ac : ''}">${escapeHtml(e.name)}${e.ac != null && e.ac !== '' ? ' (AC ' + e.ac + ')' : ''}</option>`)
      .join('');
    return `
      <div class="bcalc-row">
        <div class="bcalc-field">
          <label>Target (opsional)</label>
          <select id="bcalcTarget"><option value="">— manual —</option>${options}</select>
        </div>
        <div class="bcalc-field">
          <label>AC</label>
          <input type="number" id="bcalcAc" placeholder="AC target">
        </div>
      </div>
      <div class="bcalc-row">
        <div class="bcalc-field">
          <label>Bonus To-Hit</label>
          <input type="number" id="bcalcToHit" value="0">
        </div>
        <div class="bcalc-field">
          <label>Mode</label>
          <select id="bcalcHitMode">
            <option value="normal">Normal</option>
            <option value="adv">🔼 Advantage</option>
            <option value="disadv">🔽 Disadvantage</option>
          </select>
        </div>
        <button type="button" class="small" id="bcalcRollHit" style="flex:none;">🎲 Roll d20</button>
      </div>
      <div class="bcalc-result" id="bcalcHitResult">Belum ada roll.</div>
      <hr style="border-color:var(--gold); opacity:.4; margin:12px 0;">
      <div class="bcalc-row">
        <div class="bcalc-field" style="flex:2;">
          <label>Formula Damage</label>
          <input type="text" id="bcalcDmgFormula" placeholder="mis. 1d8+3">
        </div>
        <button type="button" class="small" id="bcalcRollDmg" style="flex:none;">🎲 Roll Damage</button>
      </div>
      <label class="hint" style="display:flex; align-items:center; gap:5px; margin:0 0 6px;">
        <input type="checkbox" id="bcalcAutoCrit" checked style="width:auto;"> Auto-double kalau to-hit terakhir CRIT
      </label>
      <div class="bcalc-result" id="bcalcDmgResult">Belum ada roll.</div>
      <button type="button" class="small secondary" id="bcalcFillPanel" style="width:100%; margin-top:10px;">📋 Isi ke Aksi Roll</button>
      <p class="hint" style="margin-top:6px;">Ini cuma preview cepat — target masih di-roll ulang (to-hit vs AC) oleh server pas kamu tekan "Roll &amp; Terapkan" di panel Aksi Roll, biar tetap fair/anti-nyontek.</p>
    `;
  }

  function wireHitTab() {
    const targetSel = document.getElementById('bcalcTarget');
    const acInput = document.getElementById('bcalcAc');
    targetSel.addEventListener('change', () => {
      const opt = targetSel.options[targetSel.selectedIndex];
      const ac = opt && opt.dataset ? opt.dataset.ac : '';
      if (ac) acInput.value = ac;
    });

    document.getElementById('bcalcRollHit').addEventListener('click', () => {
      const bonus = parseFloat(document.getElementById('bcalcToHit').value) || 0;
      const mode = document.getElementById('bcalcHitMode').value;
      const ac = parseFloat(acInput.value);
      const r1 = rollDie(20);
      let picked = r1, rollsTxt = `d20=${r1}`;
      if (mode !== 'normal') {
        const r2 = rollDie(20);
        picked = mode === 'adv' ? Math.max(r1, r2) : Math.min(r1, r2);
        rollsTxt = `d20=${r1}/${r2} → ambil ${picked} (${mode === 'adv' ? 'Advantage' : 'Disadvantage'})`;
      }
      const total = picked + bonus;
      let crit = picked === 20, fumble = picked === 1;
      let hit = crit || (!fumble && !isNaN(ac) && total >= ac);
      lastHit = { crit };
      const box = document.getElementById('bcalcHitResult');
      box.className = 'bcalc-result ' + (fumble ? 'miss' : crit ? 'crit' : hit ? 'hit' : (isNaN(ac) ? '' : 'miss'));
      const vsAc = isNaN(ac) ? '(isi AC buat cek hit/miss)' : `vs AC ${ac} → ${fumble ? '❌ FUMBLE (auto-meleset)' : crit ? '💢 CRITICAL HIT!' : hit ? '🎯 KENA' : '❌ MELESET'}`;
      box.innerHTML = `${rollsTxt} ${bonus ? (bonus > 0 ? '+' + bonus : bonus) : ''} = <span class="big">${total}</span><br>${vsAc}`;
    });

    document.getElementById('bcalcRollDmg').addEventListener('click', () => {
      const formula = document.getElementById('bcalcDmgFormula').value.trim() || '1d6';
      const autoCrit = document.getElementById('bcalcAutoCrit').checked;
      const roll = parseDiceExpr(formula);
      const doubled = autoCrit && lastHit && lastHit.crit;
      const total = doubled ? roll.total * 2 : roll.total;
      const box = document.getElementById('bcalcDmgResult');
      box.className = 'bcalc-result';
      box.innerHTML = `${formula}: ${roll.detail} = ${roll.total}${doubled ? ` × 2 (CRIT) = <span class="big">${total}</span>` : ` = <span class="big">${total}</span>`}`;
    });

    document.getElementById('bcalcFillPanel').addEventListener('click', () => {
      const f = (opts && opts.fields) || {};
      const formula = document.getElementById('bcalcDmgFormula').value.trim();
      const toHit = document.getElementById('bcalcToHit').value;
      const targetId = document.getElementById('bcalcTarget').value;
      if (f.formula && formula) { const el = document.getElementById(f.formula); if (el) el.value = formula; }
      if (f.type) { const el = document.getElementById(f.type); if (el) el.value = 'damage'; }
      if (f.toHit && toHit) { const el = document.getElementById(f.toHit); if (el) el.value = toHit; }
      if (f.target && targetId) { const el = document.getElementById(f.target); if (el) el.value = targetId; }
      closeModal();
      if (typeof opts.onFilled === 'function') opts.onFilled();
    });
  }

  // ---------- Tab 2: Dice Cepat ----------
  function renderDiceTab() {
    const histHtml = diceHistory.length
      ? diceHistory.map(h => `<div class="bcalc-hist-row">${escapeHtml(h)}</div>`).join('')
      : '<p class="hint" style="margin:0;">Belum ada riwayat.</p>';
    return `
      <div class="bcalc-row">
        <div class="bcalc-field" style="flex:2;">
          <label>Formula (mis. 2d6+1d4+3)</label>
          <input type="text" id="bcalcDiceExpr" placeholder="mis. 1d20+5">
        </div>
        <div class="bcalc-field">
          <label>Mode</label>
          <select id="bcalcDiceMode">
            <option value="normal">Normal</option>
            <option value="adv">🔼 Advantage</option>
            <option value="disadv">🔽 Disadvantage</option>
          </select>
        </div>
        <button type="button" class="small" id="bcalcRollDice" style="flex:none;">🎲 Roll</button>
      </div>
      <div class="bcalc-result" id="bcalcDiceResult">Belum ada roll.</div>
      <div class="row" style="margin-top:8px;">
        <button type="button" class="small secondary" id="bcalcClearHist" style="width:100%;">Bersihkan Riwayat</button>
      </div>
      <div class="bcalc-hist" id="bcalcHist">${histHtml}</div>
    `;
  }

  function wireDiceTab() {
    document.getElementById('bcalcRollDice').addEventListener('click', () => {
      const expr = document.getElementById('bcalcDiceExpr').value.trim() || '1d20';
      const mode = document.getElementById('bcalcDiceMode').value;
      const box = document.getElementById('bcalcDiceResult');
      let line;
      if (mode === 'normal') {
        const r = parseDiceExpr(expr);
        line = `${expr}: ${r.detail} = <span class="big">${r.total}</span>`;
        diceHistory.unshift(`${expr} → ${r.total} (${r.detail})`);
      } else {
        const r1 = parseDiceExpr(expr);
        const r2 = parseDiceExpr(expr);
        const best = mode === 'adv' ? Math.max(r1.total, r2.total) : Math.min(r1.total, r2.total);
        const label = mode === 'adv' ? 'Advantage' : 'Disadvantage';
        line = `${expr} (${label}): ${r1.total} / ${r2.total} → <span class="big">${best}</span>`;
        diceHistory.unshift(`${expr} [${label}] → ${best} (${r1.total} vs ${r2.total})`);
      }
      diceHistory = diceHistory.slice(0, 8);
      box.innerHTML = line;
      document.getElementById('bcalcHist').innerHTML = diceHistory.map(h => `<div class="bcalc-hist-row">${escapeHtml(h)}</div>`).join('');
    });
    document.getElementById('bcalcClearHist').addEventListener('click', () => {
      diceHistory = [];
      document.getElementById('bcalcHist').innerHTML = '<p class="hint" style="margin:0;">Belum ada riwayat.</p>';
    });
  }

  // ---------- Tab 3: Statistik Battle ----------
  function renderStatsTab() {
    const state = (opts.getState && opts.getState()) || {};
    const stats = (state.battle && state.battle.stats) || {};
    const rows = Object.entries(stats)
      .map(([name, s]) => ({
        name,
        hits: s.hits || 0, misses: s.misses || 0, crits: s.crits || 0,
        dmgDealt: s.dmgDealt || 0, healDone: s.healDone || 0,
        dmgTaken: s.dmgTaken || 0, healReceived: s.healReceived || 0
      }))
      .sort((a, b) => b.dmgDealt - a.dmgDealt);
    const acc = r => (r.hits + r.misses) ? Math.round((r.hits / (r.hits + r.misses)) * 100) + '%' : '-';
    const tableRows = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.hits}/${r.misses}${r.crits ? ` (${r.crits} crit)` : ''}</td>
        <td>${acc(r)}</td>
        <td>${r.dmgDealt}</td>
        <td>${r.healDone}</td>
        <td>${r.dmgTaken}</td>
        <td>${r.healReceived}</td>
      </tr>`).join('');
    const resetBtn = (opts.role === 'dm' && typeof opts.resetStats === 'function')
      ? `<button type="button" class="small secondary" id="bcalcResetStats" style="width:100%; margin-bottom:8px;">🔄 Reset Statistik</button>`
      : '';
    if (!rows.length) {
      return `${resetBtn}<p class="hint" style="margin:0;">Belum ada statistik — mulai battle &amp; lakukan Aksi Roll dulu.</p>`;
    }
    return `${resetBtn}
      <div style="overflow-x:auto;">
        <table class="bcalc-stats-table">
          <thead><tr><th>Nama</th><th>Hit/Miss</th><th>Akurasi</th><th>Dmg Dealt</th><th>Heal Done</th><th>Dmg Taken</th><th>Heal Recv.</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }

  function wireStatsTab() {
    const btn = document.getElementById('bcalcResetStats');
    if (btn) btn.addEventListener('click', () => {
      if (opts.resetStats) opts.resetStats();
      setTimeout(renderActiveTab, 150);
    });
  }

  function renderActiveTab() {
    if (!modalEl) return;
    setActiveTabButtons();
    const pane = document.getElementById('bcalcPane');
    if (activeTab === 'hit') { pane.innerHTML = renderHitTab(); wireHitTab(); }
    else if (activeTab === 'dice') { pane.innerHTML = renderDiceTab(); wireDiceTab(); }
    else { pane.innerHTML = renderStatsTab(); wireStatsTab(); }
  }

  function closeModal() { if (modalEl) modalEl.classList.remove('show'); }

  function openModal(tab) {
    ensureModal();
    activeTab = tab || activeTab || 'hit';
    renderActiveTab();
    modalEl.classList.add('show');
  }

  // init(o): o = { getState, role: 'dm'|'player', fields: {formula,target,type,toHit}, resetStats, onFilled }
  function init(o) { opts = o || {}; }

  // Dipanggil host page tiap kali battle-updated diterima, biar tab Statistik &
  // dropdown Target di tab To-Hit ikut ter-refresh kalau modal lagi kebuka.
  function refresh() {
    if (modalEl && modalEl.classList.contains('show')) renderActiveTab();
  }

  window.BattleCalc = { init, open: openModal, close: closeModal, refresh };
})();

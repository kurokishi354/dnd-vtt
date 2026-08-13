// dm.js — DM Board logic (v2 rewrite)
const socket = io();
const CODE = localStorage.getItem('dnd_dm_code');
if (!CODE) location.href = '/';

document.getElementById('codeBadge').textContent = CODE;
document.getElementById('joinLink').value = location.origin + '/  (kode: ' + CODE + ')';

const ELEMENT_KEYS = ['fire','ice','lightning','poison','dark','light','physical','magic'];

let state = {
  players: {}, playersList: [],
  npcs: {}, classes: {}, map: {}, maps: {},
  tokens: {}, battle: { entries: {}, turn: { activeId: null, round: 1 } },
  music: { tracks: {}, playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false } },
  shop: { items: {} }, log: [], notes: ''
};
let currentMapTabId = 'main';

// =============================== TABS ==================================
function showDmTab(name) {
  ['main','players','npc','classes','shop','music','battle','map'].forEach(t => {
    document.getElementById('tab-dm-' + t).style.display = t === name ? '' : 'none';
  });
  document.querySelectorAll('.page-tabs button').forEach(b => b.classList.remove('active'));
  const btnMap = { main:'tabBtnDmMain', players:'tabBtnDmPlayers', npc:'tabBtnDmNpc', classes:'tabBtnDmClasses', shop:'tabBtnDmShop', music:'tabBtnDmMusic', battle:'tabBtnDmBattle', map:'tabBtnDmMap' };
  const btn = document.getElementById(btnMap[name]); if (btn) btn.classList.add('active');
  if (name === 'map') renderMap();
}
document.getElementById('tabBtnDmMain').addEventListener('click', () => showDmTab('main'));
document.getElementById('tabBtnDmPlayers').addEventListener('click', () => showDmTab('players'));
document.getElementById('tabBtnDmNpc').addEventListener('click', () => showDmTab('npc'));
document.getElementById('tabBtnDmClasses').addEventListener('click', () => showDmTab('classes'));
document.getElementById('tabBtnDmShop').addEventListener('click', () => showDmTab('shop'));
document.getElementById('tabBtnDmMusic').addEventListener('click', () => showDmTab('music'));
document.getElementById('tabBtnDmBattle').addEventListener('click', () => showDmTab('battle'));
document.getElementById('tabBtnDmMap').addEventListener('click', () => showDmTab('map'));

// Search & sort listeners
document.getElementById('playerSearch').addEventListener('input', renderPlayers);
document.getElementById('playerSort').addEventListener('change', renderPlayers);
document.getElementById('npcSearch').addEventListener('input', renderNpcs);
document.getElementById('npcSort').addEventListener('change', renderNpcs);
document.getElementById('classSearch').addEventListener('input', renderClasses);
document.getElementById('classSort').addEventListener('change', renderClasses);
document.getElementById('shopSearch').addEventListener('input', renderShop);
document.getElementById('shopSort').addEventListener('change', renderShop);
document.getElementById('musicSearch').addEventListener('input', renderMusic);

// =============================== CONNECT ===============================
socket.on('connect', () => {
  setConn(true);
  socket.emit('dm:rejoin-session', { code: CODE }, (res) => {
    if (!res.ok) { alert(res.error || 'Sesi tidak ditemukan.'); location.href = '/'; return; }
    state = res.state;
    state.playersList = state.playersList || Object.values(state.players).map(p => ({ id: p.id, name: p.name, online: !!p.socketId, nama_karakter: p.sheet.nama_karakter, kelas: p.sheet.kelas, lv: p.sheet.lv, current_hp: p.sheet.current_hp, max_hp: p.sheet.max_hp }));
    renderAll();
  });
});
socket.on('disconnect', () => setConn(false));
function setConn(ok) {
  const el = document.getElementById('connBadge');
  el.textContent = ok ? 'terhubung' : 'terputus';
  el.className = 'badge ' + (ok ? 'online' : 'offline');
}

document.getElementById('btnCopyCode').onclick = () => {
  navigator.clipboard.writeText(CODE).then(() => {
    const b = document.getElementById('btnCopyCode');
    b.textContent = 'Tersalin!'; setTimeout(() => b.textContent = 'Salin Kode', 1200);
  });
};

// =============================== UTIL ==================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const escapeAttr = escapeHtml;
function barPct(cur, max) { const m = parseFloat(max), c = parseFloat(cur); if (!m || isNaN(m)) return 0; return Math.max(0, Math.min(100, (isNaN(c) ? m : c) / m * 100)); }

// =============================== PLAYERS ==============================
socket.on('players-update', (players) => {
  state.playersList = players;
  renderPlayers(); refreshBattleSourceOptions(); refreshTokenOwnerOptions();
  // Broadcast to player pages
  socket.emit('dm:broadcast-players-list', { code: CODE });
});
let openPlayerId = null;
socket.on('sheet-updated', ({ playerId, sheet }) => {
  if (state.players[playerId]) state.players[playerId].sheet = sheet;
  if (playerId === openPlayerId) {
    document.getElementById('playerModalBody').innerHTML = renderSheetReadonly(sheet);
    document.getElementById('currentGoldLabel').textContent = sheet.gold || '0';
  }
});
socket.on('player-online', ({ id, online }) => {
  const p = (state.playersList || []).find(p => p.id === id);
  if (p) p.online = online;
  renderPlayers();
});

function renderPlayers() {
  let list = (state.playersList || []).slice();
  const q = (document.getElementById('playerSearch')?.value || '').toLowerCase().trim();
  if (q) list = list.filter(p => (p.nama_karakter||'').toLowerCase().includes(q) || (p.name||'').toLowerCase().includes(q));
  const sort = document.getElementById('playerSort')?.value || 'name';
  list.sort((a,b) => {
    if (sort === 'hp') {
      const pa = (parseInt(a.max_hp,10)||0) ? (parseInt(a.current_hp,10)||0)/(parseInt(a.max_hp,10)||1) : 1;
      const pb = (parseInt(b.max_hp,10)||0) ? (parseInt(b.current_hp,10)||0)/(parseInt(b.max_hp,10)||1) : 1;
      return pa - pb;
    }
    if (sort === 'level') return (parseInt(b.lv,10)||0) - (parseInt(a.lv,10)||0);
    if (sort === 'online') return (b.online?1:0) - (a.online?1:0);
    return (a.nama_karakter||a.name||'').localeCompare(b.nama_karakter||b.name||'');
  });
  document.getElementById('playerCount').textContent = (state.playersList || []).length;
  const box = document.getElementById('playerList');
  if (!list.length) { box.innerHTML = `<p class="hint">${q ? 'Tidak ada pemain yang cocok.' : 'Belum ada pemain yang gabung.'}</p>`; return; }
  box.innerHTML = list.map(p => {
    const sheet = (state.players && state.players[p.id] && state.players[p.id].sheet) || {};
    const bar = (cur, max, cls, label) => {
      const m = parseInt(max, 10) || 0, c = parseInt(cur, 10);
      const pct = m ? Math.max(0, Math.min(100, (isNaN(c) ? m : c) / m * 100)) : 0;
      return `<div class="pc-bar-row"><label>${label}</label><div class="mini-bar-wrap ${cls}"><div class="mini-bar-fill" style="width:${pct}%;"></div></div><span class="pc-bar-val">${isNaN(c)?0:c}/${m||0}</span></div>`;
    };
    const conds = (sheet.condition || []).filter(c => c && c !== 'Normal');
    return `<div class="player-card" data-id="${p.id}">
      <div class="player-card-head">
        <span class="badge ${p.online ? 'online' : 'offline'}">${p.online ? '●' : '○'}</span>
        <span class="pc-name">${escapeHtml(p.nama_karakter || p.name)}</span>
        <button type="button" class="player-quick-delete" title="Hapus player" data-id="${p.id}" style="border:none; background:transparent; color:var(--crimson-bright); font-size:18px; cursor:pointer;">×</button>
      </div>
      <div class="pc-meta">Lv.${p.lv || sheet.lv || '-'} ${escapeHtml(p.kelas || sheet.kelas || '-')} · AC ${sheet.ac ?? '-'} · 🪙 ${sheet.gold ?? '0'}</div>
      <div class="pc-bars">
        ${bar(p.current_hp ?? sheet.current_hp, p.max_hp ?? sheet.max_hp, 'hp', 'HP')}
        ${bar(sheet.mp_current, sheet.mp_max, 'mp', 'MP')}
        ${bar(sheet.sp_current, sheet.sp_max, 'sp', 'SP')}
      </div>
      ${conds.length ? `<div class="pc-foot">🌀 ${escapeHtml(conds.join(', '))}</div>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('.player-card').forEach(el => {
    el.onclick = (e) => { if (e.target.closest('.player-quick-delete')) return; openPlayerModal(el.dataset.id); };
  });
  box.querySelectorAll('.player-quick-delete').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); confirmDeletePlayer(btn.dataset.id); };
  });
}

function openPlayerModal(playerId) {
  openPlayerId = playerId;
  const pData = (state.playersList || []).find(p => p.id === playerId);
  const fullData = (state.players || {})[playerId];
  const sheet = fullData?.sheet || {};
  document.getElementById('playerModalTitle').textContent = escapeHtml(pData?.nama_karakter || pData?.name || 'Player');
  document.getElementById('giveItem_playerId').value = playerId;
  document.getElementById('currentGoldLabel').textContent = sheet.gold || '0';
  document.getElementById('progress_lv').value = sheet.lv || '';
  document.getElementById('progress_exp').value = sheet.exp || '';
  document.getElementById('progress_kelas_exp').value = sheet.kelas_exp || '';
  renderClassUnlockList(fullData?.unlockedClasses || []);
  document.getElementById('playerModalBody').innerHTML = renderSheetReadonly(sheet);
  document.getElementById('playerModal').classList.add('show');
}
document.getElementById('btnClosePlayerModal').onclick = () => { document.getElementById('playerModal').classList.remove('show'); openPlayerId = null; };

function confirmDeletePlayer(playerId) {
  if (!confirm('Hapus player ini dari sesi?')) return;
  socket.emit('dm:remove-player', { code: CODE, playerId }, (res) => {
    if (res && res.ok) document.getElementById('playerModal').classList.remove('show');
  });
}
document.getElementById('btnDeletePlayer').onclick = () => {
  const id = document.getElementById('giveItem_playerId').value; if (!id) return;
  confirmDeletePlayer(id);
};

function renderClassUnlockList(unlockedIds) {
  const box = document.getElementById('classUnlockList');
  const list = Object.values(state.classes || {});
  if (!list.length) { box.innerHTML = '<p class="hint">Belum ada kelas.</p>'; return; }
  box.innerHTML = list.map(c =>
    `<label><input type="checkbox" class="class-unlock-box" value="${c.id}" ${unlockedIds.includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.nama)}${c.exp_req ? ` <span class="hint">(EXP: ${c.exp_req})</span>` : ''}</label>`).join('');
}

document.getElementById('btnGiveItem').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const name = document.getElementById('giveItem_name').value.trim(); if (!name) return;
  const qty = parseInt(document.getElementById('giveItem_qty').value, 10) || 1;
  const desc = document.getElementById('giveItem_desc').value.trim();
  socket.emit('dm:give-item', { code: CODE, playerId, name, qty, desc }, (res) => {
    document.getElementById('giveItemStatus').textContent = res?.ok ? `✓ Item dikirim.` : (res?.error || 'Gagal.');
  });
};
document.getElementById('btnGiveGold').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const amount = parseFloat(document.getElementById('giveGold_amount').value);
  if (isNaN(amount)) return;
  socket.emit('dm:give-gold', { code: CODE, playerId, amount }, (res) => {
    document.getElementById('giveGoldStatus').textContent = res?.ok ? `✓ Gold diperbarui.` : (res?.error || 'Gagal.');
    if (res?.ok && res.gold !== undefined) document.getElementById('currentGoldLabel').textContent = res.gold;
  });
};
document.getElementById('btnSetGold').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const amount = parseFloat(document.getElementById('setGold_amount').value);
  if (isNaN(amount)) return;
  socket.emit('dm:set-gold', { code: CODE, playerId, gold: amount }, (res) => {
    document.getElementById('giveGoldStatus').textContent = res?.ok ? `✓ Gold diset.` : (res?.error || 'Gagal.');
    if (res?.ok) document.getElementById('currentGoldLabel').textContent = amount;
  });
};
document.getElementById('btnSetProgress').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const lv = document.getElementById('progress_lv').value;
  const exp = document.getElementById('progress_exp').value;
  const kelas_exp = document.getElementById('progress_kelas_exp').value;
  socket.emit('dm:set-progress', { code: CODE, playerId, lv, exp, kelas_exp }, (res) => {
    document.getElementById('progressStatus').textContent = res?.ok ? '✓ Progress diperbarui.' : (res?.error || 'Gagal.');
  });
};
document.getElementById('btnSetUnlockedClasses').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const ids = [...document.querySelectorAll('.class-unlock-box:checked')].map(cb => cb.value);
  socket.emit('dm:set-unlocked-classes', { code: CODE, playerId, classIds: ids }, (res) => {
    document.getElementById('unlockClassStatus').textContent = res?.ok ? '✓ Kelas terbuka disimpan.' : (res?.error || 'Gagal.');
  });
};

// Give companion to player
document.getElementById('btnGiveCompanion').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const companion = {
    nama: document.getElementById('companion_nama').value.trim(),
    tipe: document.getElementById('companion_tipe').value.trim(),
    level: document.getElementById('companion_level').value,
    hp: document.getElementById('companion_hp').value,
    hp_max: document.getElementById('companion_hp_max').value,
    mp: document.getElementById('companion_mp').value,
    mp_max: document.getElementById('companion_mp_max').value,
    skill: document.getElementById('companion_skill').value.trim(),
    catatan: document.getElementById('companion_catatan').value.trim(),
    fromDM: true
  };
  if (!companion.nama) return alert('Isi nama companion dulu.');
  socket.emit('dm:give-companion', { code: CODE, playerId, companion }, (res) => {
    document.getElementById('companionStatus').textContent = res?.ok ? '✓ Companion dikirim.' : (res?.error || 'Gagal.');
  });
};

function renderSheetReadonly(sheet) {
  if (!sheet) return '<p class="hint">Belum ada data sheet.</p>';
  const ab = sheet.ability || {};
  const abStr = Object.entries(ab).map(([k,v]) => `${k.toUpperCase()}:${v.score||'-'}`).join(' · ');
  const conds = (sheet.condition || []).join(', ') || 'Normal';
  return `<div class="hint" style="line-height:1.8;">
    <strong>Ras:</strong> ${escapeHtml(sheet.ras||'-')} · <strong>Alignment:</strong> ${escapeHtml(sheet.alignment||'-')}<br>
    <strong>Ability:</strong> ${escapeHtml(abStr)}<br>
    <strong>AC:</strong> ${sheet.ac||'-'} · <strong>HP:</strong> ${sheet.current_hp||0}/${sheet.max_hp||0} · <strong>MP:</strong> ${sheet.mp_current||0}/${sheet.mp_max||0}<br>
    <strong>Condition:</strong> ${escapeHtml(conds)}<br>
    <strong>Gold:</strong> ${sheet.gold||'0'}<br>
    <strong>Catatan:</strong> ${escapeHtml(sheet.catatan_lain||'-').slice(0,120)}
  </div>`;
}

// =============================== NPC (data table) =======================
socket.on('npcs-update', (npcs) => { state.npcs = npcs; renderNpcs(); refreshBattleSourceOptions(); });

function renderNpcs() {
  let list = Object.values(state.npcs || {});
  const q = (document.getElementById('npcSearch')?.value || '').toLowerCase().trim();
  if (q) list = list.filter(n => (n.nama||'').toLowerCase().includes(q) || (n.tipe||'').toLowerCase().includes(q));
  const sort = document.getElementById('npcSort')?.value || 'name';
  list.sort((a,b) => {
    if (sort === 'hp') return (parseFloat(b.hp_current)||0) - (parseFloat(a.hp_current)||0);
    if (sort === 'ac') return (parseFloat(b.ac)||0) - (parseFloat(a.ac)||0);
    return (a.nama||'').localeCompare(b.nama||'');
  });
  const tbody = document.getElementById('npcTableBody');
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="5" class="hint">${q ? 'Tidak ada NPC yang cocok.' : 'Belum ada NPC.'}</td></tr>`; return; }
  tbody.innerHTML = list.map(n => `
    <tr data-id="${n.id}" class="npc-row">
      <td>${escapeHtml(n.nama||'-')}</td>
      <td>${escapeHtml(n.tipe||'-')}</td>
      <td>${n.ac??'-'}</td>
      <td>${n.hp_current??0}/${n.hp_max??0}</td>
      <td class="td-actions">
        <button type="button" class="small npc-battle-btn" data-id="${n.id}" title="Tambah ke Battle">⚔</button>
        <button type="button" class="small secondary npc-edit-btn" data-id="${n.id}" title="Edit">✏</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.npc-row').forEach(row => {
    row.onclick = (e) => { if (e.target.closest('button')) return; openNpcModal(state.npcs[row.dataset.id]); };
  });
  tbody.querySelectorAll('.npc-battle-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); quickAddNpcToBattle(btn.dataset.id); };
  });
  tbody.querySelectorAll('.npc-edit-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openNpcModal(state.npcs[btn.dataset.id]); };
  });
}

function quickAddNpcToBattle(npcId) {
  const n = (state.npcs || {})[npcId]; if (!n) return;
  socket.emit('dm:battle-add', { code: CODE, entry: {
    name: n.nama, type: 'enemy', roll: '', hp_max: n.hp_max, hp_current: n.hp_current,
    mp_max: n.mp_max, mp_current: n.mp_current, sp_max: n.sp_max, sp_current: n.sp_current,
    ac: n.ac, refType: 'npc', refId: n.id, elements: n.elements || {}
  }});
}

let npcEditEquip = [], npcEditInv = [];
let npcEditSkills = { active: [], passive: [], ultimate: [] };

function renderNpcEquipList() {
  const box = document.getElementById('npcEquipList'); box.innerHTML = '';
  npcEditEquip.forEach((eq, i) => {
    const row = document.createElement('div'); row.className = 'npc-equip-row';
    row.innerHTML = `<input type="text" value="${escapeAttr(eq.nama)}" placeholder="Nama weapon" data-f="nama"><input type="text" class="small-w" value="${escapeAttr(eq.atk_bonus)}" placeholder="ATK" data-f="atk_bonus"><input type="text" class="small-w" value="${escapeAttr(eq.damage)}" placeholder="DMG" data-f="damage"><button type="button" class="row-remove">×</button>`;
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', e => { eq[e.target.dataset.f] = e.target.value; }));
    row.querySelector('.row-remove').onclick = () => { npcEditEquip.splice(i,1); renderNpcEquipList(); };
    box.appendChild(row);
  });
}
function renderNpcInvList() {
  const box = document.getElementById('npcInvList'); box.innerHTML = '';
  npcEditInv.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'npc-inv-row';
    row.innerHTML = `<input type="checkbox" ${it.checked?'checked':''}><input type="text" value="${escapeAttr(it.item)}" placeholder="Nama item"><button type="button" class="row-remove">×</button>`;
    row.querySelector('input[type=checkbox]').addEventListener('change', e => { it.checked = e.target.checked; });
    row.querySelector('input[type=text]').addEventListener('input', e => { it.item = e.target.value; });
    row.querySelector('.row-remove').onclick = () => { npcEditInv.splice(i,1); renderNpcInvList(); };
    box.appendChild(row);
  });
}
document.getElementById('btnAddNpcEquip').onclick = () => { npcEditEquip.push({nama:'',atk_bonus:'',damage:''}); renderNpcEquipList(); };
document.getElementById('btnAddNpcInv').onclick = () => { npcEditInv.push({checked:false,item:''}); renderNpcInvList(); };

const NPC_SKILL_ACTION_OPTIONS = [
  ['damage','⚔ Damage'],['heal','💚 Heal'],['buff','🌀 Buff'],['debuff','🌀 Debuff'],
  ['ultimate','🔥 Ultimate'],['mana_regen','🔵 Regen Mana'],['sp_regen','🟢 Regen SP'],
  ['ac_buff','🛡 Buff AC'],['ac_debuff','🛡 Debuff AC']
];

function renderNpcSkillList(cat) {
  const ids = { active:'npcSkillActiveList', passive:'npcSkillPassiveList', ultimate:'npcSkillUltimateList' };
  const box = document.getElementById(ids[cat]); box.innerHTML = '';
  npcEditSkills[cat].forEach((sk, i) => {
    const row = document.createElement('div'); row.className = 'npc-equip-row'; row.style.flexWrap = 'wrap';
    row.innerHTML = `
      <input type="text" value="${escapeAttr(sk.nama)}" placeholder="Nama skill" data-f="nama" style="flex:2; min-width:100px;">
      <select data-f="action" style="max-width:120px;">${NPC_SKILL_ACTION_OPTIONS.map(([v,l])=>`<option value="${v}" ${sk.action===v?'selected':''}>${l}</option>`).join('')}</select>
      <input type="number" class="small-w" value="${escapeAttr(sk.mp_cost)}" placeholder="MP" data-f="mp_cost">
      <input type="number" class="small-w" value="${escapeAttr(sk.sp_cost)}" placeholder="SP" data-f="sp_cost">
      <input type="text" value="${escapeAttr(sk.formula)}" placeholder="Formula dadu" data-f="formula" style="flex:1.5; min-width:90px;">
      <button type="button" class="row-remove">×</button>`;
    row.querySelectorAll('input, select').forEach(inp => inp.addEventListener('input', e => { sk[e.target.dataset.f] = e.target.value; }));
    row.querySelector('.row-remove').onclick = () => { npcEditSkills[cat].splice(i,1); renderNpcSkillList(cat); };
    box.appendChild(row);
  });
}
document.getElementById('btnAddNpcSkillActive').onclick = () => { npcEditSkills.active.push({nama:'',action:'damage',mp_cost:'',sp_cost:'',formula:''}); renderNpcSkillList('active'); };
document.getElementById('btnAddNpcSkillPassive').onclick = () => { npcEditSkills.passive.push({nama:'',action:'buff',mp_cost:'',sp_cost:'',formula:''}); renderNpcSkillList('passive'); };
document.getElementById('btnAddNpcSkillUltimate').onclick = () => { npcEditSkills.ultimate.push({nama:'',action:'ultimate',mp_cost:'',sp_cost:'',formula:''}); renderNpcSkillList('ultimate'); };

['npc_hp_max','npc_hp_current','npc_mp_max','npc_mp_current','npc_sp_max','npc_sp_current'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById('npcHpPreview').style.width = barPct(document.getElementById('npc_hp_current').value, document.getElementById('npc_hp_max').value) + '%';
    document.getElementById('npcMpPreview').style.width = barPct(document.getElementById('npc_mp_current').value, document.getElementById('npc_mp_max').value) + '%';
    document.getElementById('npcSpPreview').style.width = barPct(document.getElementById('npc_sp_current').value, document.getElementById('npc_sp_max').value) + '%';
  });
});

function openNpcModal(npc) {
  document.getElementById('npcModalTitle').textContent = npc ? 'Edit NPC' : 'NPC Baru';
  document.getElementById('npc_id').value = npc?.id || '';
  document.getElementById('npc_nama').value = npc?.nama || '';
  document.getElementById('npc_tipe').value = npc?.tipe || '';
  document.getElementById('npc_ac').value = npc?.ac || '';
  ['str','dex','con','int','wis','cha'].forEach(s => {
    const el = document.getElementById('npc_'+s); if (el) el.value = npc?.ability?.[s] || '';
  });
  document.getElementById('npc_initiative').value = npc?.initiative || '';
  document.getElementById('npc_hp_max').value = npc?.hp_max || '';
  document.getElementById('npc_hp_current').value = npc?.hp_current || '';
  document.getElementById('npc_mp_max').value = npc?.mp_max || '';
  document.getElementById('npc_mp_current').value = npc?.mp_current || '';
  document.getElementById('npc_sp_max').value = npc?.sp_max || '';
  document.getElementById('npc_sp_current').value = npc?.sp_current || '';
  document.getElementById('npc_skills').value = npc?.skills || '';
  document.getElementById('npc_catatan').value = npc?.catatan || '';
  // Elemental atribut NPC
  const elems = npc?.elements || {};
  ELEMENT_KEYS.forEach(k => { const el = document.getElementById('npc_elem_'+k); if (el) el.value = elems[k] || ''; });
  npcEditEquip = npc?.equipment ? JSON.parse(JSON.stringify(npc.equipment)) : [];
  npcEditInv = npc?.inventory ? JSON.parse(JSON.stringify(npc.inventory)) : [];
  npcEditSkills = {
    active: npc?.skillSet?.active ? JSON.parse(JSON.stringify(npc.skillSet.active)) : [],
    passive: npc?.skillSet?.passive ? JSON.parse(JSON.stringify(npc.skillSet.passive)) : [],
    ultimate: npc?.skillSet?.ultimate ? JSON.parse(JSON.stringify(npc.skillSet.ultimate)) : []
  };
  renderNpcEquipList(); renderNpcInvList();
  renderNpcSkillList('active'); renderNpcSkillList('passive'); renderNpcSkillList('ultimate');
  document.getElementById('btnDeleteNpc').style.display = npc ? 'inline-block' : 'none';
  document.getElementById('npcModal').classList.add('show');
}
document.getElementById('btnAddNpc').onclick = () => openNpcModal(null);
document.getElementById('btnCloseNpcModal').onclick = () => document.getElementById('npcModal').classList.remove('show');

document.getElementById('btnSaveNpc').onclick = () => {
  const nama = document.getElementById('npc_nama').value.trim(); if (!nama) return alert('Isi nama NPC dulu.');
  const elements = {};
  ELEMENT_KEYS.forEach(k => { const el = document.getElementById('npc_elem_'+k); if (el) elements[k] = el.value; });
  const npc = {
    id: document.getElementById('npc_id').value || undefined,
    nama, tipe: document.getElementById('npc_tipe').value,
    ac: document.getElementById('npc_ac').value,
    ability: Object.fromEntries(['str','dex','con','int','wis','cha'].map(s => {
      const el = document.getElementById('npc_'+s); return [s, el ? el.value : ''];
    })),
    initiative: document.getElementById('npc_initiative').value,
    hp_max: document.getElementById('npc_hp_max').value,
    hp_current: document.getElementById('npc_hp_current').value,
    mp_max: document.getElementById('npc_mp_max').value,
    mp_current: document.getElementById('npc_mp_current').value,
    sp_max: document.getElementById('npc_sp_max').value,
    sp_current: document.getElementById('npc_sp_current').value,
    skills: document.getElementById('npc_skills').value,
    catatan: document.getElementById('npc_catatan').value,
    elements, equipment: npcEditEquip, inventory: npcEditInv, skillSet: npcEditSkills
  };
  socket.emit('dm:save-npc', { code: CODE, npc }, (res) => {
    if (res && res.ok) document.getElementById('npcModal').classList.remove('show');
    else alert(res?.error || 'Gagal menyimpan NPC.');
  });
};
document.getElementById('btnDeleteNpc').onclick = () => {
  const id = document.getElementById('npc_id').value; if (!id) return;
  if (!confirm('Hapus NPC ini?')) return;
  socket.emit('dm:delete-npc', { code: CODE, npcId: id });
  document.getElementById('npcModal').classList.remove('show');
};

// Export/Import NPC
document.getElementById('btnExportNpcs').onclick = () => {
  const blob = new Blob([JSON.stringify({ type:'dnd-vtt-npcs', npcs: Object.values(state.npcs||{}) }, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'npcs.json';
  document.body.appendChild(a); a.click(); a.remove();
};
document.getElementById('btnImportNpcs').onclick = () => document.getElementById('npcImportFile').click();
document.getElementById('npcImportFile').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = data.npcs || (Array.isArray(data) ? data : []);
      if (!list.length) return alert('Tidak ada NPC ditemukan di file.');
      list.forEach(npc => { npc.id = undefined; socket.emit('dm:save-npc', { code: CODE, npc }); });
      alert(`${list.length} NPC berhasil diimport.`);
    } catch (err) { alert('Gagal membaca file: ' + err.message); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// =============================== KELAS (data table, simplified) =========
socket.on('classes-update', (classes) => { state.classes = classes; renderClasses(); });

function renderClasses() {
  let list = Object.values(state.classes || {});
  const q = (document.getElementById('classSearch')?.value || '').toLowerCase().trim();
  if (q) list = list.filter(c => (c.nama||'').toLowerCase().includes(q));
  const sort = document.getElementById('classSort')?.value || 'name';
  list.sort((a,b) => sort === 'exp' ? (parseFloat(a.exp_req)||0)-(parseFloat(b.exp_req)||0) : (a.nama||'').localeCompare(b.nama||''));
  const tbody = document.getElementById('classTableBody');
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="4" class="hint">${q ? 'Tidak ada kelas yang cocok.' : 'Belum ada kelas.'}</td></tr>`; return; }
  tbody.innerHTML = list.map(c => `
    <tr data-id="${c.id}">
      <td>${escapeHtml(c.nama||'-')}</td>
      <td>${c.exp_req ? escapeHtml(String(c.exp_req)) : '-'}</td>
      <td>${escapeHtml((c.deskripsi||'').slice(0,60))}${(c.deskripsi||'').length>60?'…':''}</td>
      <td class="td-actions">
        <button type="button" class="small class-edit-btn" data-id="${c.id}">✏ Edit</button>
        <button type="button" class="small danger class-del-btn" data-id="${c.id}">🗑</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.class-edit-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openClassModal(state.classes[btn.dataset.id]); };
  });
  tbody.querySelectorAll('.class-del-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!confirm('Hapus kelas ini?')) return;
      socket.emit('dm:delete-class', { code: CODE, classId: btn.dataset.id });
    };
  });
}
document.getElementById('btnAddClass').onclick = () => openClassModal(null);

function openClassModal(kelas) {
  document.getElementById('classModalTitle').textContent = kelas ? 'Edit Kelas' : 'Kelas Baru';
  document.getElementById('class_id').value = kelas?.id || '';
  document.getElementById('class_nama').value = kelas?.nama || '';
  document.getElementById('class_exp_req').value = kelas?.exp_req || '';
  document.getElementById('class_deskripsi').value = kelas?.deskripsi || '';
  document.getElementById('btnDeleteClass').style.display = kelas ? 'inline-block' : 'none';
  document.getElementById('classModal').classList.add('show');
}
document.getElementById('btnCloseClassModal').onclick = () => document.getElementById('classModal').classList.remove('show');
document.getElementById('btnSaveClass').onclick = () => {
  const nama = document.getElementById('class_nama').value.trim(); if (!nama) return alert('Isi nama kelas.');
  const kelas = {
    id: document.getElementById('class_id').value || undefined,
    nama,
    exp_req: document.getElementById('class_exp_req').value,
    deskripsi: document.getElementById('class_deskripsi').value,
    skills: { active: [], passive: [], ultimate: [] } // player isi sendiri
  };
  socket.emit('dm:save-class', { code: CODE, kelas }, (res) => {
    if (res && res.ok) document.getElementById('classModal').classList.remove('show');
    else alert(res?.error || 'Gagal menyimpan kelas.');
  });
};
document.getElementById('btnDeleteClass').onclick = () => {
  const id = document.getElementById('class_id').value; if (!id) return;
  if (!confirm('Hapus kelas ini?')) return;
  socket.emit('dm:delete-class', { code: CODE, classId: id });
  document.getElementById('classModal').classList.remove('show');
};

// =============================== MAP & GRID ===========================
const mapWrap = document.getElementById('mapWrap');
const mapInner = document.getElementById('mapInner');
const gridOverlay = document.getElementById('gridOverlay');

socket.on('map-updated', (map) => { state.map = map; if (document.getElementById('tab-dm-map').style.display !== 'none') renderMap(); });

// DM Map zoom state (hanya scroll/pinch buat zoom + drag buat geser — tombol +/- dihapus krn gak kepakai)
let dmMapZoom = 1, dmPanX = 0, dmPanY = 0, dmIsPanning = false, dmPanSX = 0, dmPanSY = 0;

document.getElementById('btnDmMapZoomReset').onclick = () => { dmMapZoom = 1; dmPanX = 0; dmPanY = 0; applyDmMapTransform(); };
mapWrap.addEventListener('wheel', (e) => {
  if (e.target.closest('.token')) return;
  e.preventDefault();
  dmMapZoom = Math.max(0.25, Math.min(4, dmMapZoom + (e.deltaY > 0 ? -0.1 : 0.1)));
  applyDmMapTransform();
}, { passive: false });
mapWrap.addEventListener('mousedown', (e) => {
  if (e.target.closest('.token')) return;
  if (fogBrushActive) return; // waktu kuas fog aktif, mousedown dipakai buat melukis, bukan geser
  dmIsPanning = true; dmPanSX = e.clientX - dmPanX; dmPanSY = e.clientY - dmPanY; mapWrap.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => { if (!dmIsPanning) return; dmPanX = e.clientX - dmPanSX; dmPanY = e.clientY - dmPanSY; applyDmMapTransform(); });
window.addEventListener('mouseup', () => { dmIsPanning = false; mapWrap.style.cursor = fogBrushActive ? 'crosshair' : 'grab'; });

function applyDmMapTransform() {
  mapInner.style.transform = `translate(${dmPanX}px,${dmPanY}px) scale(${dmMapZoom})`;
  document.getElementById('dmMapZoomLabel').textContent = Math.round(dmMapZoom * 100) + '%';
}

// =============================== FOG OF WAR (brush reveal) =============
const FOG_COLS = 30, FOG_ROWS = 20; // resolusi logis kabut, independen dari grid visual — konsisten di semua layar
const fogCanvasDm = document.getElementById('fogLayerDm');
let fogBrushActive = false;
let fogPainting = false;
let fogPaintReveal = true;
let fogPaintedThisStroke = new Set();

function fogCellKey(c, r) { return c + ',' + r; }

function renderFogCanvasDm() {
  const map = state.map || {};
  if (!map.fogVisible) { fogCanvasDm.style.display = 'none'; return; }
  fogCanvasDm.style.display = '';
  const w = mapInner.offsetWidth || mapWrap.offsetWidth || 800;
  const h = mapInner.offsetHeight || mapWrap.offsetHeight || 500;
  fogCanvasDm.width = w; fogCanvasDm.height = h;
  const ctx = fogCanvasDm.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // DM lihat kabut agak transparan (biar tetap bisa lihat peta), player lihat gelap total
  ctx.fillStyle = 'rgba(20,20,30,0.6)';
  ctx.fillRect(0, 0, w, h);
  const revealed = map.fogRevealed || {};
  const cw = w / FOG_COLS, ch = h / FOG_ROWS;
  ctx.globalCompositeOperation = 'destination-out';
  Object.keys(revealed).forEach(key => {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
  });
  ctx.globalCompositeOperation = 'source-over';
}
window.addEventListener('resize', () => { if (document.getElementById('tab-dm-map').style.display !== 'none') renderFogCanvasDm(); });

function cellFromEvent(e) {
  const rect = mapInner.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { c: Math.floor(x * FOG_COLS), r: Math.floor(y * FOG_ROWS) };
}

function paintFogAt(e) {
  const cell = cellFromEvent(e); if (!cell) return;
  const brush = parseInt(document.getElementById('fogBrushSize').value, 10) || 1;
  const half = Math.floor(brush / 2);
  for (let dc = -half; dc <= half; dc++) {
    for (let dr = -half; dr <= half; dr++) {
      const c = cell.c + dc, r = cell.r + dr;
      if (c < 0 || r < 0 || c >= FOG_COLS || r >= FOG_ROWS) continue;
      fogPaintedThisStroke.add(fogCellKey(c, r));
    }
  }
  // Preview langsung di canvas biar terasa responsif sebelum server balas
  const revealedPreview = Object.assign({}, state.map.fogRevealed || {});
  fogPaintedThisStroke.forEach(k => { if (fogPaintReveal) revealedPreview[k] = 1; else delete revealedPreview[k]; });
  state.map = Object.assign({}, state.map, { fogRevealed: revealedPreview });
  renderFogCanvasDm();
}

document.getElementById('btnFogBrush').addEventListener('click', () => {
  fogBrushActive = !fogBrushActive;
  const btn = document.getElementById('btnFogBrush');
  btn.textContent = fogBrushActive ? '🖌 Kuas Fog: ON' : '🖌 Kuas Fog: OFF';
  btn.classList.toggle('active', fogBrushActive);
  mapWrap.style.cursor = fogBrushActive ? 'crosshair' : 'grab';
});

mapWrap.addEventListener('mousedown', (e) => {
  if (!fogBrushActive || e.target.closest('.token')) return;
  e.preventDefault();
  fogPainting = true;
  fogPaintReveal = !e.shiftKey;
  fogPaintedThisStroke = new Set();
  paintFogAt(e);
});
window.addEventListener('mousemove', (e) => { if (fogPainting) paintFogAt(e); });
window.addEventListener('mouseup', () => {
  if (!fogPainting) return;
  fogPainting = false;
  if (fogPaintedThisStroke.size) {
    socket.emit('dm:fog-paint', { code: CODE, cells: [...fogPaintedThisStroke], reveal: fogPaintReveal });
  }
  fogPaintedThisStroke = new Set();
});

document.getElementById('btnFogRevealAll').addEventListener('click', () => {
  const cells = [];
  for (let c = 0; c < FOG_COLS; c++) for (let r = 0; r < FOG_ROWS; r++) cells.push(fogCellKey(c, r));
  socket.emit('dm:fog-paint', { code: CODE, cells, reveal: true });
});
document.getElementById('btnFogResetAll').addEventListener('click', () => {
  if (!confirm('Tutup semua kabut lagi di map ini?')) return;
  socket.emit('dm:fog-reset', { code: CODE });
});

// Token image upload preview
let tokenImageDataUrl = null;
document.getElementById('tokenImageUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 128, 0.85).then(dataUrl => {
    tokenImageDataUrl = dataUrl;
    const preview = document.getElementById('tokenImgPreview');
    preview.src = dataUrl; preview.style.display = 'inline-block';
  });
});

const _mapAspectCache = {};
function setMapAspectRatio(wrapEl, imageUrl) {
  if (!imageUrl) { wrapEl.style.aspectRatio = '16/10'; wrapEl.style.minHeight = '400px'; return; }
  if (_mapAspectCache[imageUrl]) { wrapEl.style.aspectRatio = _mapAspectCache[imageUrl]; return; }
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = `${img.naturalWidth}/${img.naturalHeight}`;
      _mapAspectCache[imageUrl] = ratio;
      wrapEl.style.aspectRatio = ratio;
    }
  };
  img.src = imageUrl;
}

function renderMap() {
  const map = state.map || {};
  mapInner.style.backgroundImage = map.imageUrl ? `url(${map.imageUrl})` : 'none';
  mapInner.style.backgroundSize = 'cover';
  mapInner.style.backgroundPosition = 'center';
  if (!map.imageUrl) { mapInner.style.width = '100%'; mapInner.style.height = '500px'; }
  setMapAspectRatio(mapInner, map.imageUrl);
  const size = map.gridSize || 50;
  if (map.gridVisible) {
    gridOverlay.style.backgroundImage =
      `repeating-linear-gradient(0deg, rgba(220,190,120,.55) 0 1px, transparent 1px ${size}px),
       repeating-linear-gradient(90deg, rgba(220,190,120,.55) 0 1px, transparent 1px ${size}px)`;
  } else { gridOverlay.style.backgroundImage = 'none'; }
  document.getElementById('gridSize').value = size;
  document.getElementById('gridVisible').checked = !!map.gridVisible;
  document.getElementById('fogVisible').checked = !!map.fogVisible;
  document.getElementById('fogLayerDm').style.display = map.fogVisible ? '' : 'none';
  renderTokens();
}

document.getElementById('mapUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 1600, 0.82).then(dataUrl => {
    socket.emit('dm:update-map', { code: CODE, imageUrl: dataUrl });
  }).catch(() => {
    const reader = new FileReader();
    reader.onload = () => socket.emit('dm:update-map', { code: CODE, imageUrl: reader.result });
    reader.readAsDataURL(file);
  });
});

// Extra image overlay (tidak mengganti background)
document.getElementById('mapUploadExtra').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 800, 0.82).then(dataUrl => {
    // Add as a non-draggable image overlay token
    socket.emit('token:add', { code: CODE, token: { x: 50, y: 50, color: 'transparent', label: '🖼', type: 'other', ownerId: null, imageUrl: dataUrl, isOverlay: true } });
  });
});

document.getElementById('btnDeleteMap').onclick = () => {
  if (!confirm('Hapus gambar map ini? Token tetap ada.')) return;
  socket.emit('dm:update-map', { code: CODE, imageUrl: null });
};

document.getElementById('gridSize').addEventListener('input', (e) => {
  socket.emit('dm:update-grid', { code: CODE, gridSize: parseInt(e.target.value, 10) });
});
document.getElementById('gridVisible').addEventListener('change', (e) => {
  socket.emit('dm:update-grid', { code: CODE, gridVisible: e.target.checked });
});
document.getElementById('fogVisible').addEventListener('change', (e) => {
  socket.emit('dm:update-grid', { code: CODE, fogVisible: e.target.checked });
  document.getElementById('fogLayerDm').style.display = e.target.checked ? '' : 'none';
});

function compressImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject;
    reader.onload = () => {
      const img = new Image(); img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) { const scale = maxDim / Math.max(width, height); width = Math.round(width*scale); height = Math.round(height*scale); }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// =============================== TOKENS ================================
socket.on('tokens-updated', (tokens) => { state.tokens = tokens; renderTokens(); refreshTokenOwnerOptions(); });

function refreshTokenOwnerOptions() {
  const sel = document.getElementById('tokenOwner');
  const cur = sel.value;
  const list = state.playersList || [];
  sel.innerHTML = '<option value="">Tidak dimiliki player</option>' +
    list.map(p => `<option value="${p.id}">${escapeHtml(p.nama_karakter || p.name)}</option>`).join('');
  if (list.some(p => p.id === cur)) sel.value = cur;
}

document.getElementById('btnAddToken').onclick = () => {
  const color = document.getElementById('tokenColor').value;
  const label = document.getElementById('tokenLabel').value || '?';
  const ownerId = document.getElementById('tokenOwner').value || null;
  const tokenType = document.getElementById('tokenType').value;
  const imageUrl = tokenImageDataUrl || null;
  socket.emit('token:add', { code: CODE, token: {
    x: 50, y: 50, color, label: label.slice(0, 12), type: tokenType, ownerId, imageUrl
  }});
  tokenImageDataUrl = null;
  document.getElementById('tokenImgPreview').style.display = 'none';
  document.getElementById('tokenImageUpload').value = '';
};

let draggingTokenId = null;
window.addEventListener('mousemove', (e) => {
  if (!draggingTokenId) return;
  const el = mapInner.querySelector(`.token[data-id="${draggingTokenId}"]`); if (!el) return;
  const rect = mapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  el.style.left = x + '%'; el.style.top = y + '%';
});
window.addEventListener('mouseup', (e) => {
  if (!draggingTokenId) return;
  const id = draggingTokenId; draggingTokenId = null;
  const rect = mapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  socket.emit('token:move', { code: CODE, tokenId: id, x, y });
});

function renderTokens() {
  mapInner.querySelectorAll('.token').forEach(el => el.remove());
  Object.values(state.tokens || {}).forEach(tok => {
    const el = document.createElement('div');
    el.className = 'token draggable';
    el.style.left = tok.x + '%'; el.style.top = tok.y + '%';
    el.style.position = 'absolute';
    el.style.background = tok.imageUrl ? 'transparent' : (tok.color || '#555');
    el.dataset.id = tok.id;

    if (tok.imageUrl) {
      const img = document.createElement('img'); img.src = tok.imageUrl; img.className = 'token-img'; img.draggable = false;
      el.appendChild(img);
    } else {
      el.textContent = (tok.label || '').slice(0, 2);
    }

    // Name tag
    const nametag = document.createElement('div'); nametag.className = 'token-nametag';
    nametag.textContent = tok.label || '';
    el.appendChild(nametag);

    // Type border
    if (tok.type === 'enemy') el.style.border = '2px solid #c0392b';
    else if (tok.type === 'ally') el.style.border = '2px solid #27ae60';
    else if (tok.type === 'npc') el.style.border = '2px solid #7b3fa0';

    el.title = (tok.label || '') + (tok.ownerId ? ' (milik player)' : '');
    el.addEventListener('mousedown', (e) => { draggingTokenId = tok.id; e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('Hapus token "' + (tok.label || '') + '"?')) {
        socket.emit('token:remove', { code: CODE, tokenId: tok.id });
      }
    });
    mapInner.appendChild(el);
  });
}

// =============================== BATTLE ================================
socket.on('battle-updated', (battle) => { state.battle = battle; renderBattle(); });

function sortedBattle() {
  const entries = Object.values((state.battle && state.battle.entries) || {});
  return entries.sort((a,b) => { const rb=parseFloat(b.roll)||0,ra=parseFloat(a.roll)||0; if(rb!==ra) return rb-ra; return (a.name||'').localeCompare(b.name||''); });
}

const ENTRY_BUFF_STAT_OPTIONS = [
  ['dot','DOT (HP/giliran)'],['heal_dot','HEAL (HP/giliran)'],
  ['mp_regen','Regen MP/giliran'],['sp_regen','Regen SP/giliran'],['other','Lainnya']
];

function renderEntryBuffsHtml(e) {
  const buffs = Array.isArray(e.buffs) ? e.buffs : [];
  const rows = buffs.map((b,i) => `
    <div class="battle-buff-row" data-idx="${i}">
      <input type="text" data-bf="nama" placeholder="Nama efek" value="${escapeAttr(b.nama||'')}">
      <select data-bf="jenis"><option value="">-</option><option value="Buff" ${b.jenis==='Buff'?'selected':''}>Buff</option><option value="Debuff" ${b.jenis==='Debuff'?'selected':''}>Debuff</option></select>
      <select data-bf="stat">${ENTRY_BUFF_STAT_OPTIONS.map(([k,l])=>`<option value="${k}" ${(b.stat||'dot')===k?'selected':''}>${l}</option>`).join('')}</select>
      <input type="text" data-bf="jumlah" placeholder="5 / 1d4+2 / -3" value="${escapeAttr(b.jumlah||'')}">
      <input type="number" step="1" min="0" data-bf="sisaTurn" placeholder="giliran" style="max-width:60px;" value="${escapeAttr(b.sisaTurn??'')}">
      <button type="button" data-bremove title="Hapus">×</button>
    </div>`).join('');
  return `
    <div class="battle-skill-cat" style="margin-top:6px;">🌀 Buff/Debuff/DOT</div>
    <div class="entry-buffs">${rows||'<p class="hint" style="margin:2px 0;">Belum ada efek.</p>'}</div>
    <button type="button" class="secondary small" data-baddbuff style="margin-top:2px;">+ Tambah Efek</button>`;
}

function renderBattle() {
  const turn = (state.battle && state.battle.turn) || { activeId: null, round: 1 };
  document.getElementById('roundBadge').textContent = 'Round ' + (turn.round || 1);
  const list = sortedBattle();
  const box = document.getElementById('battleList');
  if (!list.length) { box.innerHTML = '<p class="hint">Belum ada peserta battle.</p>'; return; }
  box.innerHTML = list.map(e => {
    const isPc = e.type === 'pc';
    const ro = isPc ? 'readonly' : '';
    const elemStr = e.elements ? Object.entries(e.elements).filter(([,v])=>v&&v!=='0'&&v!=='0%').map(([k,v])=>`<span class="elem-badge">${k}:${v}</span>`).join(' ') : '';
    const condStr = (e.conditions||[]).map(c=>`<span class="hint">${escapeHtml(c)}</span>`).join(' ');
    return `<div class="battle-row ${e.id===turn.activeId?'active':''}" data-id="${e.id}">
      <div class="roll-num">${e.roll??'-'}</div>
      <div class="b-info">
        <div class="b-name">${escapeHtml(e.name)} <span class="type-pill ${e.type}">${e.type}</span>${isPc?' <span class="hint">(pantau saja)</span>':''}</div>
        ${elemStr?`<div style="margin-top:2px;">${elemStr}</div>`:''}
        ${condStr?`<div style="margin-top:2px;">${condStr}</div>`:''}
        <div class="row" style="margin:3px 0 0;"><span class="stat-label">HP</span><input type="number" data-f="hp_current" value="${e.hp_current??''}" placeholder="now" ${ro}><span class="hint">/</span><input type="number" data-f="hp_max" value="${e.hp_max??''}" placeholder="max" ${ro}></div>
        <div class="row" style="margin:3px 0 0;"><span class="stat-label">MP</span><input type="number" data-f="mp_current" value="${e.mp_current??''}" placeholder="now" ${ro}><span class="hint">/</span><input type="number" data-f="mp_max" value="${e.mp_max??''}" placeholder="max" ${ro}></div>
        <div class="row" style="margin:3px 0 0;"><span class="stat-label">SP</span><input type="number" data-f="sp_current" value="${e.sp_current??''}" placeholder="now" ${ro}><span class="hint">/</span><input type="number" data-f="sp_max" value="${e.sp_max??''}" placeholder="max" ${ro}></div>
        <div class="row" style="margin:3px 0 0;"><span class="stat-label">AC</span><input type="number" data-f="ac" value="${e.ac??''}" placeholder="AC" ${ro}></div>
        ${!isPc ? renderEntryBuffsHtml(e) : ''}
      </div>
      ${e.id===turn.activeId?'<span class="turn-flag">GILIRAN</span>':''}
      <button type="button" class="row-remove" title="Hapus dari battle">×</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.battle-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('input:not([readonly])').forEach(inp => {
      inp.addEventListener('change', e => { socket.emit('dm:battle-update', { code: CODE, id, patch: { [e.target.dataset.f]: e.target.value } }); });
    });
    row.querySelector('.row-remove').onclick = () => socket.emit('dm:battle-remove', { code: CODE, id });
    const currentBuffs = () => JSON.parse(JSON.stringify(((state.battle.entries||{})[id]?.buffs)||[]));
    row.querySelectorAll('.entry-buffs [data-bf]').forEach(el => {
      el.addEventListener('change', e => {
        const idx = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
        const buffs = currentBuffs(); if (!buffs[idx]) return;
        buffs[idx][e.target.dataset.bf] = e.target.value;
        socket.emit('dm:battle-update', { code: CODE, id, patch: { buffs } });
      });
    });
    row.querySelectorAll('[data-bremove]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.target.closest('[data-idx]').dataset.idx, 10);
        const buffs = currentBuffs(); buffs.splice(idx,1);
        socket.emit('dm:battle-update', { code: CODE, id, patch: { buffs } });
      });
    });
    const addBtn = row.querySelector('[data-baddbuff]');
    if (addBtn) addBtn.addEventListener('click', () => {
      const buffs = currentBuffs(); buffs.push({nama:'',jenis:'Debuff',stat:'dot',jumlah:'',sisaTurn:''});
      socket.emit('dm:battle-update', { code: CODE, id, patch: { buffs } });
    });
  });
  refreshDmActionTargetOptions();
}

function refreshDmActionTargetOptions() {
  const sel = document.getElementById('dmActionTarget'); if (!sel) return;
  const prevVal = sel.value;
  const list = sortedBattle();
  sel.innerHTML = list.map(e=>`<option value="${e.id}">${escapeHtml(e.name)} (${e.type})</option>`).join('')||'<option value="">(belum ada)</option>';
  if (list.some(e=>e.id===prevVal)) sel.value = prevVal;
  const sel2 = document.getElementById('dmStatusTarget');
  if (sel2) { sel2.innerHTML = sel.innerHTML; if (list.some(e=>e.id===sel2.value)) sel2.value = sel2.value; }
  refreshDmActionActorOptions();
}

function refreshDmActionActorOptions() {
  const sel = document.getElementById('dmActionActor'); if (!sel) return;
  const prevVal = sel.value;
  const list = sortedBattle().filter(e => e.type !== 'pc');
  sel.innerHTML = '<option value="">— Pilih Aktor —</option>' + list.map(e=>`<option value="${e.id}">${escapeHtml(e.name)} (${e.type})</option>`).join('');
  if (list.some(e=>e.id===prevVal)) sel.value = prevVal;
  refreshDmActionSkillOptions();
}

function refreshDmActionSkillOptions() {
  const sel = document.getElementById('dmActionSkill'); if (!sel) return;
  const actorId = document.getElementById('dmActionActor').value;
  const entry = actorId ? (state.battle?.entries||{})[actorId] : null;
  let options = '<option value="">— Formula manual —</option>';
  if (entry && entry.refType === 'npc') {
    const npc = (state.npcs||{})[entry.refId];
    const catLabel = { active:'❌', passive:'✳', ultimate:'🔥' };
    ['active','passive','ultimate'].forEach(cat => {
      (npc?.skillSet?.[cat]||[]).forEach((sk,i) => {
        if (!sk.nama) return;
        const costParts = [parseInt(sk.mp_cost,10)>0?`${sk.mp_cost}MP`:null,parseInt(sk.sp_cost,10)>0?`${sk.sp_cost}SP`:null].filter(Boolean);
        options += `<option value="${cat}:${i}">${catLabel[cat]} ${escapeHtml(sk.nama)}${costParts.length?' ('+costParts.join(',')+')':''}</option>`;
      });
    });
  }
  sel.innerHTML = options;
  document.getElementById('dmActionSkillCost').textContent = '';
}
document.getElementById('dmActionActor').addEventListener('change', refreshDmActionSkillOptions);
document.getElementById('dmActionSkill').addEventListener('change', () => {
  const v = document.getElementById('dmActionSkill').value;
  const costEl = document.getElementById('dmActionSkillCost');
  if (!v) { costEl.textContent = ''; return; }
  const [cat,idx] = v.split(':');
  const actorId = document.getElementById('dmActionActor').value;
  const entry = (state.battle?.entries||{})[actorId];
  const npc = entry?.refType==='npc' ? (state.npcs||{})[entry.refId] : null;
  const sk = npc?.skillSet?.[cat]?.[idx];
  if (!sk) return;
  document.getElementById('dmActionType').value = sk.action||'damage';
  document.getElementById('dmActionFormula').value = sk.formula||'';
  const costParts = [parseInt(sk.mp_cost,10)>0?`-${sk.mp_cost} MP`:null,parseInt(sk.sp_cost,10)>0?`-${sk.sp_cost} SP`:null].filter(Boolean);
  costEl.textContent = costParts.length ? `Cost: ${costParts.join(', ')}` : '';
});

document.getElementById('btnDmActionRoll').onclick = () => {
  const actorId = document.getElementById('dmActionActor').value;
  if (!actorId) return alert('Pilih Aktor dulu.');
  const actorEntry = (state.battle?.entries||{})[actorId]; if (!actorEntry) return;
  const targetId = document.getElementById('dmActionTarget').value; if (!targetId) return alert('Pilih target dulu.');
  const actionType = document.getElementById('dmActionType').value;
  const formula = document.getElementById('dmActionFormula').value.trim() || '1d6';
  const elementType = document.getElementById('dmActionElement').value;
  const status = document.getElementById('dmActionStatus');

  // Elemental bonus dari NPC
  const elemPct = elementType && actorEntry.elements ? (parseFloat(actorEntry.elements[elementType]) || 0) : 0;
  // Elemental resistance target
  const targetEntry = (state.battle?.entries||{})[targetId];
  const targetElemPct = elementType && targetEntry?.elements ? (parseFloat(targetEntry.elements[elementType]) || 0) : 0;

  const skillVal = document.getElementById('dmActionSkill').value;
  let mpCost=0, spCost=0, skillNama='', note;
  if (skillVal) {
    const [cat,idx] = skillVal.split(':');
    const npc = actorEntry.refType==='npc' ? (state.npcs||{})[actorEntry.refId] : null;
    const sk = npc?.skillSet?.[cat]?.[idx];
    if (sk) {
      skillNama = sk.nama||'Skill'; mpCost=parseInt(sk.mp_cost,10)||0; spCost=parseInt(sk.sp_cost,10)||0;
      const mpCur = parseFloat(actorEntry.mp_current)||0; const spCur = parseFloat(actorEntry.sp_current)||0;
      if (mpCost>0&&mpCur<mpCost) return alert(`MP "${actorEntry.name}" tidak cukup (butuh ${mpCost}, sisa ${mpCur}).`);
      if (spCost>0&&spCur<spCost) return alert(`SP "${actorEntry.name}" tidak cukup (butuh ${spCost}, sisa ${spCur}).`);
      const costText = [mpCost>0?`-${mpCost} MP`:null,spCost>0?`-${spCost} SP`:null].filter(Boolean).join(', ');
      note = `Skill: ${skillNama}${costText?' ('+costText+')':''}`;
    }
  }
  socket.emit('battle:roll-action', { code: CODE, targetId, actionType, formula, actorName: actorEntry.name, note, elementType, elemBonus: elemPct }, (res) => {
    if (res && res.ok) {
      if (mpCost>0||spCost>0) {
        const patch = {};
        if (mpCost>0) patch.mp_current = (parseFloat(actorEntry.mp_current)||0)-mpCost;
        if (spCost>0) patch.sp_current = (parseFloat(actorEntry.sp_current)||0)-spCost;
        socket.emit('dm:battle-update', { code: CODE, id: actorId, patch });
      }
      const elemTag = elemPct ? ` [${elementType} ${elemPct > 0 ? '+' : ''}${elemPct}%]` : '';
      status.textContent = `✓ ${actorEntry.name} → ${formula} = ${res.roll.total}.${elemTag}`;
      document.getElementById('dmActionFormula').value = '';
      document.getElementById('dmActionSkill').value = '';
    } else { status.textContent = res?.error||'Gagal.'; }
  });
};

// Apply status condition
document.getElementById('btnDmApplyStatus').onclick = () => {
  const targetId = document.getElementById('dmStatusTarget').value; if (!targetId) return;
  const condition = document.getElementById('dmStatusCondition').value; if (!condition) return;
  socket.emit('battle:apply-status', { code: CODE, targetId, condition, actorName: 'DM' }, (res) => {
    document.getElementById('dmStatusStatus').textContent = res?.ok ? `✓ Kondisi "${condition}" diterapkan.` : (res?.error||'Gagal.');
  });
};

function refreshBattleSourceOptions() {
  const type = document.getElementById('battleSourceType').value;
  const refSel = document.getElementById('battleSourceRef');
  const customInput = document.getElementById('battleCustomName');
  if (type === 'custom') { refSel.style.display='none'; customInput.style.display=''; document.getElementById('battleType').value='ally'; }
  else if (type === 'player') {
    refSel.style.display=''; customInput.style.display='none';
    const list = state.playersList||[];
    refSel.innerHTML = list.map(p=>`<option value="${p.id}">${escapeHtml(p.nama_karakter||p.name)}</option>`).join('')||'<option>(belum ada player)</option>';
    document.getElementById('battleType').value='pc';
  } else {
    refSel.style.display=''; customInput.style.display='none';
    const list = Object.values(state.npcs||{});
    refSel.innerHTML = list.map(n=>`<option value="${n.id}">${escapeHtml(n.nama)}</option>`).join('')||'<option>(belum ada NPC)</option>';
    document.getElementById('battleType').value='enemy';
  }
}
document.getElementById('battleSourceType').addEventListener('change', refreshBattleSourceOptions);
refreshBattleSourceOptions();

document.getElementById('btnBattleAdd').onclick = () => {
  const sourceType = document.getElementById('battleSourceType').value;
  const roll = document.getElementById('battleRoll').value;
  const hpMax = document.getElementById('battleHpMax').value;
  const mpMax = document.getElementById('battleMpMax').value;
  const spMax = document.getElementById('battleSpMax').value;
  const ac = document.getElementById('battleAc').value;
  const type = document.getElementById('battleType').value;
  let entry;
  if (sourceType === 'custom') {
    const name = document.getElementById('battleCustomName').value.trim(); if (!name) return alert('Isi nama.');
    entry = { name, type, roll, hp_max: hpMax, hp_current: hpMax, mp_max: mpMax, mp_current: mpMax, sp_max: spMax, sp_current: spMax, ac, refType: null, refId: null };
    document.getElementById('battleCustomName').value = '';
  } else if (sourceType === 'player') {
    const id = document.getElementById('battleSourceRef').value;
    const p = (state.playersList||[]).find(p=>p.id===id); if (!p) return alert('Pilih player.');
    const full = (state.players||{})[id]||{};
    const sheet = full.sheet||{};
    entry = { name: p.nama_karakter||p.name, type, roll, hp_max: hpMax||p.max_hp, hp_current: hpMax||p.current_hp, mp_max: mpMax||sheet.mp_max, mp_current: mpMax||sheet.mp_current, sp_max: spMax||sheet.sp_max, sp_current: spMax||sheet.sp_current, ac: ac||sheet.ac, refType:'player', refId: id };
  } else {
    const id = document.getElementById('battleSourceRef').value;
    const n = (state.npcs||{})[id]; if (!n) return alert('Pilih NPC.');
    entry = { name: n.nama, type, roll, hp_max: hpMax||n.hp_max, hp_current: hpMax||n.hp_current, mp_max: mpMax||n.mp_max, mp_current: mpMax||n.mp_current, sp_max: spMax||n.sp_max, sp_current: spMax||n.sp_current, ac: ac||n.ac, refType:'npc', refId: id, elements: n.elements||{} };
  }
  socket.emit('dm:battle-add', { code: CODE, entry }, () => {
    ['battleRoll','battleHpMax','battleMpMax','battleSpMax','battleAc'].forEach(id => { document.getElementById(id).value = ''; });
  });
};
document.getElementById('btnBattleNext').onclick = () => socket.emit('dm:battle-next', { code: CODE });
document.getElementById('btnBattlePrev').onclick = () => socket.emit('dm:battle-prev', { code: CODE });
document.getElementById('btnBattleClear').onclick = () => { if (confirm('Bersihkan battle?')) socket.emit('dm:battle-clear', { code: CODE }); };

// =============================== MUSIK ================================
socket.on('music-updated', (tracks) => { state.music.tracks = tracks; renderMusic(); syncMusicPlayer(); });
socket.on('music-state', (playback) => { state.music.playback = playback; renderMusic(); syncMusicPlayer(); });

const dmMusicPlayer = document.getElementById('musicPlayer');
let dmMusicUnlocked = false, ytPlayer = null, ytReady = false, ytLoadedId = null;
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('ytPlayer', { height:'1', width:'1', playerVars:{controls:0,disablekb:1,playsinline:1},
    events: {
      onReady: () => { ytReady = true; syncMusicPlayer(); },
      onStateChange: (ev) => { if (ev.data===YT.PlayerState.ENDED && state.music?.playback?.loop) { ytPlayer.seekTo(0,true); ytPlayer.playVideo(); } }
    }
  });
};

function syncMusicPlayer() {
  const pb = (state.music && state.music.playback)||{};
  const track = pb.trackId && state.music.tracks ? state.music.tracks[pb.trackId] : null;
  if (track && track.type === 'youtube') {
    dmMusicPlayer.pause(); dmMusicPlayer.removeAttribute('src'); dmMusicPlayer.dataset.trackId='';
    if (!ytReady||!ytPlayer) return;
    if (ytLoadedId!==track.videoId) { ytLoadedId=track.videoId; if(pb.isPlaying) ytPlayer.loadVideoById(track.videoId); else ytPlayer.cueVideoById(track.videoId); }
    ytPlayer.setVolume(Math.round((pb.volume??0.7)*100));
    if (pb.isPlaying) { const t=Math.max(0,(Date.now()-pb.startTs)/1000); if(typeof ytPlayer.getCurrentTime==='function'&&Math.abs((ytPlayer.getCurrentTime()||0)-t)>1.5) ytPlayer.seekTo(t,true); ytPlayer.playVideo(); }
    else { ytPlayer.pauseVideo(); if(pb.position) ytPlayer.seekTo(pb.position,true); }
    return;
  }
  if (ytReady&&ytPlayer&&ytLoadedId) { ytPlayer.stopVideo(); ytLoadedId=null; }
  dmMusicPlayer.loop=!!pb.loop; dmMusicPlayer.volume=pb.volume??0.7;
  if (!track) { dmMusicPlayer.pause(); dmMusicPlayer.removeAttribute('src'); return; }
  if (dmMusicPlayer.dataset.trackId!==pb.trackId) { dmMusicPlayer.src=track.url; dmMusicPlayer.dataset.trackId=pb.trackId; }
  if (pb.isPlaying) {
    const t=Math.max(0,(Date.now()-pb.startTs)/1000);
    if(Math.abs((dmMusicPlayer.currentTime||0)-t)>1.5) dmMusicPlayer.currentTime=t;
    dmMusicPlayer.play().catch(()=>{});
  } else { dmMusicPlayer.pause(); dmMusicPlayer.currentTime=pb.position||0; }
}
document.addEventListener('click', ()=>{ if(!dmMusicUnlocked){dmMusicUnlocked=true;syncMusicPlayer();} }, {once:true});

function renderMusic() {
  let tracks = Object.values((state.music&&state.music.tracks)||{});
  const q = (document.getElementById('musicSearch')?.value || '').toLowerCase().trim();
  if (q) tracks = tracks.filter(t => (t.name||'').toLowerCase().includes(q));
  const pb = (state.music&&state.music.playback)||{};
  const box = document.getElementById('musicList');
  box.innerHTML = tracks.length ? tracks.map(t=>`
    <div class="music-item ${t.id===pb.trackId?'playing':''}" data-id="${t.id}">
      <span class="m-name">${t.id===pb.trackId&&pb.isPlaying?'▶ ':''}${t.type==='youtube'?'▶️ ':''}${escapeHtml(t.name)}</span>
      <button type="button" class="small btn-music-play">Putar</button>
      <button type="button" class="row-remove btn-music-remove" title="Hapus">×</button>
    </div>`).join('') : `<p class="hint">${q ? 'Tidak ada lagu yang cocok.' : 'Belum ada lagu.'}</p>`;
  box.querySelectorAll('.btn-music-play').forEach(btn => { btn.onclick = ()=>socket.emit('dm:music-play',{code:CODE,id:btn.closest('.music-item').dataset.id}); });
  box.querySelectorAll('.btn-music-remove').forEach(btn => { btn.onclick = ()=>socket.emit('dm:music-remove',{code:CODE,id:btn.closest('.music-item').dataset.id}); });
  const current = tracks.find(t=>t.id===pb.trackId);
  document.getElementById('musicNowPlaying').textContent = current?(pb.isPlaying?'▶ Sedang main: ':'⏸ Dijeda: ')+current.name:'Tidak ada yang diputar.';
  document.getElementById('btnMusicPauseResume').textContent = pb.isPlaying ? '⏸ Pause' : '▶ Resume';
  const loopEl=document.getElementById('musicLoop'); if(document.activeElement!==loopEl) loopEl.checked=!!pb.loop;
  const volEl=document.getElementById('musicVolume'); if(document.activeElement!==volEl) volEl.value=pb.volume??0.7;
}

document.getElementById('musicUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const name = document.getElementById('musicName').value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const reader = new FileReader();
  reader.onload = () => { socket.emit('dm:music-add', {code:CODE,name,url:reader.result},(res)=>{if(!res?.ok)alert((res?.error)||'Gagal.')}); document.getElementById('musicName').value=''; e.target.value=''; };
  reader.readAsDataURL(file);
});
document.getElementById('btnMusicAddUrl').onclick = () => {
  const url = document.getElementById('musicUrl').value.trim(); if (!url) return;
  const name = document.getElementById('musicName').value.trim()||'Lagu dari URL';
  socket.emit('dm:music-add',{code:CODE,name,url},(res)=>{if(!res?.ok)alert(res?.error||'Gagal.')});
  document.getElementById('musicUrl').value=''; document.getElementById('musicName').value='';
};
document.getElementById('btnMusicPauseResume').onclick = () => { const pb=(state.music&&state.music.playback)||{}; if(!pb.trackId) return; socket.emit(pb.isPlaying?'dm:music-pause':'dm:music-resume',{code:CODE}); };
document.getElementById('btnMusicStop').onclick = () => socket.emit('dm:music-stop',{code:CODE});
document.getElementById('musicLoop').addEventListener('change', e=>socket.emit('dm:music-loop',{code:CODE,loop:e.target.checked}));
let musicVolTimer=null; document.getElementById('musicVolume').addEventListener('input', e=>{ clearTimeout(musicVolTimer); musicVolTimer=setTimeout(()=>socket.emit('dm:music-volume',{code:CODE,volume:e.target.value}),120); });

// =============================== CHAT / DICE ===========================
socket.on('chat:new', (entry) => { state.log.push(entry); renderLog(); });
socket.on('chat:cleared', () => { state.log = []; renderLog(); });
socket.on('chat:revealed', (entry) => {
  const idx = state.log.findIndex(e=>e.id===entry.id);
  if (idx>=0) state.log[idx]=entry; else state.log.push(entry);
  renderLog();
});

function renderLog() {
  const box = document.getElementById('chatLog');
  box.innerHTML = state.log.map(e => {
    let cls;
    if (e.from==='DM'||e.from==='dm') cls='dm';
    else if (e.from==='Sistema'||e.from==='system'||e.type==='system') cls='system';
    else if (e.type==='roll') cls='roll';
    else if (e.type==='damage') cls='damage';
    else if (e.type==='heal') cls='heal';
    else cls='player';
    return `<div class="entry ${cls}${e.secret?' secret':''}">
      <span class="from">${escapeHtml(e.from)}:</span> ${escapeHtml(e.text)}
      ${e.secret?`<span class="secret-badge">🔒 rahasia</span> <button type="button" class="small secondary reveal-btn" data-id="${e.id}">👁 Perlihatkan</button>`:''}
      ${e.ts?`<span class="ts">${new Date(e.ts).toLocaleTimeString()}</span>`:''}
    </div>`;
  }).join('')||'<p class="hint">Belum ada log.</p>';
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll('.reveal-btn').forEach(btn => { btn.onclick=()=>socket.emit('dm:reveal-roll',{code:CODE,id:btn.dataset.id}); });
}

const DICE_TYPES = [4,6,8,10,12,20,100];
function renderDmDiceButtons() {
  const box = document.getElementById('dmDiceQuickRow');
  box.innerHTML = DICE_TYPES.map(d=>`<button type="button" class="dice-btn" data-sides="${d}">d${d}</button>`).join('');
  box.querySelectorAll('.dice-btn').forEach(btn => { btn.onclick=()=>rollAndSend('1d'+btn.dataset.sides); });
}
renderDmDiceButtons();

document.getElementById('btnClearLog').onclick = ()=>{ if(confirm('Bersihkan log?')) socket.emit('chat:clear',{code:CODE}); };
document.getElementById('btnSendChat').onclick = sendChat;
document.getElementById('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

const DICE_FORMULA_RE = /^\d*d\d+([+-]\d+)?$/i;
function sendChat() {
  const input = document.getElementById('chatInput'); const text = input.value.trim(); if (!text) return;
  if (text.startsWith('/roll')) rollAndSend(text.replace('/roll','').trim()||'1d20');
  else if (DICE_FORMULA_RE.test(text)) rollAndSend(text);
  else socket.emit('chat:send',{code:CODE,from:'DM',text,type:'chat'});
  input.value='';
}
function rollAndSend(formula) {
  const result = rollDice(formula);
  const secret = document.getElementById('dmRollSecret').checked;
  socket.emit('chat:send',{code:CODE,from:'DM',text:`${formula} = ${result}`,type:'roll',secret});
}
function rollDice(formula) {
  const m = formula.match(/(\d*)d(\d+)([+-]\d+)?/i); if (!m) return '?';
  const n=parseInt(m[1]||'1',10),sides=parseInt(m[2],10),mod=parseInt(m[3]||'0',10);
  let total=mod; const rolls=[];
  for(let i=0;i<n;i++){const r=1+Math.floor(Math.random()*sides);rolls.push(r);total+=r;}
  return `${total} (${rolls.join('+')}${mod?(mod>0?'+'+mod:mod):''})`;
}

// =============================== SHOP (data table) =====================
socket.on('shop-updated', (items) => { state.shop=state.shop||{}; state.shop.items=items; renderShop(); });

function renderShop() {
  const box = document.getElementById('shopTableBody'); if (!box) return;
  let list = Object.values((state.shop&&state.shop.items)||{});
  const q = (document.getElementById('shopSearch')?.value || '').toLowerCase().trim();
  if (q) list = list.filter(it => (it.nama||'').toLowerCase().includes(q) || (it.tipe||'').toLowerCase().includes(q));
  const sort = document.getElementById('shopSort')?.value || 'name';
  list.sort((a,b) => {
    if (sort === 'price') return (parseFloat(a.harga)||0) - (parseFloat(b.harga)||0);
    if (sort === 'type') return (a.tipe||'').localeCompare(b.tipe||'');
    return (a.nama||'').localeCompare(b.nama||'');
  });
  if (!list.length) { box.innerHTML=`<tr><td colspan="5" class="hint">${q ? 'Tidak ada item yang cocok.' : 'Belum ada item.'}</td></tr>`; return; }
  box.innerHTML = list.map(it=>`
    <tr data-id="${it.id}" class="shop-row">
      <td>${escapeHtml(it.nama||'-')}</td>
      <td>🪙${escapeHtml(String(it.harga??0))}</td>
      <td>${escapeHtml(it.tipe||'-')}</td>
      <td>${it.stok===''||it.stok==null?'~':escapeHtml(String(it.stok))}</td>
      <td class="td-actions"><button type="button" class="small danger shop-del-btn" data-id="${it.id}">🗑</button></td>
    </tr>`).join('');
  box.querySelectorAll('.shop-row').forEach(row => { row.onclick=(e)=>{ if(e.target.closest('button')) return; loadShopItemToForm(state.shop.items[row.dataset.id]); }; });
  box.querySelectorAll('.shop-del-btn').forEach(btn => { btn.onclick=(e)=>{ e.stopPropagation(); if(confirm('Hapus item ini?')) socket.emit('dm:shop-delete-item',{code:CODE,itemId:btn.dataset.id}); }; });
}

function loadShopItemToForm(it) {
  document.getElementById('shop_id').value=it?.id||'';
  document.getElementById('shop_nama').value=it?.nama||'';
  document.getElementById('shop_harga').value=it?.harga??'';
  document.getElementById('shop_tipe').value=it?.tipe||'';
  document.getElementById('shop_stok').value=it?.stok??'';
  document.getElementById('shop_deskripsi').value=it?.deskripsi||'';
}
document.getElementById('btnShopResetForm').onclick=()=>loadShopItemToForm(null);
document.getElementById('btnShopSaveItem').onclick=()=>{
  const nama=document.getElementById('shop_nama').value.trim(); if(!nama) return alert('Isi nama item.');
  const item={id:document.getElementById('shop_id').value||undefined,nama,harga:parseFloat(document.getElementById('shop_harga').value)||0,tipe:document.getElementById('shop_tipe').value,stok:document.getElementById('shop_stok').value,deskripsi:document.getElementById('shop_deskripsi').value};
  socket.emit('dm:shop-save-item',{code:CODE,item},(res)=>{ if(!res?.ok) alert(res?.error||'Gagal.'); else loadShopItemToForm(null); });
};
document.getElementById('btnShopClear').onclick=()=>{ if(confirm('Kosongkan semua item toko?')) socket.emit('dm:shop-clear',{code:CODE}); };
document.getElementById('shopImportFile').addEventListener('change', (e)=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=(ev)=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws);
      rows.forEach(row=>{
        const item={nama:row.nama||row.Nama||'',harga:parseFloat(row.harga||row.Harga)||0,tipe:row.tipe||row.Tipe||'',stok:row.stok??row.Stok??'',deskripsi:row.deskripsi||row.Deskripsi||''};
        if(item.nama) socket.emit('dm:shop-save-item',{code:CODE,item});
      });
      alert(`${rows.length} item berhasil diimport.`);
    }catch(err){alert('Gagal import: '+err.message);}
    e.target.value='';
  };
  reader.readAsBinaryString(file);
});
document.getElementById('btnShopExportExcel').onclick=()=>{
  const list=Object.values((state.shop&&state.shop.items)||{});
  const ws=XLSX.utils.json_to_sheet(list.map(it=>({nama:it.nama,harga:it.harga,tipe:it.tipe,stok:it.stok,deskripsi:it.deskripsi})));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Shop');
  XLSX.writeFile(wb,'shop_items.xlsx');
};

// =============================== NOTES ================================
let notesSaveTimer=null;
document.getElementById('sessionNotes').addEventListener('input', ()=>{
  document.getElementById('notesStatus').textContent='belum tersimpan';
  clearTimeout(notesSaveTimer);
  notesSaveTimer=setTimeout(()=>{ socket.emit('dm:save-notes',{code:CODE,notes:document.getElementById('sessionNotes').value},(r)=>{ if(r?.ok) document.getElementById('notesStatus').textContent='tersimpan'; }); },1200);
});

// =============================== RENDER ALL ============================
function renderAll() {
  renderPlayers(); renderNpcs(); renderClasses(); renderBattle(); renderMusic(); renderShop(); renderLog();
  refreshBattleSourceOptions(); refreshTokenOwnerOptions();
  if (document.getElementById('tab-dm-map').style.display !== 'none') renderMap();
  const notesEl = document.getElementById('sessionNotes');
  if (notesEl && document.activeElement !== notesEl) notesEl.value = state.notes || '';
}

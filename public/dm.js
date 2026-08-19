// dm.js — DM Board logic (v2 rewrite)
const socket = io();
const CODE = localStorage.getItem('dnd_dm_code');
const DM_NAME = localStorage.getItem('dnd_dm_name');
if (!CODE || !DM_NAME) location.href = '/';

document.getElementById('codeBadge').textContent = CODE;
document.getElementById('joinLink').value = location.origin + '/  (kode: ' + CODE + ')';

const ELEMENT_KEYS = ['fire','ice','lightning','wind','earth','water','poison','dark','light','physical','magic'];

let state = {
  players: {}, playersList: [],
  npcs: {}, classes: {}, recipes: {}, map: {}, maps: {},
  tokens: {}, battle: { entries: {}, turn: { activeId: null, round: 1 } },
  music: { tracks: {}, playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false } },
  story: { scene: { title:'', desc:'', imageUrl:null, active:false }, dialogue: { npcName:'', npcPortrait:null, text:'', active:false }, quests: {} },
  shop: { items: {} }, log: [], notes: ''
};
let currentMapTabId = 'main';

// =============================== TABS ==================================
function showDmTab(name) {
  ['main','players','npc','classes','shop','craft','music','story','battle','map'].forEach(t => {
    document.getElementById('tab-dm-' + t).style.display = t === name ? '' : 'none';
  });
  document.querySelectorAll('.page-tabs button').forEach(b => b.classList.remove('active'));
  const btnMap = { main:'tabBtnDmMain', players:'tabBtnDmPlayers', npc:'tabBtnDmNpc', classes:'tabBtnDmClasses', shop:'tabBtnDmShop', craft:'tabBtnDmCraft', music:'tabBtnDmMusic', story:'tabBtnDmStory', battle:'tabBtnDmBattle', map:'tabBtnDmMap' };
  const btn = document.getElementById(btnMap[name]); if (btn) btn.classList.add('active');
  if (name === 'map') { renderMapTabs(); renderMap(); }
  if (name === 'story') { renderStory(); }
  if (name === 'craft') { renderCraftTable(); }
}
document.getElementById('tabBtnDmMain').addEventListener('click', () => showDmTab('main'));
document.getElementById('tabBtnDmPlayers').addEventListener('click', () => showDmTab('players'));
document.getElementById('tabBtnDmNpc').addEventListener('click', () => showDmTab('npc'));
document.getElementById('tabBtnDmClasses').addEventListener('click', () => showDmTab('classes'));
document.getElementById('tabBtnDmShop').addEventListener('click', () => showDmTab('shop'));
document.getElementById('tabBtnDmCraft').addEventListener('click', () => showDmTab('craft'));
document.getElementById('tabBtnDmMusic').addEventListener('click', () => showDmTab('music'));
document.getElementById('tabBtnDmStory').addEventListener('click', () => showDmTab('story'));
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
  socket.emit('dm:rejoin-session', { code: CODE, dmName: DM_NAME }, (res) => {
    if (!res.ok) { alert(res.error || 'Sesi tidak ditemukan.'); location.href = '/'; return; }
    state = res.state;
    state.playersList = state.playersList || Object.values(state.players).map(p => ({ id: p.id, name: p.name, online: !!p.socketId, nama_karakter: p.sheet.nama_karakter, kelas: p.sheet.kelas, lv: p.sheet.lv, current_hp: p.sheet.current_hp, max_hp: p.sheet.max_hp, portrait: p.sheet.portrait || null }));
    // Server kirim daftar map sebagai array [{id,name}] — ubah ke dict id->obj biar gampang dipakai renderMapTabs()
    state.maps = Object.fromEntries((state.maps||[]).map(m => [m.id, m]));
    currentMapTabId = state.activeMapId || 'main';
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

// =============================== DARK MODE ===============================
(function setupThemeToggle() {
  const btn = document.getElementById('btnThemeToggle');
  if (!btn) return;
  const apply = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    btn.textContent = dark ? '☀' : '🌙';
    try { localStorage.setItem('dnd_vtt_theme', dark ? 'dark' : 'light'); } catch(e){}
  };
  apply(document.documentElement.dataset.theme === 'dark');
  btn.addEventListener('click', () => apply(document.documentElement.dataset.theme !== 'dark'));
})();


// =============================== UTIL ==================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const escapeAttr = escapeHtml;
const escapeAttrVal = escapeHtml;
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
  renderPlayers();
  if (playerId === openPlayerId) {
    document.getElementById('playerModalBody').innerHTML = renderSheetReadonly(sheet);
    document.getElementById('currentGoldLabel').textContent = sheet.gold || '0';
    const surv = sheet.survival || { hunger: 100, hunger_max: 100, thirst: 100, thirst_max: 100 };
    document.getElementById('currentSurvivalLabel').textContent = `🍖 ${surv.hunger}/${surv.hunger_max} · 💧 ${surv.thirst}/${surv.thirst_max}`;
    const extraSlots = parseInt(sheet.inv_extra_slots, 10) || 0;
    const usedSlots = Array.isArray(sheet.inventory) ? sheet.inventory.length : 0;
    document.getElementById('invSlotLabel').textContent = `${usedSlots}/${INV_BASE_SLOTS_DM + extraSlots}`;
  }
});
socket.on('player-online', ({ id, online }) => {
  const p = (state.playersList || []).find(p => p.id === id);
  if (p) p.online = online;
  renderPlayers();
});

// Nyimpen persentase bar terakhir per player, buat deteksi kena damage/heal
// tiap kali player-card dirender ulang (elemen-nya di-rebuild total tiap render,
// jadi transisi width bawaan gak jalan sendiri — makanya di-flash manual di sini).
const prevPlayerBarPct = {};
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
    const avatarHtml = sheet.portrait
      ? `<img src="${sheet.portrait}" alt="" class="pc-avatar-img">`
      : `<span class="pc-avatar-fallback">${escapeHtml((p.nama_karakter || p.name || '?').slice(0, 1).toUpperCase())}</span>`;
    return `<div class="player-card" data-id="${p.id}">
      <div class="player-card-head">
        <span class="pc-avatar">${avatarHtml}</span>
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
      <div class="pc-foot">🍖 ${(sheet.survival&&sheet.survival.hunger) ?? 100}/${(sheet.survival&&sheet.survival.hunger_max) ?? 100} · 💧 ${(sheet.survival&&sheet.survival.thirst) ?? 100}/${(sheet.survival&&sheet.survival.thirst_max) ?? 100}</div>
      ${conds.length ? `<div class="pc-foot">🌀 ${escapeHtml(conds.join(', '))}</div>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('.player-card').forEach(el => {
    el.onclick = (e) => { if (e.target.closest('.player-quick-delete')) return; openPlayerModal(el.dataset.id); };
  });
  box.querySelectorAll('.player-quick-delete').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); confirmDeletePlayer(btn.dataset.id); };
  });
  box.querySelectorAll('.player-card').forEach(card => {
    const pid = card.dataset.id;
    card.querySelectorAll('.mini-bar-fill').forEach((fillEl, idx) => {
      const key = pid + ':' + ['hp', 'mp', 'sp'][idx];
      const pct = parseFloat(fillEl.style.width) || 0;
      const prevPct = prevPlayerBarPct[key];
      if (prevPct !== undefined && prevPct !== pct && window.BattleFX) window.BattleFX.flashBar(fillEl, pct > prevPct);
      prevPlayerBarPct[key] = pct;
    });
  });
}

const INV_BASE_SLOTS_DM = 10;
function openPlayerModal(playerId) {
  openPlayerId = playerId;
  const pData = (state.playersList || []).find(p => p.id === playerId);
  const fullData = (state.players || {})[playerId];
  const sheet = fullData?.sheet || {};
  document.getElementById('playerModalTitle').textContent = escapeHtml(pData?.nama_karakter || pData?.name || 'Player');
  document.getElementById('giveItem_playerId').value = playerId;
  document.getElementById('currentGoldLabel').textContent = sheet.gold || '0';
  document.getElementById('whisper_text').value = '';
  document.getElementById('whisperStatus').textContent = '';
  document.getElementById('dmSheetBackupStatus').textContent = '';
  const surv = sheet.survival || { hunger: 100, hunger_max: 100, thirst: 100, thirst_max: 100 };
  document.getElementById('currentSurvivalLabel').textContent = `🍖 ${surv.hunger}/${surv.hunger_max} · 💧 ${surv.thirst}/${surv.thirst_max}`;
  document.getElementById('setHunger_amount').value = '';
  document.getElementById('setThirst_amount').value = '';
  document.getElementById('progress_lv').value = sheet.lv || '';
  document.getElementById('progress_exp').value = sheet.exp || '';
  document.getElementById('progress_kelas_exp').value = sheet.kelas_exp || '';
  const extraSlots = parseInt(sheet.inv_extra_slots, 10) || 0;
  const usedSlots = Array.isArray(sheet.inventory) ? sheet.inventory.length : 0;
  document.getElementById('invSlotLabel').textContent = `${usedSlots}/${INV_BASE_SLOTS_DM + extraSlots}`;
  document.getElementById('invExtraSlots_amount').value = extraSlots;
  document.getElementById('invSlotsStatus').textContent = '';
  renderClassUnlockList(fullData?.unlockedClasses || []);
  document.getElementById('playerModalBody').innerHTML = renderSheetReadonly(sheet);
  document.getElementById('playerModal').classList.add('show');
}
document.getElementById('btnSetInvSlots').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const extraSlots = parseInt(document.getElementById('invExtraSlots_amount').value, 10) || 0;
  socket.emit('dm:set-inv-slots', { code: CODE, playerId, extraSlots }, (res) => {
    const statusEl = document.getElementById('invSlotsStatus');
    if (res?.ok) {
      statusEl.textContent = `✓ Total slot sekarang: ${res.totalSlots}.`;
      document.getElementById('invSlotLabel').textContent = document.getElementById('invSlotLabel').textContent.split('/')[0] + '/' + res.totalSlots;
    } else {
      statusEl.textContent = res?.error || 'Gagal.';
    }
  });
};
document.getElementById('btnClosePlayerModal').onclick = () => { document.getElementById('playerModal').classList.remove('show'); openPlayerId = null; };

// === Backup: Export/Import sheet player dari sisi DM (buat jaga-jaga kalau data hilang) ===
document.getElementById('btnDmExportSheet').addEventListener('click', () => {
  const playerId = document.getElementById('giveItem_playerId').value; if (!playerId) return;
  const pData = (state.playersList || []).find(p => p.id === playerId);
  const fullData = (state.players || {})[playerId];
  const sheet = fullData?.sheet || {};
  const blob = new Blob([JSON.stringify({ type: 'dnd-vtt-character-sheet', version: 2, sheet }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (sheet.nama_karakter || pData?.name || 'character').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'character';
  a.href = url; a.download = `${safeName}_sheet_backup.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  document.getElementById('dmSheetBackupStatus').textContent = '✓ Sheet berhasil di-export.';
});
document.getElementById('btnDmImportSheet').addEventListener('click', () => document.getElementById('dmImportSheetFile').click());
document.getElementById('dmImportSheetFile').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const playerId = document.getElementById('giveItem_playerId').value;
  const statusEl = document.getElementById('dmSheetBackupStatus');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const sheet = data && data.sheet ? data.sheet : data;
      if (!sheet || typeof sheet !== 'object') throw new Error('Format tidak valid.');
      if (!confirm('Pulihkan sheet ini ke player yang sedang dibuka? Data sheet player saat ini akan ditimpa.')) { e.target.value = ''; return; }
      socket.emit('dm:import-player-sheet', { code: CODE, playerId, sheet }, (res) => {
        if (res?.ok) {
          statusEl.textContent = '✓ Sheet berhasil dipulihkan.';
          openPlayerModal(playerId);
        } else {
          statusEl.textContent = res?.error || 'Gagal memulihkan sheet.';
        }
      });
    } catch (err) { statusEl.textContent = 'Gagal membaca file: ' + err.message; }
    e.target.value = '';
  };
  reader.readAsText(file);
});

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
document.getElementById('btnSendWhisper').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const input = document.getElementById('whisper_text');
  const text = input.value.trim(); if (!text) return;
  socket.emit('dm:whisper', { code: CODE, playerId, text }, (res) => {
    const statusEl = document.getElementById('whisperStatus');
    if (res?.ok) { statusEl.textContent = '✓ Terkirim (privat).'; input.value = ''; }
    else statusEl.textContent = res?.error || 'Gagal.';
  });
};
document.getElementById('whisper_text').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btnSendWhisper').click(); });
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
document.getElementById('btnSetSurvival').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const hungerRaw = document.getElementById('setHunger_amount').value;
  const thirstRaw = document.getElementById('setThirst_amount').value;
  if (hungerRaw === '' && thirstRaw === '') return;
  socket.emit('dm:set-survival', { code: CODE, playerId, hunger: hungerRaw === '' ? undefined : parseInt(hungerRaw, 10), thirst: thirstRaw === '' ? undefined : parseInt(thirstRaw, 10) }, (res) => {
    const statusEl = document.getElementById('survivalStatus');
    if (res?.ok) {
      statusEl.textContent = '✓ Lapar/haus diperbarui.';
      document.getElementById('currentSurvivalLabel').textContent = `🍖 ${res.survival.hunger}/${res.survival.hunger_max} · 💧 ${res.survival.thirst}/${res.survival.thirst_max}`;
    } else {
      statusEl.textContent = res?.error || 'Gagal.';
    }
  });
};
document.getElementById('btnSurvivalTick').addEventListener('click', () => {
  if (!confirm('Waktu berlalu — lapar & haus SEMUA player berkurang 10. Lanjut?')) return;
  socket.emit('dm:survival-tick', { code: CODE, hungerDelta: -10, thirstDelta: -10 });
});
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
document.getElementById('btnGiveXp').onclick = () => {
  const playerId = document.getElementById('giveItem_playerId').value;
  const amount = parseInt(document.getElementById('giveXp_amount').value, 10);
  if (!playerId) return alert('Pilih player dulu.');
  if (isNaN(amount) || amount <= 0) return alert('Isi jumlah XP yang valid.');
  socket.emit('dm:give-xp', { code: CODE, playerId, amount }, (res) => {
    const el = document.getElementById('giveXpStatus');
    if (res && res.ok) {
      el.textContent = res.leveledUp ? `✓ +${amount} XP — Level Up! Sekarang Level ${res.lv} (total EXP ${res.exp}).` : `✓ +${amount} XP (total EXP ${res.exp}, Level ${res.lv}).`;
      document.getElementById('giveXp_amount').value = '';
    } else {
      el.textContent = (res && res.error) || 'Gagal.';
    }
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
socket.on('npcs-update', (npcs) => { state.npcs = npcs; renderNpcs(); refreshBattleSourceOptions(); renderNpcBattleInventory(); });

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
      <td>${n.portrait?`<img src="${n.portrait}" alt="" class="token-img-preview" style="display:inline-block; width:24px; height:24px; vertical-align:middle; margin-right:4px;">`:''}${escapeHtml(n.nama||'-')}</td>
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
    ac: n.ac, refType: 'npc', refId: n.id, elements: n.elements || {}, portrait: n.portrait || null
  }});
}

let npcEditEquip = [], npcEditInv = [], npcEditPortrait = null;
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
const NPC_INV_TYPES = [
  ['misc', 'Cuma catatan'], ['heal', '💚 Heal'], ['damage', '⚔ Damage'],
  ['buff', '✨ Buff'], ['debuff', '🌀 Debuff'], ['cure', '✚ Cure Status'],
  ['revive', '💫 Revive'], ['mana_regen', '🔷 MP Regen'], ['sp_regen', '🟡 SP Regen']
];
function renderNpcInvList() {
  const box = document.getElementById('npcInvList'); box.innerHTML = '';
  npcEditInv.forEach((it, i) => {
    if (it.type === undefined) it.type = 'misc'; // data lama sebelum fitur pakai-item ditambah
    const row = document.createElement('div'); row.className = 'npc-inv-row';
    const needsFormula = it.type !== 'misc' && it.type !== 'cure';
    row.innerHTML = `<input type="checkbox" ${it.checked?'checked':''} title="Sudah dipakai/habis">
      <input type="text" value="${escapeAttr(it.item)}" placeholder="Nama item" data-f="item">
      <select data-f="type">${NPC_INV_TYPES.map(([v,l])=>`<option value="${v}" ${it.type===v?'selected':''}>${l}</option>`).join('')}</select>
      ${needsFormula ? `<input type="text" class="small-w" value="${escapeAttr(it.formula||'')}" placeholder="Formula" data-f="formula">` : ''}
      <input type="text" class="small-w" value="${escapeAttr(it.qty||'')}" placeholder="Qty" data-f="qty">
      <label style="flex:none; font-size:11px; display:flex; align-items:center; gap:2px;"><input type="checkbox" ${it.aoe?'checked':''} data-f="aoe"> AoE</label>
      <button type="button" class="row-remove">×</button>`;
    row.querySelector('input[type=checkbox][title]').addEventListener('change', e => { it.checked = e.target.checked; });
    row.querySelectorAll('input[data-f], select[data-f]').forEach(inp => {
      inp.addEventListener(inp.tagName==='SELECT'?'change':'input', e => {
        const f = e.target.dataset.f;
        it[f] = f === 'aoe' ? e.target.checked : e.target.value;
        if (f === 'type') renderNpcInvList(); // formula field muncul/ilang sesuai tipe
      });
    });
    row.querySelector('.row-remove').onclick = () => { npcEditInv.splice(i,1); renderNpcInvList(); };
    box.appendChild(row);
  });
}
document.getElementById('btnAddNpcEquip').onclick = () => { npcEditEquip.push({nama:'',atk_bonus:'',damage:''}); renderNpcEquipList(); };
document.getElementById('btnAddNpcInv').onclick = () => { npcEditInv.push({checked:false,item:'',type:'misc',formula:'',qty:'',aoe:false}); renderNpcInvList(); };

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
  npcEditPortrait = npc?.portrait || null;
  setNpcPortraitPreview(npcEditPortrait);
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
  renderNpcRelationshipList(npc);
  document.getElementById('btnDeleteNpc').style.display = npc ? 'inline-block' : 'none';
  document.getElementById('npcModal').classList.add('show');
}

// Relasi/reputasi NPC per player — cuma bisa diatur kalau NPC-nya udah pernah disimpan (punya id),
// biar gak nyimpen relasi buat NPC yang belum eksis.
function renderNpcRelationshipList(npc) {
  const box = document.getElementById('npcRelationshipList');
  if (!box) return;
  if (!npc || !npc.id) { box.innerHTML = '<p class="hint">Simpan NPC ini dulu buat bisa atur relasi.</p>'; return; }
  const players = state.playersList || Object.values(state.players || {});
  if (!players.length) { box.innerHTML = '<p class="hint">Belum ada player di sesi ini.</p>'; return; }
  const rel = npc.relationships || {};
  box.innerHTML = players.map(p => {
    const r = rel[p.id] || { value: 0, note: '' };
    return `
    <div class="row" style="margin:4px 0; gap:6px; align-items:center;">
      <span style="flex:1; min-width:100px;">${escapeHtml(p.nama_karakter || p.name)}</span>
      <input type="number" class="npc-rel-value" data-pid="${p.id}" value="${r.value||0}" min="-100" max="100" style="width:70px;" title="-100 s/d 100">
      <input type="text" class="npc-rel-note" data-pid="${p.id}" value="${escapeAttrVal(r.note||'')}" placeholder="Catatan…" style="flex:2;">
    </div>`;
  }).join('') + `<button type="button" id="btnSaveNpcRelationships" class="small secondary" style="width:100%; margin-top:6px;">Simpan Relasi</button>`;
  document.getElementById('btnSaveNpcRelationships').onclick = () => {
    const relationships = {};
    box.querySelectorAll('.npc-rel-value').forEach(inp => {
      const pid = inp.dataset.pid;
      const value = parseInt(inp.value, 10) || 0;
      const note = box.querySelector(`.npc-rel-note[data-pid="${pid}"]`)?.value || '';
      relationships[pid] = { value, note };
    });
    socket.emit('dm:npc-set-relationships', { code: CODE, npcId: npc.id, relationships }, (res) => {
      if (!res?.ok) alert(res?.error || 'Gagal simpan relasi.');
    });
  };
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
    elements, equipment: npcEditEquip, inventory: npcEditInv, skillSet: npcEditSkills, portrait: npcEditPortrait,
    relationships: (document.getElementById('npc_id').value && state.npcs[document.getElementById('npc_id').value]?.relationships) || {}
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

// =============================== MAP & GRID (fit-to-image, no zoom) ====
const mapWrap = document.getElementById('mapWrap');
const mapImg = document.getElementById('mapImg');
const mapInner = document.getElementById('mapInner');
const gridOverlay = document.getElementById('gridOverlay');

socket.on('map-updated', (map) => { state.map = map; if (document.getElementById('tab-dm-map').style.display !== 'none') renderMap(); });
// Daftar tab map (id+nama tiap map) + map mana yang lagi aktif — dikirim ulang tiap kali DM nambah/hapus/pindah/rename map.
socket.on('maps-updated', ({ maps, activeMapId }) => {
  state.maps = Object.fromEntries((maps||[]).map(m => [m.id, m]));
  state.activeMapId = activeMapId;
  currentMapTabId = activeMapId;
  renderMapTabs();
});
mapImg.addEventListener('load', () => { if (document.getElementById('tab-dm-map').style.display !== 'none') renderFogCanvasDm(); });

function renderMapTabs() {
  const bar = document.getElementById('dmMapTabsBar');
  if (!bar) return;
  const maps = Object.values(state.maps || {});
  const canDelete = maps.length > 1;
  bar.innerHTML = maps.map(m => `
    <button type="button" class="${m.id === state.activeMapId ? 'active' : ''}" data-mapid="${m.id}">
      🗺 <span class="map-tab-label">${escapeHtml(m.name || 'Map')}</span>${canDelete ? `<span class="map-tab-close" data-del-mapid="${m.id}" title="Hapus map ini">✕</span>` : ''}
    </button>`).join('') + `<button type="button" id="btnAddMapTab" class="small secondary" style="border-radius:4px;">+ Map Baru</button>`;

  bar.querySelectorAll('button[data-mapid]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-mapid]')) return; // klik tombol hapus ditangani terpisah, jangan ikut switch tab
      const mapId = btn.dataset.mapid;
      if (mapId === state.activeMapId) return;
      socket.emit('dm:map-switch', { code: CODE, mapId }, (res) => { if (!res?.ok) alert(res?.error||'Gagal pindah map.'); });
    });
    btn.addEventListener('dblclick', () => {
      const mapId = btn.dataset.mapid;
      const cur = (state.maps[mapId]||{}).name || 'Map';
      const name = prompt('Nama map:', cur);
      if (name && name.trim()) socket.emit('dm:map-rename', { code: CODE, mapId, name: name.trim() });
    });
  });
  bar.querySelectorAll('[data-del-mapid]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const mapId = el.dataset.delMapid;
      const name = (state.maps[mapId]||{}).name || 'map ini';
      if (!confirm(`Hapus "${name}"? Semua token & fog di map ini ikut terhapus.`)) return;
      socket.emit('dm:map-delete', { code: CODE, mapId }, (res) => { if (!res?.ok) alert(res?.error||'Gagal menghapus map.'); });
    });
  });
  const addBtn = document.getElementById('btnAddMapTab');
  if (addBtn) addBtn.onclick = () => {
    const name = prompt('Nama map baru:', `Map ${maps.length + 1}`);
    if (name === null) return; // dibatalkan
    socket.emit('dm:map-add', { code: CODE, name: name.trim() || `Map ${maps.length + 1}` }, (res) => {
      if (!res?.ok) alert(res?.error||'Gagal membuat map baru.');
    });
  };
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
  const cx = e.clientX, cy = e.clientY;
  const x = (cx - rect.left) / rect.width;
  const y = (cy - rect.top) / rect.height;
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
  // toggle touch-action:none di CSS supaya nyapu kabut pakai jari di HP
  // gak ke-intercept sama gesture scroll bawaan browser
  mapWrap.classList.toggle('fog-brush-active', fogBrushActive);
});

// Pointer Events (bukan mouse events) supaya kuas fog jalan juga lewat
// sentuhan jari di HP/tablet, bukan cuma mouse di desktop.
mapWrap.addEventListener('pointerdown', (e) => {
  if (!fogBrushActive || e.target.closest('.token')) return;
  e.preventDefault();
  fogPainting = true;
  fogPaintReveal = !e.shiftKey;
  fogPaintedThisStroke = new Set();
  paintFogAt(e);
});
window.addEventListener('pointermove', (e) => { if (fogPainting) paintFogAt(e); });
window.addEventListener('pointerup', () => {
  if (!fogPainting) return;
  fogPainting = false;
  if (fogPaintedThisStroke.size) {
    socket.emit('dm:fog-paint', { code: CODE, cells: [...fogPaintedThisStroke], reveal: fogPaintReveal });
  }
  fogPaintedThisStroke = new Set();
});
window.addEventListener('pointercancel', () => { fogPainting = false; fogPaintedThisStroke = new Set(); });

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

function renderMap() {
  const map = state.map || {};
  if (map.imageUrl) {
    mapImg.src = map.imageUrl;
    mapImg.style.display = 'block';
    mapWrap.classList.remove('no-image');
  } else {
    mapImg.removeAttribute('src');
    mapImg.style.display = 'none';
    mapWrap.classList.add('no-image');
  }
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
  renderFogCanvasDm();
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

// Potret NPC — sama kayak portrait player, dikompres ke thumbnail kecil di klien dulu.
function setNpcPortraitPreview(dataUrl) {
  const img = document.getElementById('npcPortraitImg');
  const ph = document.getElementById('npcPortraitPlaceholder');
  const rm = document.getElementById('btnRemoveNpcPortrait');
  if (!img || !ph || !rm) return;
  if (dataUrl) { img.src = dataUrl; img.style.display = ''; ph.style.display = 'none'; rm.style.display = ''; }
  else { img.style.display = 'none'; img.src = ''; ph.style.display = ''; rm.style.display = 'none'; }
}
document.getElementById('npcPortraitWrap').addEventListener('click', () => document.getElementById('npcPortraitFile').click());
document.getElementById('npcPortraitFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { alert('File harus berupa gambar.'); e.target.value = ''; return; }
  npcEditPortrait = await compressImageFile(file, 256, 0.85);
  setNpcPortraitPreview(npcEditPortrait);
  e.target.value = '';
});
document.getElementById('btnRemoveNpcPortrait').addEventListener('click', (e) => {
  e.stopPropagation(); npcEditPortrait = null; setNpcPortraitPreview(null);
});

// =============================== TOKENS ================================
socket.on('tokens-updated', (tokens) => { state.tokens = tokens; renderTokens(); refreshTokenOwnerOptions(); if (aoeCenter) computeAoeAffected(); });

function refreshTokenOwnerOptions() {
  const sel = document.getElementById('tokenOwner');
  const cur = sel.value;
  const list = state.playersList || [];
  sel.innerHTML = '<option value="">Tidak dimiliki player</option>' +
    list.map(p => `<option value="${p.id}">${escapeHtml(p.nama_karakter || p.name)}</option>`).join('');
  if (list.some(p => p.id === cur)) sel.value = cur;
}

// Kalau DM pilih owner player (dan belum upload gambar token sendiri),
// tampilkan preview portrait karakter itu — gambar ini yang otomatis
// dipakai jadi token kalau DM tidak upload gambar token custom.
document.getElementById('tokenOwner').addEventListener('change', (e) => {
  if (tokenImageDataUrl) return; // DM sudah pilih gambar token custom, jangan ditimpa
  const preview = document.getElementById('tokenImgPreview');
  const ownerId = e.target.value;
  const p = (state.playersList || []).find(p => p.id === ownerId);
  if (p && p.portrait) { preview.src = p.portrait; preview.style.display = 'inline-block'; }
  else { preview.style.display = 'none'; preview.src = ''; }
});

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
let dmDragStartX = 0, dmDragStartY = 0, dmDragMoved = false, dmLongPressTimer = null;
const LONG_PRESS_MS = 550, LONG_PRESS_MOVE_TOLERANCE = 8;

// Pointer Events dipakai (bukan mouse events) supaya drag token jalan juga
// lewat sentuhan jari di HP/tablet, bukan cuma mouse di desktop.
window.addEventListener('pointermove', (e) => {
  if (!draggingTokenId) return;
  if (!dmDragMoved) {
    const dx = e.clientX - dmDragStartX, dy = e.clientY - dmDragStartY;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) { dmDragMoved = true; clearTimeout(dmLongPressTimer); }
  }
  const el = mapInner.querySelector(`.token[data-id="${draggingTokenId}"]`); if (!el) return;
  const rect = mapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  el.style.left = x + '%'; el.style.top = y + '%';
});
window.addEventListener('pointerup', (e) => {
  clearTimeout(dmLongPressTimer);
  if (!draggingTokenId) return;
  const id = draggingTokenId; draggingTokenId = null;
  if (!dmDragMoved) return; // dianggap tap/long-press, bukan drag — jangan kirim token:move
  const rect = mapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  socket.emit('token:move', { code: CODE, tokenId: id, x, y });
});
window.addEventListener('pointercancel', () => { clearTimeout(dmLongPressTimer); draggingTokenId = null; });

function renderTokens() {
  mapInner.querySelectorAll('.token').forEach(el => el.remove());
  Object.values(state.tokens || {}).forEach(tok => {
    const el = document.createElement('div');
    el.className = 'token draggable';
    el.style.left = tok.x + '%'; el.style.top = tok.y + '%';
    el.dataset.id = tok.id;

    // Nama selalu tampil sebagai label di atas token — DM juga perlu gampang
    // bedain siapa itu siapa waktu token numpuk di peta.
    const nametag = document.createElement('div'); nametag.className = 'token-nametag';
    nametag.textContent = tok.label || '';
    el.appendChild(nametag);

    const circle = document.createElement('div');
    circle.className = 'token-circle';
    circle.style.background = tok.imageUrl ? 'transparent' : (tok.color || '#555');
    if (tok.type === 'enemy') circle.style.borderColor = '#e07a6b';
    else if (tok.type === 'ally') circle.style.borderColor = '#7bd39a';
    else if (tok.type === 'npc') circle.style.borderColor = '#c9a3f0';

    if (tok.imageUrl) {
      const img = document.createElement('img'); img.src = tok.imageUrl; img.className = 'token-img'; img.draggable = false;
      circle.appendChild(img);
    } else {
      circle.textContent = (tok.label || '').slice(0, 2);
    }
    el.appendChild(circle);

    el.title = (tok.label || '') + (tok.ownerId ? ' (milik player)' : '');
    // Desktop: klik-kanan buat hapus (contextmenu). HP/tablet: contextmenu gak
    // reliable disentuh, jadi tekan-tahan (long-press) tanpa geser = hapus juga.
    el.addEventListener('pointerdown', (e) => {
      draggingTokenId = tok.id;
      dmDragStartX = e.clientX; dmDragStartY = e.clientY; dmDragMoved = false;
      e.preventDefault(); e.stopPropagation();
      if (e.pointerType === 'touch') {
        clearTimeout(dmLongPressTimer);
        dmLongPressTimer = setTimeout(() => {
          if (draggingTokenId === tok.id && !dmDragMoved) {
            draggingTokenId = null;
            if (confirm('Hapus token "' + (tok.label || '') + '"?')) {
              socket.emit('token:remove', { code: CODE, tokenId: tok.id });
            }
          }
        }, LONG_PRESS_MS);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm('Hapus token "' + (tok.label || '') + '"?')) {
        socket.emit('token:remove', { code: CODE, tokenId: tok.id });
      }
    });
    mapInner.appendChild(el);
  });
}

// =============================== AoE TEMPLATE (lingkaran area di map) =====
// Token & battle entry di project ini nyambungnya lewat NAMA yang sama (bukan ID),
// jadi pencocokan token yang kena area juga pakai cara yang sama biar konsisten
// sama battle-fx.js.
let aoeMode = false;
let aoeCenter = null; // {xPct, yPct}
let aoeAffectedIds = [];

function aoeRadiusPct() { return parseInt(document.getElementById('aoeRadius').value, 10) || 15; }

function renderAoeCircle() {
  const overlay = document.getElementById('aoeCircleOverlay');
  if (!aoeCenter) { overlay.style.display = 'none'; return; }
  const w = mapInner.offsetWidth || 800, h = mapInner.offsetHeight || 500;
  const rPx = (aoeRadiusPct() / 100) * Math.min(w, h);
  overlay.style.display = '';
  overlay.style.left = aoeCenter.xPct + '%';
  overlay.style.top = aoeCenter.yPct + '%';
  overlay.style.width = (rPx * 2) + 'px';
  overlay.style.height = (rPx * 2) + 'px';
}

function computeAoeAffected() {
  mapInner.querySelectorAll('.token.aoe-hit').forEach(t => t.classList.remove('aoe-hit'));
  aoeAffectedIds = [];
  const resultBox = document.getElementById('aoeResultBox');
  if (!aoeCenter) { resultBox.style.display = 'none'; return; }
  const w = mapInner.offsetWidth || 800, h = mapInner.offsetHeight || 500;
  const rPx = (aoeRadiusPct() / 100) * Math.min(w, h);
  const battleEntries = Object.values((state.battle && state.battle.entries) || {});
  const affectedNames = [];
  Object.values(state.tokens || {}).forEach(tok => {
    if (tok.isOverlay) return;
    const dx = (tok.x - aoeCenter.xPct) * (w / 100);
    const dy = (tok.y - aoeCenter.yPct) * (h / 100);
    if (Math.sqrt(dx * dx + dy * dy) > rPx) return;
    const tokenEl = mapInner.querySelector(`.token[data-id="${tok.id}"]`);
    if (tokenEl) tokenEl.classList.add('aoe-hit');
    const entry = battleEntries.find(e => e.name === tok.label);
    if (entry) { aoeAffectedIds.push(entry.id); affectedNames.push(entry.name); }
  });
  resultBox.style.display = '';
  resultBox.innerHTML = affectedNames.length
    ? `🎯 Kena area: <strong>${affectedNames.map(n=>escapeHtml(n)).join(', ')}</strong> — <button type="button" id="btnAoeApplyToPanel" class="small">Pakai sebagai Target Aksi Roll</button>`
    : 'Belum ada token battle yang kena area ini.';
  const applyBtn = document.getElementById('btnAoeApplyToPanel');
  if (applyBtn) applyBtn.onclick = applyAoeToActionPanel;
}

// Nembakin action/skill yang lagi diset di panel "🎯 Aksi Roll DM" ke SEMUA target yang kena
// lingkaran AoE, satu-satu — dipilih ini (bukan nambah dukungan target custom di server) biar
// tetap kompatibel sama skill NPC, item, elemental, dll yang udah ada tanpa ubah banyak.
function applyAoeToActionPanel() {
  if (!aoeAffectedIds.length) return;
  if (!confirm(`Terapkan aksi yang lagi diset ke ${aoeAffectedIds.length} target yang kena area?`)) return;
  aoeAffectedIds.forEach(id => performDmActionRoll(id));
}

document.getElementById('btnAoeMode').addEventListener('click', () => {
  aoeMode = !aoeMode;
  const btn = document.getElementById('btnAoeMode');
  btn.textContent = aoeMode ? '🎯 Mode AoE: ON' : '🎯 Mode AoE: OFF';
  btn.classList.toggle('active', aoeMode);
  mapWrap.style.cursor = aoeMode ? 'crosshair' : 'grab';
});
document.getElementById('aoeRadius').addEventListener('input', () => { renderAoeCircle(); computeAoeAffected(); });
document.getElementById('btnAoeClear').addEventListener('click', () => {
  aoeCenter = null; aoeAffectedIds = [];
  document.getElementById('aoeCircleOverlay').style.display = 'none';
  document.getElementById('aoeResultBox').style.display = 'none';
  mapInner.querySelectorAll('.token.aoe-hit').forEach(t => t.classList.remove('aoe-hit'));
});
mapWrap.addEventListener('pointerdown', (e) => {
  if (!aoeMode || e.target.closest('.token')) return;
  const rect = mapInner.getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width) * 100;
  const yPct = ((e.clientY - rect.top) / rect.height) * 100;
  if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;
  aoeCenter = { xPct, yPct };
  renderAoeCircle();
  computeAoeAffected();
});

// =============================== BATTLE ================================
socket.on('battle-updated', (battle) => {
  const prevEntries = (state.battle && state.battle.entries) || {};
  const prevActiveId = state.battle && state.battle.turn && state.battle.turn.activeId;
  state.battle = battle;
  renderBattle();
  if (window.BattleFX) window.BattleFX.processBattleUpdate({ prevEntries, battle, mapInnerEl: mapInner, prevActiveId });
});
socket.on('battle:action-fx', (fx) => { if (window.BattleFX) window.BattleFX.showVsCard(fx); });

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

function statStepperHtml(field, ro, dir) {
  // Tombol −/+ cepat buat HP/MP/SP — ngedit lewat tap jauh lebih gampang di HP
  // daripada buka keyboard angka & ketik manual tiap kali kena damage.
  if (ro) return '';
  return dir === 'minus'
    ? `<button type="button" class="stepper-btn" data-f="${field}" data-step="-1" title="-1">−</button>`
    : `<button type="button" class="stepper-btn" data-f="${field}" data-step="1" title="+1">+</button>`;
}

// Status ciutkan/perluas tiap baris peserta battle — disimpan terpisah dari data battle-nya sendiri
// (cuma preferensi tampilan DM), jadi gak ke-reset tiap kali ada update dari server.
let rowCollapsedState = new Map();

function renderBattle() {
  const turn = (state.battle && state.battle.turn) || { activeId: null, round: 1 };
  document.getElementById('roundBadge').textContent = 'Round ' + (turn.round || 1);
  const statsBox = document.getElementById('battleStatsBox');
  if (statsBox) {
    const stats = (state.battle && state.battle.stats) || {};
    const rows = Object.entries(stats).map(([actor, s]) => `${escapeHtml(actor)}: ${s.hits||0} kena (${s.crits||0} crit) / ${s.misses||0} meleset`);
    statsBox.textContent = rows.length ? `📊 ${rows.join(' | ')}` : '';
  }
  const list = sortedBattle();
  const box = document.getElementById('battleList');
  if (!list.length) { box.innerHTML = '<p class="hint">Belum ada peserta battle.</p>'; return; }
  // Peserta baru default keciutkan (kecuali yang lagi giliran jalan) — begitu battle rame,
  // DM gak perlu scroll ngelewatin puluhan baris penuh HP/MP/SP/buff tiap orang.
  list.forEach(e => { if (!rowCollapsedState.has(e.id)) rowCollapsedState.set(e.id, e.id !== turn.activeId); });
  box.innerHTML = list.map(e => {
    const isPc = e.type === 'pc';
    const ro = isPc ? 'readonly' : '';
    const collapsed = rowCollapsedState.get(e.id);
    const elemStr = e.elements ? Object.entries(e.elements).filter(([,v])=>v&&v!=='0'&&v!=='0%').map(([k,v])=>`<span class="elem-badge">${k}:${v}</span>`).join(' ') : '';
    const condStr = (e.conditions||[]).map(c=>`<span class="hint cond-tag" data-cond="${escapeAttr(c)}">${escapeHtml(c)} <button type="button" class="cond-remove" data-cond="${escapeAttr(c)}" title="Cabut kondisi ini">×</button></span>`).join(' ');
    const isDying = (e.conditions||[]).includes('Sekarat');
    const ds = e.death_saves || { success: 0, fail: 0 };
    const deathSaveBlock = isDying ? `
      <div class="row" style="margin:4px 0 0; align-items:center; gap:6px;">
        <span class="hint" style="color:var(--crimson-bright);">💀 Sekarat: ${ds.success}✓ / ${ds.fail}✗</span>
        <button type="button" class="small secondary death-save-btn">🎲 Death Save</button>
      </div>` : '';
    const avatarHtml = e.portrait ? `<img src="${e.portrait}" alt="" class="b-avatar-img">` : '';
    const hpNow = e.hp_current ?? '-', hpMax = e.hp_max ?? '-';
    return `<div class="battle-row ${e.id===turn.activeId?'active':''} ${collapsed?'row-collapsed':''}" data-id="${e.id}">
      <div class="roll-num">${e.roll??'-'}</div>
      <div class="b-info">
        <div class="b-name-row" style="cursor:pointer;" data-row-toggle>
          ${avatarHtml}<div class="b-name">${escapeHtml(e.name)} <span class="type-pill ${e.type}">${e.type}</span>${isPc?' <span class="hint">(pantau saja)</span>':''}</div>${e.id===turn.activeId?'<span class="turn-flag">▶ GILIRAN</span>':''}
          ${collapsed?`<span class="hint">❤ ${hpNow}/${hpMax}</span>`:''}
          <button type="button" class="row-toggle" title="${collapsed?'Perluas detail':'Ciutkan detail'}">${collapsed?'▾':'▴'}</button>
        </div>
        ${elemStr?`<div style="margin-top:2px;">${elemStr}</div>`:''}
        ${condStr?`<div style="margin-top:2px;">${condStr}</div>`:''}
        <div class="battle-row-details" style="${collapsed?'display:none;':''}">
          <div class="row stat-row" style="margin:3px 0 0;"><span class="stat-label">HP</span>${statStepperHtml('hp_current', ro, 'minus')}<input type="number" data-f="hp_current" value="${e.hp_current??''}" placeholder="now" ${ro}>${statStepperHtml('hp_current', ro, 'plus')}<span class="hint">/</span><input type="number" data-f="hp_max" value="${e.hp_max??''}" placeholder="max" ${ro}></div>
          <div class="row stat-row" style="margin:3px 0 0;"><span class="stat-label">MP</span>${statStepperHtml('mp_current', ro, 'minus')}<input type="number" data-f="mp_current" value="${e.mp_current??''}" placeholder="now" ${ro}>${statStepperHtml('mp_current', ro, 'plus')}<span class="hint">/</span><input type="number" data-f="mp_max" value="${e.mp_max??''}" placeholder="max" ${ro}></div>
          <div class="row stat-row" style="margin:3px 0 0;"><span class="stat-label">SP</span>${statStepperHtml('sp_current', ro, 'minus')}<input type="number" data-f="sp_current" value="${e.sp_current??''}" placeholder="now" ${ro}>${statStepperHtml('sp_current', ro, 'plus')}<span class="hint">/</span><input type="number" data-f="sp_max" value="${e.sp_max??''}" placeholder="max" ${ro}></div>
          <div class="row stat-row" style="margin:3px 0 0;"><span class="stat-label">AC</span><input type="number" data-f="ac" value="${e.ac??''}" placeholder="AC" ${ro}></div>
          ${!isPc ? renderEntryBuffsHtml(e) : ''}
        </div>
        ${collapsed && !isDying ? '' : deathSaveBlock}
      </div>
      <button type="button" class="row-remove" title="Hapus dari battle">×</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.battle-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('.row-toggle, [data-row-toggle]').forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.b-name-row') && ev.target.tagName === 'IMG') return;
        rowCollapsedState.set(id, !rowCollapsedState.get(id));
        renderBattle();
      });
    });
    row.querySelectorAll('input:not([readonly])').forEach(inp => {
      inp.addEventListener('change', e => { socket.emit('dm:battle-update', { code: CODE, id, patch: { [e.target.dataset.f]: e.target.value } }); });
      inp.addEventListener('click', e => e.stopPropagation());
    });
    row.querySelectorAll('.stepper-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const input = btn.closest('.stat-row').querySelector(`input[data-f="${btn.dataset.f}"]`);
        if (!input || input.readOnly) return;
        const next = Math.max(0, (parseFloat(input.value) || 0) + parseFloat(btn.dataset.step));
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    row.querySelector('.row-remove').onclick = (ev) => { ev.stopPropagation(); socket.emit('dm:battle-remove', { code: CODE, id }); };
    row.querySelectorAll('.cond-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        socket.emit('battle:remove-status', { code: CODE, targetId: id, condition: btn.dataset.cond }, (res) => {
          if (!res || !res.ok) alert((res && res.error) || 'Gagal mencabut kondisi.');
        });
      };
    });
    const dsBtn = row.querySelector('.death-save-btn');
    if (dsBtn) dsBtn.onclick = (ev) => { ev.stopPropagation(); socket.emit('battle:death-save', { code: CODE, targetId: id }, (res) => {
      if (!res || !res.ok) alert((res && res.error) || 'Gagal roll death save.');
    }); };
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
document.getElementById('btnCollapseAllBattle').addEventListener('click', () => {
  sortedBattle().forEach(e => rowCollapsedState.set(e.id, true));
  renderBattle();
});
document.getElementById('btnExpandAllBattle').addEventListener('click', () => {
  sortedBattle().forEach(e => rowCollapsedState.set(e.id, false));
  renderBattle();
});

function refreshDmActionTargetOptions() {
  const sel = document.getElementById('dmActionTarget'); if (!sel) return;
  const prevVal = sel.value;
  const list = sortedBattle();
  // Opsi AoE buat DM juga — mis. serangan boss ke semua PC sekaligus, tanpa klik satu-satu.
  const hasEnemy = list.some(e=>e.type==='enemy');
  const hasAlly = list.some(e=>e.type==='pc'||e.type==='ally');
  const aoeOpts = [];
  if (hasAlly) aoeOpts.push(`<option value="__aoe_ally__">💥 Semua Sekutu/PC (AoE)</option>`);
  if (hasEnemy) aoeOpts.push(`<option value="__aoe_enemy__">💥 Semua Musuh (AoE)</option>`);
  if (list.length > 1) aoeOpts.push(`<option value="__aoe_all__">💥 Semua Peserta (AoE)</option>`);
  const optsHtml = aoeOpts.join('') + (list.map(e=>`<option value="${e.id}">${escapeHtml(e.name)} (${e.type})</option>`).join('')||'<option value="">(belum ada)</option>');
  sel.innerHTML = optsHtml;
  if (list.some(e=>e.id===prevVal) || prevVal.startsWith('__aoe_')) sel.value = prevVal;
  const sel2 = document.getElementById('dmStatusTarget');
  if (sel2) { const prev2 = sel2.value; sel2.innerHTML = sel.innerHTML; if (list.some(e=>e.id===prev2) || prev2.startsWith('__aoe_')) sel2.value = prev2; }
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
  renderNpcBattleInventory();
}

// Panel "Pakai Item" buat NPC di panel Aksi Roll — mirip punya player, tapi khusus NPC yang lagi
// jadi Aktor. Nge-list item yang punya Tipe selain "Cuma catatan" & belum dicoret/abis.
function renderNpcBattleInventory() {
  const box = document.getElementById('npcBattleInvBox'); if (!box) return;
  const actorId = document.getElementById('dmActionActor').value;
  const entry = actorId ? (state.battle?.entries||{})[actorId] : null;
  const npc = entry?.refType==='npc' ? (state.npcs||{})[entry.refId] : null;
  const items = (npc?.inventory||[]).map((it,i)=>({...it, _i:i})).filter(it => it.item && it.type && it.type!=='misc' && !it.checked);
  if (!items.length) { box.innerHTML = ''; return; }
  const typeLabel = Object.fromEntries(NPC_INV_TYPES);
  let html = '<p class="hint" style="margin:0 0 4px;">🎒 Item NPC (bisa langsung dipakai):</p>';
  items.forEach(it => {
    html += `<div class="row" style="margin-top:3px; align-items:center;">
      <span class="hint" style="flex:1;">${escapeHtml(it.item)} <span class="hint">(${typeLabel[it.type]||it.type}${it.formula?' · '+escapeHtml(it.formula):''}${it.aoe?' · 💥AoE':''}${it.qty?' · qty '+escapeHtml(it.qty):''})</span></span>
      <button type="button" class="small" data-npc-inv-i="${it._i}">⚡ Pakai</button>
    </div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll('[data-npc-inv-i]').forEach(btn => {
    btn.onclick = () => useNpcInventoryInBattle(entry, npc, parseInt(btn.dataset.npcInvI, 10));
  });
}

const NPC_INV_TYPE_TO_ACTION = { heal:'heal', damage:'damage', buff:'buff', debuff:'debuff', mana_regen:'mana_regen', sp_regen:'sp_regen' };

function useNpcInventoryInBattle(entry, npc, idx) {
  const it = npc?.inventory?.[idx]; if (!it) return;
  const targetSel = document.getElementById('dmActionTarget');
  const targetId = targetSel ? targetSel.value : '';
  if (!targetId) return alert('Pilih target dulu.');
  const status = document.getElementById('dmActionStatus');
  const effectiveTargetId = it.aoe ? (it.type==='heal'||it.type==='buff'||it.type==='cure'||it.type==='revive'||it.type==='mana_regen'||it.type==='sp_regen' ? '__aoe_ally__' : '__aoe_enemy__') : targetId;
  const finish = (msg) => {
    socket.emit('dm:npc-consume-item', { code: CODE, npcId: npc.id, itemIndex: idx });
    if (status) status.textContent = msg;
  };

  if (it.type === 'cure' || it.type === 'revive') {
    socket.emit('battle:apply-status', { code: CODE, targetId: it.aoe ? '__aoe_ally__' : targetId, condition: 'Normal', actorName: entry.name }, (res) => {
      if (res && res.ok) finish(`✓ ${entry.name} pakai "${it.item}".`);
      else if (status) status.textContent = res?.error || 'Gagal.';
    });
    return;
  }
  const actionType = NPC_INV_TYPE_TO_ACTION[it.type] || 'buff';
  const formula = it.formula || '1d6';
  socket.emit('battle:roll-action', { code: CODE, targetId: effectiveTargetId, actionType, formula, actorName: entry.name, note: `Item: ${it.item}` }, (res) => {
    if (res && res.ok) finish(`✓ ${entry.name} pakai "${it.item}": ${formula}.`);
    else if (status) status.textContent = res?.error || 'Gagal.';
  });
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

function performDmActionRoll(explicitTargetId) {
  const actorId = document.getElementById('dmActionActor').value;
  if (!actorId) return alert('Pilih Aktor dulu.');
  const actorEntry = (state.battle?.entries||{})[actorId]; if (!actorEntry) return;
  const targetId = explicitTargetId || document.getElementById('dmActionTarget').value; if (!targetId) return alert('Pilih target dulu.');
  const actionType = document.getElementById('dmActionType').value;
  if ((actorEntry.conditions||[]).includes('Silenced') && document.getElementById('dmActionSkill').value) return alert(`${actorEntry.name} lagi Silenced, gak bisa pakai skill!`);
  if ((actorEntry.conditions||[]).includes('Fear') && actionType === 'ultimate') return alert(`${actorEntry.name} lagi Fear, gak bisa pakai Ultimate!`);
  const formula = document.getElementById('dmActionFormula').value.trim() || '1d6';
  const elementType = document.getElementById('dmActionElement').value;
  const status = document.getElementById('dmActionStatus');

  // Elemental bonus dari NPC
  const elemPct = elementType && actorEntry.elements ? (parseFloat(actorEntry.elements[elementType]) || 0) : 0;
  // Elemental resistance target
  const targetEntry = (state.battle?.entries||{})[targetId];
  const targetElemPct = elementType && targetEntry?.elements ? (parseFloat(targetEntry.elements[elementType]) || 0) : 0;

  const skillVal = document.getElementById('dmActionSkill').value;
  const isReaction = document.getElementById('dmActionIsReaction').checked;
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
  socket.emit('battle:roll-action', { code: CODE, targetId, actionType, formula, actorName: actorEntry.name, note, elementType, elemBonus: elemPct, usingSkill: !!skillVal, isReaction }, (res) => {
    if (res && res.ok) {
      if (mpCost>0||spCost>0) {
        const patch = {};
        if (mpCost>0) patch.mp_current = (parseFloat(actorEntry.mp_current)||0)-mpCost;
        if (spCost>0) patch.sp_current = (parseFloat(actorEntry.sp_current)||0)-spCost;
        socket.emit('dm:battle-update', { code: CODE, id: actorId, patch });
      }
      const elemTag = elemPct ? ` [${elementType} ${elemPct > 0 ? '+' : ''}${elemPct}%]` : '';
      if (res.aoe) {
        const summary = (res.results||[]).map(r=>`${r.entryName}${r.hit?(r.hit.result==='miss'?' (meleset)':r.hit.crit?' (CRIT!)':''):''}: ${r.roll.total}`).join(', ');
        status.textContent = `💥 ${actorEntry.name} → ${formula} (AoE ke ${res.results.length} target): ${summary}.`;
      } else {
        const hitTxt = res.hit ? (res.hit.result === 'miss' ? ' — ❌ Meleset!' : res.hit.crit ? ' — 💢 Critical Hit!' : ' — 🎯 Kena!') : '';
        status.textContent = `✓ ${actorEntry.name} → ${formula} = ${res.roll.total}.${hitTxt}${elemTag}`;
      }
      if (!explicitTargetId) { document.getElementById('dmActionFormula').value = ''; document.getElementById('dmActionSkill').value = ''; document.getElementById('dmActionIsReaction').checked = false; }
    } else { status.textContent = res?.error||'Gagal.'; }
  });
}
document.getElementById('btnDmActionRoll').onclick = () => performDmActionRoll();

// Apply status condition
document.getElementById('btnDmApplyStatus').onclick = () => {
  const targetId = document.getElementById('dmStatusTarget').value; if (!targetId) return;
  const condition = document.getElementById('dmStatusCondition').value; if (!condition) return;
  socket.emit('battle:apply-status', { code: CODE, targetId, condition, actorName: 'DM' }, (res) => {
    if (res?.ok && res.aoe) document.getElementById('dmStatusStatus').textContent = `💥 Kondisi "${condition}" diterapkan ke ${res.affected.join(', ')}.`;
    else document.getElementById('dmStatusStatus').textContent = res?.ok ? `✓ Kondisi "${condition}" diterapkan.` : (res?.error||'Gagal.');
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
    entry = { name: p.nama_karakter||p.name, type, roll, hp_max: hpMax||p.max_hp, hp_current: hpMax||p.current_hp, mp_max: mpMax||sheet.mp_max, mp_current: mpMax||sheet.mp_current, sp_max: spMax||sheet.sp_max, sp_current: spMax||sheet.sp_current, ac: ac||sheet.ac, initiative: sheet.initiative || 0, refType:'player', refId: id, portrait: sheet.portrait || null };
  } else {
    const id = document.getElementById('battleSourceRef').value;
    const n = (state.npcs||{})[id]; if (!n) return alert('Pilih NPC.');
    entry = { name: n.nama, type, roll, hp_max: hpMax||n.hp_max, hp_current: hpMax||n.hp_current, mp_max: mpMax||n.mp_max, mp_current: mpMax||n.mp_current, sp_max: spMax||n.sp_max, sp_current: spMax||n.sp_current, ac: ac||n.ac, initiative: n.initiative || 0, refType:'npc', refId: id, elements: n.elements||{} };
  }
  socket.emit('dm:battle-add', { code: CODE, entry }, () => {
    ['battleRoll','battleHpMax','battleMpMax','battleSpMax','battleAc'].forEach(id => { document.getElementById(id).value = ''; });
  });
};
document.getElementById('btnBattleNext').onclick = () => socket.emit('dm:battle-next', { code: CODE });
document.getElementById('btnRollInitiative').onclick = () => {
  socket.emit('dm:battle-roll-initiative', { code: CODE }, (res) => {
    if (!res || !res.ok) alert((res && res.error) || 'Gagal roll initiative.');
  });
};
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

// Mute di sisi DM: cuma senyap LOKAL di layar DM — musiknya tetap main
// terus untuk semua player (gak ikut ke-pause/stop), dan gak ketimpa
// tiap kali ada update musik dari server.
let dmMuted = false;
function applyDmMusicMuteState() {
  const pb = (state.music && state.music.playback) || {};
  dmMusicPlayer.muted = dmMuted;
  if (ytReady && ytPlayer && typeof ytPlayer.setVolume === 'function') {
    ytPlayer.setVolume(dmMuted ? 0 : Math.round((pb.volume ?? 0.7) * 100));
  }
}
function syncMusicPlayer() {
  const pb = (state.music && state.music.playback)||{};
  const track = pb.trackId && state.music.tracks ? state.music.tracks[pb.trackId] : null;
  if (track && track.type === 'youtube') {
    dmMusicPlayer.pause(); dmMusicPlayer.removeAttribute('src'); dmMusicPlayer.dataset.trackId='';
    if (!ytReady||!ytPlayer) return;
    if (ytLoadedId!==track.videoId) { ytLoadedId=track.videoId; if(pb.isPlaying) ytPlayer.loadVideoById(track.videoId); else ytPlayer.cueVideoById(track.videoId); }
    applyDmMusicMuteState();
    if (pb.isPlaying) { const t=Math.max(0,(Date.now()-pb.startTs)/1000); if(typeof ytPlayer.getCurrentTime==='function'&&Math.abs((ytPlayer.getCurrentTime()||0)-t)>1.5) ytPlayer.seekTo(t,true); ytPlayer.playVideo(); }
    else { ytPlayer.pauseVideo(); if(pb.position) ytPlayer.seekTo(pb.position,true); }
    return;
  }
  if (ytReady&&ytPlayer&&ytLoadedId) { ytPlayer.stopVideo(); ytLoadedId=null; }
  dmMusicPlayer.loop=!!pb.loop; dmMusicPlayer.volume=pb.volume??0.7;
  applyDmMusicMuteState();
  if (!track) { dmMusicPlayer.pause(); dmMusicPlayer.removeAttribute('src'); return; }
  if (dmMusicPlayer.dataset.trackId!==pb.trackId) { dmMusicPlayer.src=track.url; dmMusicPlayer.dataset.trackId=pb.trackId; }
  if (pb.isPlaying) {
    const t=Math.max(0,(Date.now()-pb.startTs)/1000);
    if(Math.abs((dmMusicPlayer.currentTime||0)-t)>1.5) dmMusicPlayer.currentTime=t;
    dmMusicPlayer.play().catch(()=>{});
  } else { dmMusicPlayer.pause(); dmMusicPlayer.currentTime=pb.position||0; }
}
document.addEventListener('click', ()=>{ if(!dmMusicUnlocked){dmMusicUnlocked=true;syncMusicPlayer();} }, {once:true});
const btnMusicMuteDm = document.getElementById('btnMusicMuteDm');
if (btnMusicMuteDm) btnMusicMuteDm.addEventListener('click', () => {
  // Cuma toggle senyap lokal di layar DM — musik tetap main untuk semua player.
  dmMuted = !dmMuted;
  btnMusicMuteDm.textContent = dmMuted ? '🔇' : '🔊';
  applyDmMusicMuteState();
});

function renderMusic() {
  let tracks = Object.values((state.music&&state.music.tracks)||{});
  const q = (document.getElementById('musicSearch')?.value || '').toLowerCase().trim();
  if (q) tracks = tracks.filter(t => (t.name||'').toLowerCase().includes(q));
  const pb = (state.music&&state.music.playback)||{};
  const box = document.getElementById('musicList');
  box.innerHTML = tracks.length ? tracks.map(t=>`
    <div class="music-item ${t.id===pb.trackId?'playing':''}" data-id="${t.id}">
      <span class="m-name">${t.id===pb.trackId&&pb.isPlaying?'▶ ':''}${t.type==='youtube'?'▶️ ':''}${escapeHtml(t.name)}${t.addedBy ? ` <span class="hint">(dari ${escapeHtml(t.addedBy)})</span>` : ''}</span>
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

const STORY_LOG_TYPES = ['narrative','scene','dialogue','quest','handout'];
// Log & Dice muncul di 2 tempat (tab Utama & tab Battle) — sama persis datanya, jadi render ke semua
// box yang ada di halaman (kalau salah satu gak ada, misal tab Battle belum ke-render, otomatis dilewati).
const CHAT_LOG_BOX_IDS = ['chatLog', 'battleChatLog'];
function renderLog() {
  const html = state.log.map(e => {
    let cls;
    if (STORY_LOG_TYPES.includes(e.type)) cls = e.type === 'quest' ? 'quest' : (e.type === 'handout' ? 'handout' : (e.type === 'dialogue' ? 'dialogue' : 'narrative'));
    else if (e.type==='whisper') cls='whisper';
    else if (e.from==='DM'||e.from==='dm') cls='dm';
    else if (e.from==='Sistema'||e.from==='system'||e.type==='system') cls='system';
    else if (e.type==='roll') cls='roll';
    else if (e.type==='damage') cls='damage';
    else if (e.type==='heal') cls='heal';
    else cls='player';
    return `<div class="entry ${cls}${e.secret?' secret':''}${e.starred?' starred':''}">
      <button type="button" class="star-btn" data-id="${e.id}" title="Tandai penting untuk Recap">${e.starred?'⭐':'☆'}</button>
      <span class="from">${escapeHtml(e.from)}:</span> ${escapeHtml(e.text)}
      ${e.imageUrl?`<div><img src="${e.imageUrl}" style="max-width:180px; border-radius:5px; border:1px solid var(--gold); margin-top:4px;"></div>`:''}
      ${e.secret&&e.type!=='whisper'?`<span class="secret-badge">🔒 rahasia</span> <button type="button" class="small secondary reveal-btn" data-id="${e.id}">👁 Perlihatkan</button>`:''}
      ${e.type==='whisper'?`<span class="secret-badge">✉ privat</span>`:''}
      ${e.ts?`<span class="ts">${new Date(e.ts).toLocaleTimeString()}</span>`:''}
    </div>`;
  }).join('')||'<p class="hint">Belum ada log.</p>';
  CHAT_LOG_BOX_IDS.forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll('.reveal-btn').forEach(btn => { btn.onclick=()=>socket.emit('dm:reveal-roll',{code:CODE,id:btn.dataset.id}); });
    box.querySelectorAll('.star-btn').forEach(btn => { btn.onclick=()=>{
      const entry = state.log.find(e=>e.id===btn.dataset.id); if (!entry) return;
      socket.emit('dm:log-star',{code:CODE,id:entry.id,starred:!entry.starred});
    }; });
  });
}

const DICE_TYPES = [4,6,8,10,12,20,100];
// Tiap dice-quick-row punya checkbox "sembunyikan roll" sendiri (dmRollSecret di Utama,
// battleRollSecret di tab Battle) — dipetakan di sini biar tombol dadu di masing-masing pakai punya sendiri.
const DICE_QUICK_ROW_IDS = { dmDiceQuickRow: 'dmRollSecret', battleDiceQuickRow: 'battleRollSecret' };
function renderDmDiceButtons() {
  Object.entries(DICE_QUICK_ROW_IDS).forEach(([boxId, secretId]) => {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML = DICE_TYPES.map(d=>`<button type="button" class="dice-btn" data-sides="${d}">d${d}</button>`).join('');
    box.querySelectorAll('.dice-btn').forEach(btn => { btn.onclick=()=>rollAndSend('1d'+btn.dataset.sides, secretId); });
  });
}
renderDmDiceButtons();

document.getElementById('btnClearLog').onclick = ()=>{ if(confirm('Bersihkan log?')) socket.emit('chat:clear',{code:CODE}); };
document.getElementById('btnExportLog').onclick = () => {
  if (!state.log.length) return alert('Log masih kosong.');
  const lines = state.log.map(e => {
    const t = e.ts ? new Date(e.ts).toLocaleString('id-ID') : '';
    return `**[${t}] ${e.from || 'Sistem'}:** ${e.text || ''}`;
  });
  const md = `# Battle Log — Sesi ${CODE}\n\n${lines.join('\n\n')}\n`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `battle-log-${CODE}-${Date.now()}.md`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
document.getElementById('btnBattleStatsReset').onclick = () => {
  if (confirm('Reset statistik hit/miss/crit battle?')) socket.emit('dm:battle-reset-stats', { code: CODE });
};
document.getElementById('btnSendChat').onclick = () => sendChat('chatInput', 'dmRollSecret');
document.getElementById('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat('chatInput', 'dmRollSecret'); });
document.getElementById('btnBattleSendChat').onclick = () => sendChat('battleChatInput', 'battleRollSecret');
document.getElementById('battleChatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat('battleChatInput', 'battleRollSecret'); });

const DICE_FORMULA_RE = /^\d*d\d+([+-]\d+)?$/i;
// inputId/secretCheckboxId dipisah biar panel Log&Dice di tab Utama sama panel Chat&Roll di tab
// Battle bisa dipakai bareng tanpa rebutan elemen — keduanya ngirim ke log yang sama persis.
function sendChat(inputId, secretCheckboxId) {
  const input = document.getElementById(inputId); const text = input.value.trim(); if (!text) return;
  if (text.startsWith('/roll')) rollAndSend(text.replace('/roll','').trim()||'1d20', secretCheckboxId);
  else if (DICE_FORMULA_RE.test(text)) rollAndSend(text, secretCheckboxId);
  else socket.emit('chat:send',{code:CODE,from:'DM',text,type:'chat'});
  input.value='';
}
function rollAndSend(formula, secretCheckboxId) {
  const result = rollDice(formula);
  const secretBox = document.getElementById(secretCheckboxId || 'dmRollSecret');
  const secret = secretBox ? secretBox.checked : false;
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

// Sama kaya INV_ITEM_TYPES di character.js — dipakai biar efek item toko konsisten sama efek
// item inventory di battle (heal/damage/buff/dll), jadi pas dibeli langsung nyambung otomatis.
const SHOP_EFEK_TIPES = [
  ['misc','📦 Misc (tanpa efek)'],
  ['heal','💚 Heal (HP)'],
  ['mana_regen','🔵 Mana Potion (MP)'],
  ['sp_regen','🟢 Stamina Potion (SP)'],
  ['damage','⚔ Damage (mis. bom/racun lempar)'],
  ['buff','🌀 Buff'],
  ['debuff','🌀 Debuff'],
  ['cure','✨ Cure Status (hapus kondisi)'],
  ['revive','⚕ Revive (hapus fatal + heal)'],
  ['food','🍖 Makanan (isi Lapar)'],
  ['drink','💧 Minuman (isi Haus)']
];
const SHOP_EFEK_LABEL = Object.fromEntries(SHOP_EFEK_TIPES);
(function initShopEfekSelect(){
  const sel = document.getElementById('shop_efekTipe'); if (!sel) return;
  sel.innerHTML = SHOP_EFEK_TIPES.map(([k,label])=>`<option value="${k}">${label}</option>`).join('');
})();

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
  if (!list.length) { box.innerHTML=`<tr><td colspan="6" class="hint">${q ? 'Tidak ada item yang cocok.' : 'Belum ada item.'}</td></tr>`; return; }
  box.innerHTML = list.map(it=>{
    const efekTipe = it.efekTipe || 'misc';
    const efekLabel = efekTipe === 'misc' ? '-' : (SHOP_EFEK_LABEL[efekTipe] || efekTipe);
    const efekText = efekTipe === 'misc' ? '-' : `${efekLabel}${it.efekFormula ? ' · ' + escapeHtml(it.efekFormula) : ''}${it.aoe ? ' · 💥AoE' : ''}`;
    return `
    <tr data-id="${it.id}" class="shop-row">
      <td>${escapeHtml(it.nama||'-')}</td>
      <td>🪙${escapeHtml(String(it.harga??0))}</td>
      <td>${escapeHtml(it.tipe||'-')}</td>
      <td>${it.stok===''||it.stok==null?'~':escapeHtml(String(it.stok))}</td>
      <td class="hint" style="font-size:11px;">${efekText}</td>
      <td class="td-actions"><button type="button" class="small danger shop-del-btn" data-id="${it.id}">🗑</button></td>
    </tr>`;}).join('');
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
  document.getElementById('shop_efekTipe').value=it?.efekTipe||'misc';
  document.getElementById('shop_efekFormula').value=it?.efekFormula||'';
  document.getElementById('shop_aoe').checked=!!it?.aoe;
}
document.getElementById('btnShopResetForm').onclick=()=>loadShopItemToForm(null);
document.getElementById('btnShopSaveItem').onclick=()=>{
  const nama=document.getElementById('shop_nama').value.trim(); if(!nama) return alert('Isi nama item.');
  const item={
    id:document.getElementById('shop_id').value||undefined,nama,
    harga:parseFloat(document.getElementById('shop_harga').value)||0,
    tipe:document.getElementById('shop_tipe').value,
    stok:document.getElementById('shop_stok').value,
    deskripsi:document.getElementById('shop_deskripsi').value,
    efekTipe:document.getElementById('shop_efekTipe').value||'misc',
    efekFormula:document.getElementById('shop_efekFormula').value.trim(),
    aoe:document.getElementById('shop_aoe').checked
  };
  socket.emit('dm:shop-save-item',{code:CODE,item},(res)=>{ if(!res?.ok) alert(res?.error||'Gagal.'); else loadShopItemToForm(null); });
};
document.getElementById('btnShopClear').onclick=()=>{ if(confirm('Kosongkan semua item toko?')) socket.emit('dm:shop-clear',{code:CODE}); };

// =============================== CRAFTING (DM: kelola resep) ===========
socket.on('recipes-update', (recipes) => { state.recipes = recipes; if (document.getElementById('tab-dm-craft').style.display !== 'none') renderCraftTable(); });

(function initCraftHasilTipeSelect(){
  const sel = document.getElementById('craft_hasilTipe'); if (!sel) return;
  sel.innerHTML = SHOP_EFEK_TIPES.map(([k,label])=>`<option value="${k}">${label}</option>`).join('');
})();

let craftBahanState = []; // [{item, qty}] — bahan yang lagi diedit di form
function renderCraftBahanList() {
  const box = document.getElementById('craftBahanList'); if (!box) return;
  if (!craftBahanState.length) { box.innerHTML = '<p class="hint">Belum ada bahan. Klik "+ Tambah Bahan".</p>'; return; }
  box.innerHTML = craftBahanState.map((b, i) => `
    <div class="row" data-idx="${i}" style="margin-top:4px; align-items:center;">
      <input type="text" data-f="item" placeholder="Nama item bahan (cocok persis nama di inventory)" value="${escapeAttr(b.item)}" style="flex:2;">
      <input type="number" data-f="qty" min="1" placeholder="Qty" value="${b.qty || 1}" style="max-width:70px;">
      <button type="button" class="small danger craft-bahan-remove">×</button>
    </div>`).join('');
  box.querySelectorAll('[data-idx]').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    row.querySelector('[data-f="item"]').addEventListener('input', e => { craftBahanState[idx].item = e.target.value; });
    row.querySelector('[data-f="qty"]').addEventListener('input', e => { craftBahanState[idx].qty = parseInt(e.target.value, 10) || 1; });
    row.querySelector('.craft-bahan-remove').addEventListener('click', () => { craftBahanState.splice(idx, 1); renderCraftBahanList(); });
  });
}
document.getElementById('btnCraftAddBahan').onclick = () => { craftBahanState.push({ item: '', qty: 1 }); renderCraftBahanList(); };

function renderCraftTable() {
  const box = document.getElementById('craftTableBody'); if (!box) return;
  let list = Object.values(state.recipes || {});
  const q = (document.getElementById('craftSearch')?.value || '').toLowerCase().trim();
  if (q) list = list.filter(r => (r.nama||'').toLowerCase().includes(q) || (r.hasil_item||'').toLowerCase().includes(q));
  list.sort((a,b) => (a.nama||'').localeCompare(b.nama||''));
  if (!list.length) { box.innerHTML = `<tr><td colspan="4" class="hint">${q ? 'Tidak ada resep yang cocok.' : 'Belum ada resep.'}</td></tr>`; return; }
  box.innerHTML = list.map(r => {
    const bahanText = (r.bahan||[]).map(b => `${escapeHtml(b.item)} x${b.qty}`).join(', ') || '-';
    const hasilText = `${escapeHtml(r.hasil_item||'-')}${r.hasil_qty > 1 ? ' x' + r.hasil_qty : ''}`;
    return `<tr data-id="${r.id}" class="craft-row">
      <td>${escapeHtml(r.nama||'-')}</td>
      <td class="hint" style="font-size:11px;">${bahanText}</td>
      <td class="hint" style="font-size:11px;">${hasilText}</td>
      <td class="td-actions"><button type="button" class="small danger craft-del-btn" data-id="${r.id}">🗑</button></td>
    </tr>`;
  }).join('');
  box.querySelectorAll('.craft-row').forEach(row => { row.onclick = (e) => { if (e.target.closest('button')) return; loadRecipeToForm(state.recipes[row.dataset.id]); }; });
  box.querySelectorAll('.craft-del-btn').forEach(btn => { btn.onclick = (e) => { e.stopPropagation(); if (confirm('Hapus resep ini?')) socket.emit('dm:delete-recipe', { code: CODE, recipeId: btn.dataset.id }); }; });
}
document.getElementById('craftSearch').addEventListener('input', renderCraftTable);

function loadRecipeToForm(r) {
  document.getElementById('craft_id').value = r?.id || '';
  document.getElementById('craft_nama').value = r?.nama || '';
  document.getElementById('craft_deskripsi').value = r?.deskripsi || '';
  craftBahanState = r ? JSON.parse(JSON.stringify(r.bahan || [])) : [];
  renderCraftBahanList();
  document.getElementById('craft_hasilItem').value = r?.hasil_item || '';
  document.getElementById('craft_hasilQty').value = r?.hasil_qty || 1;
  document.getElementById('craft_hasilDesc').value = r?.hasil_desc || '';
  document.getElementById('craft_hasilTipe').value = r?.hasil_tipe || 'misc';
  document.getElementById('craft_hasilFormula').value = r?.hasil_formula || '';
}
document.getElementById('btnCraftResetForm').onclick = () => loadRecipeToForm(null);
document.getElementById('btnCraftSaveRecipe').onclick = () => {
  const nama = document.getElementById('craft_nama').value.trim(); if (!nama) return alert('Isi nama resep.');
  const hasil_item = document.getElementById('craft_hasilItem').value.trim(); if (!hasil_item) return alert('Isi nama item hasil.');
  const bahan = craftBahanState.filter(b => (b.item||'').trim());
  if (!bahan.length) return alert('Isi minimal 1 bahan.');
  const recipe = {
    id: document.getElementById('craft_id').value || undefined,
    nama, deskripsi: document.getElementById('craft_deskripsi').value,
    bahan,
    hasil_item, hasil_qty: parseInt(document.getElementById('craft_hasilQty').value, 10) || 1,
    hasil_desc: document.getElementById('craft_hasilDesc').value,
    hasil_tipe: document.getElementById('craft_hasilTipe').value || 'misc',
    hasil_formula: document.getElementById('craft_hasilFormula').value.trim()
  };
  socket.emit('dm:save-recipe', { code: CODE, recipe }, (res) => { if (!res?.ok) alert(res?.error || 'Gagal.'); else loadRecipeToForm(null); });
};
document.getElementById('shopImportFile').addEventListener('change', (e)=>{
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=(ev)=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws);
      rows.forEach(row=>{
        const item={
          nama:row.nama||row.Nama||'',harga:parseFloat(row.harga||row.Harga)||0,tipe:row.tipe||row.Tipe||'',
          stok:row.stok??row.Stok??'',deskripsi:row.deskripsi||row.Deskripsi||'',
          efekTipe:row.efekTipe||row.efek_tipe||row.EfekTipe||row.Efek||'misc',
          efekFormula:row.efekFormula||row.efek_formula||row.EfekFormula||row.Formula||'',
          aoe: String(row.aoe||row.AoE||row.Aoe||'').trim().toLowerCase()==='true' || String(row.aoe||'')==='1'
        };
        if(item.nama) socket.emit('dm:shop-save-item',{code:CODE,item});
      });
      alert(`${rows.length} item berhasil diimport. Kolom efek opsional: efekTipe (misc/heal/damage/buff/debuff/cure/revive/mana_regen/sp_regen/food/drink), efekFormula (mis. 2d4+2, atau angka flat utk food/drink), aoe (true/false).`);
    }catch(err){alert('Gagal import: '+err.message);}
    e.target.value='';
  };
  reader.readAsBinaryString(file);
});
document.getElementById('btnShopExportExcel').onclick=()=>{
  const list=Object.values((state.shop&&state.shop.items)||{});
  const ws=XLSX.utils.json_to_sheet(list.map(it=>({nama:it.nama,harga:it.harga,tipe:it.tipe,stok:it.stok,deskripsi:it.deskripsi,efekTipe:it.efekTipe||'misc',efekFormula:it.efekFormula||'',aoe:!!it.aoe})));
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

// =============================== STORY (Scene / Dialog / Quest / Handout) ===
let sceneImageData = null;
let dialoguePortraitData = null;
let handoutImageData = null;

function renderStoryStatusBadges() {
  const scene = (state.story && state.story.scene) || {};
  const dlg = (state.story && state.story.dialogue) || {};
  const sBadge = document.getElementById('sceneStatusBadge');
  if (sBadge) { sBadge.textContent = scene.active ? 'tampil' : 'tidak aktif'; sBadge.classList.toggle('active', !!scene.active); }
  const dBadge = document.getElementById('dialogueStatusBadge');
  if (dBadge) { dBadge.textContent = dlg.active ? 'tampil' : 'tidak aktif'; dBadge.classList.toggle('active', !!dlg.active); }
}

function renderStory() {
  renderStoryStatusBadges();
  populateDialogueNpcSelect();
  populateHandoutTargetSelect();
  renderQuestList();
  renderStoryRecap();
}

function populateDialogueNpcSelect() {
  const sel = document.getElementById('dialogue_npcPick'); if (!sel) return;
  const prev = sel.value;
  const npcs = Object.values(state.npcs || {});
  sel.innerHTML = '<option value="">— Pilih dari NPC (opsional) —</option>' +
    npcs.map(n => `<option value="${n.id}">${escapeHtml(n.nama || 'NPC')}</option>`).join('');
  if (npcs.some(n => n.id === prev)) sel.value = prev;
}
document.getElementById('dialogue_npcPick').addEventListener('change', (e) => {
  const npc = (state.npcs || {})[e.target.value];
  if (npc) {
    document.getElementById('dialogue_name').value = npc.nama || '';
    if (npc.portrait) {
      dialoguePortraitData = npc.portrait;
      const img = document.getElementById('dialoguePreviewImg'); img.src = npc.portrait; img.style.display = '';
    }
  }
});

function populateHandoutTargetSelect() {
  const sel = document.getElementById('handout_target'); if (!sel) return;
  const prev = sel.value;
  const players = state.playersList || Object.values(state.players || {});
  sel.innerHTML = '<option value="">Semua Pemain</option>' +
    players.map(p => `<option value="${p.id}">${escapeHtml(p.nama_karakter || p.name)}</option>`).join('');
  if (players.some(p => p.id === prev)) sel.value = prev;
}

// ---- Scene Banner ----
document.getElementById('sceneImageUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 1200, 0.8).then(dataUrl => {
    sceneImageData = dataUrl;
    const img = document.getElementById('scenePreviewImg'); img.src = dataUrl; img.style.display = '';
  });
});
document.getElementById('btnSceneImageClear').onclick = () => {
  sceneImageData = null;
  const img = document.getElementById('scenePreviewImg'); img.style.display = 'none'; img.src = '';
  document.getElementById('sceneImageUpload').value = '';
};
document.getElementById('btnSceneShow').onclick = () => {
  const title = document.getElementById('scene_title').value.trim();
  if (!title) return alert('Isi judul adegan dulu.');
  const desc = document.getElementById('scene_desc').value.trim();
  socket.emit('dm:scene-set', { code: CODE, title, desc, imageUrl: sceneImageData !== null ? sceneImageData : undefined }, (res) => {
    if (!res?.ok) alert(res?.error || 'Gagal menampilkan adegan.');
  });
};
document.getElementById('btnSceneHide').onclick = () => socket.emit('dm:scene-clear', { code: CODE });
socket.on('scene-updated', (scene) => { state.story = state.story || {}; state.story.scene = scene; renderStoryStatusBadges(); });

// ---- Dialog NPC ----
document.getElementById('dialoguePortraitUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 400, 0.82).then(dataUrl => {
    dialoguePortraitData = dataUrl;
    const img = document.getElementById('dialoguePreviewImg'); img.src = dataUrl; img.style.display = '';
  });
});
document.getElementById('btnDialoguePortraitClear').onclick = () => {
  dialoguePortraitData = null;
  const img = document.getElementById('dialoguePreviewImg'); img.style.display = 'none'; img.src = '';
  document.getElementById('dialoguePortraitUpload').value = '';
};
document.getElementById('btnDialogueSay').onclick = () => {
  const text = document.getElementById('dialogue_text').value.trim();
  if (!text) return alert('Isi dialognya dulu.');
  const npcName = document.getElementById('dialogue_name').value.trim() || 'NPC';
  socket.emit('dm:dialogue-say', { code: CODE, npcName, npcPortrait: dialoguePortraitData !== null ? dialoguePortraitData : undefined, text }, (res) => {
    if (!res?.ok) alert(res?.error || 'Gagal mengirim dialog.');
    else document.getElementById('dialogue_text').value = '';
  });
};
document.getElementById('btnDialogueHide').onclick = () => socket.emit('dm:dialogue-clear', { code: CODE });
socket.on('dialogue-updated', (dialogue) => { state.story = state.story || {}; state.story.dialogue = dialogue; renderStoryStatusBadges(); });

// ---- Quest Tracker ----
function renderQuestList() {
  const box = document.getElementById('questList'); if (!box) return;
  const quests = Object.values((state.story && state.story.quests) || {}).sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
  if (!quests.length) { box.innerHTML = '<p class="hint">Belum ada quest.</p>'; return; }
  box.innerHTML = quests.map(q => {
    const accepted = Object.values(q.acceptedBy || {});
    const acceptedLine = accepted.length
      ? `<div class="quest-card-desc" style="margin-top:4px;">🙋 ${accepted.map(a => `${escapeHtml(a.name)}${a.completed ? ' ✅' : ''}`).join(', ')}</div>`
      : `<div class="hint" style="margin-top:4px;">Belum ada player yang ambil quest ini.</div>`;
    const objectives = q.objectives || [];
    const objLine = objectives.length ? `
      <div class="quest-objectives" style="margin-top:6px;">
        ${objectives.map(o => `
          <div class="row" style="margin:2px 0; gap:4px; align-items:center;">
            <input type="checkbox" class="quest-obj-toggle" data-qid="${q.id}" data-oid="${o.id}" ${o.done?'checked':''}>
            <span style="flex:1; ${o.done?'text-decoration:line-through; opacity:.6;':''}">${escapeHtml(o.text)}</span>
            <button type="button" class="quest-obj-del" data-qid="${q.id}" data-oid="${o.id}" style="background:none;border:none;color:var(--crimson-bright);cursor:pointer;">×</button>
          </div>`).join('')}
      </div>` : '';
    return `
    <div class="quest-card" data-id="${q.id}">
      <div class="quest-card-top">
        <span class="quest-card-title">${escapeHtml(q.title)}</span>
        <span class="quest-status-badge ${q.status}">${q.status === 'aktif' ? '🟡 Aktif' : q.status === 'selesai' ? '✅ Selesai' : '❌ Gagal'}</span>
      </div>
      ${q.desc ? `<div class="quest-card-desc">${escapeHtml(q.desc)}</div>` : ''}
      ${acceptedLine}
      ${objLine}
      <div class="row" style="margin-top:4px; gap:4px;">
        <input type="text" class="quest-obj-input" data-qid="${q.id}" placeholder="+ Objektif baru…" style="flex:1;">
        <button type="button" class="small secondary quest-obj-add" data-qid="${q.id}">+</button>
      </div>
      <div class="row">
        <button type="button" class="small secondary quest-edit-btn" data-id="${q.id}" style="flex:1;">✏ Edit</button>
        <button type="button" class="small danger quest-del-btn" data-id="${q.id}" style="flex:1;">🗑 Hapus</button>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.quest-edit-btn').forEach(btn => { btn.onclick = () => loadQuestToForm((state.story.quests||{})[btn.dataset.id]); });
  box.querySelectorAll('.quest-del-btn').forEach(btn => { btn.onclick = () => { if (confirm('Hapus quest ini?')) socket.emit('dm:quest-delete', { code: CODE, questId: btn.dataset.id }); }; });
  box.querySelectorAll('.quest-obj-toggle').forEach(cb => {
    cb.onchange = () => socket.emit('dm:quest-toggle-objective', { code: CODE, questId: cb.dataset.qid, objectiveId: cb.dataset.oid });
  });
  box.querySelectorAll('.quest-obj-del').forEach(btn => {
    btn.onclick = () => socket.emit('dm:quest-remove-objective', { code: CODE, questId: btn.dataset.qid, objectiveId: btn.dataset.oid });
  });
  box.querySelectorAll('.quest-obj-add').forEach(btn => {
    btn.onclick = () => {
      const input = box.querySelector(`.quest-obj-input[data-qid="${btn.dataset.qid}"]`);
      const text = input.value.trim();
      if (!text) return;
      socket.emit('dm:quest-add-objective', { code: CODE, questId: btn.dataset.qid, text }, (res) => {
        if (!res?.ok) alert(res?.error || 'Gagal menambah objektif.');
      });
    };
  });
}
function loadQuestToForm(q) {
  document.getElementById('quest_id').value = q?.id || '';
  document.getElementById('quest_title').value = q?.title || '';
  document.getElementById('quest_desc').value = q?.desc || '';
  document.getElementById('quest_status').value = q?.status || 'aktif';
}
document.getElementById('btnQuestResetForm').onclick = () => loadQuestToForm(null);
document.getElementById('btnQuestSave').onclick = () => {
  const title = document.getElementById('quest_title').value.trim();
  if (!title) return alert('Isi judul quest.');
  const quest = {
    id: document.getElementById('quest_id').value || undefined,
    title, desc: document.getElementById('quest_desc').value.trim(),
    status: document.getElementById('quest_status').value
  };
  socket.emit('dm:quest-save', { code: CODE, quest }, (res) => {
    if (!res?.ok) alert(res?.error || 'Gagal menyimpan quest.');
    else loadQuestToForm(null);
  });
};
socket.on('quests-updated', (quests) => { state.story = state.story || {}; state.story.quests = quests; renderQuestList(); renderStoryRecap(); });

// ---- Handout ----
document.getElementById('handoutImageUpload').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  compressImageFile(file, 1200, 0.8).then(dataUrl => {
    handoutImageData = dataUrl;
    const img = document.getElementById('handoutPreviewImg'); img.src = dataUrl; img.style.display = '';
  });
});
document.getElementById('btnHandoutImageClear').onclick = () => {
  handoutImageData = null;
  const img = document.getElementById('handoutPreviewImg'); img.style.display = 'none'; img.src = '';
  document.getElementById('handoutImageUpload').value = '';
};
document.getElementById('btnHandoutSend').onclick = () => {
  const title = document.getElementById('handout_title').value.trim();
  if (!title) return alert('Isi judul dokumen.');
  const playerId = document.getElementById('handout_target').value || null;
  const text = document.getElementById('handout_text').value.trim();
  socket.emit('dm:handout-send', { code: CODE, playerId, title, imageUrl: handoutImageData, text }, (res) => {
    if (!res?.ok) return alert(res?.error || 'Gagal mengirim dokumen.');
    document.getElementById('handout_title').value = '';
    document.getElementById('handout_text').value = '';
    handoutImageData = null;
    const img = document.getElementById('handoutPreviewImg'); img.style.display = 'none'; img.src = '';
    document.getElementById('handoutImageUpload').value = '';
  });
};

// ---- Recap (adegan/dialog/quest/handout + entri log yang di-⭐) ----
function renderStoryRecap() {
  const box = document.getElementById('storyRecapList'); if (!box) return;
  const entries = state.log.filter(e => STORY_LOG_TYPES.includes(e.type) || e.starred).sort((a,b) => (a.ts||0)-(b.ts||0));
  if (!entries.length) { box.innerHTML = '<p class="hint">Belum ada momen cerita.</p>'; return; }
  box.innerHTML = entries.map(e => `
    <div class="story-recap-entry">
      <span class="from">${escapeHtml(e.from)}:</span> ${escapeHtml(e.text)}
      ${e.ts ? `<span class="ts">${new Date(e.ts).toLocaleString()}</span>` : ''}
    </div>`).join('');
}
socket.on('chat:starred', ({ id, starred }) => {
  const entry = state.log.find(e => e.id === id);
  if (entry) entry.starred = starred;
  renderLog(); renderStoryRecap();
});

// =============================== RENDER ALL ============================
function renderAll() {
  renderPlayers(); renderNpcs(); renderClasses(); renderCraftTable(); renderBattle(); renderMusic(); renderShop(); renderLog();
  refreshBattleSourceOptions(); refreshTokenOwnerOptions();
  if (document.getElementById('tab-dm-map').style.display !== 'none') { renderMapTabs(); renderMap(); }
  if (document.getElementById('tab-dm-story').style.display !== 'none') { renderStory(); }
  else { renderStoryStatusBadges(); }
  const notesEl = document.getElementById('sessionNotes');
  if (notesEl && document.activeElement !== notesEl) notesEl.value = state.notes || '';
}

// character.js — logika halaman character sheet (v2 — full rewrite)
const socket = io();

const CODE = localStorage.getItem('dnd_player_code');
const NAME = localStorage.getItem('dnd_player_name');
let PLAYER_ID = CODE ? localStorage.getItem('dnd_player_id_' + CODE) : null;

if (!CODE || !NAME) location.href = '/';

document.getElementById('codeBadge').textContent = CODE;

// =============================== CONSTANTS ===============================
const ABILITIES = [
  ['str','STR','Strength'],['con','CON','Constitution'],['dex','DEX','Dexterity'],
  ['cha','CHA','Charisma'],['wis','WIS','Wisdom'],['int','INT','Intelligence']
];

// CONDITIONS: fatal = tidak bisa giliran, dot = tetap bisa tapi kena efek tiap round,
// debuff = kondisi negatif yang aktif (bukan fatal, bukan DOT) — mis. Silenced/Blinded/Fear/Confused
const CONDITIONS = [
  { name:'Normal', fatal:false, dot:false, debuff:false },
  { name:'Stunned', fatal:true, dot:false, debuff:false },
  { name:'Frozen', fatal:true, dot:false, debuff:false },
  { name:'Silenced', fatal:false, dot:false, debuff:true },
  { name:'Poisoned', fatal:false, dot:true, debuff:false },
  { name:'Blinded', fatal:false, dot:false, debuff:true },
  { name:'Sleep', fatal:true, dot:false, debuff:false },
  { name:'Confused', fatal:false, dot:false, debuff:true },
  { name:'Burn', fatal:false, dot:true, debuff:false },
  { name:'Fear', fatal:false, dot:false, debuff:true },
  { name:'Paralyzed', fatal:true, dot:false, debuff:false },
  { name:'Bleeding', fatal:false, dot:true, debuff:false }
];

const SKILL_ACTION_OPTIONS = [
  ['damage','⚔ Damage'],['heal','💚 Heal'],['buff','🌀 Buff'],['debuff','🌀 Debuff'],
  ['ultimate','🔥 Ultimate'],['mana_regen','🔵 Regen Mana'],['sp_regen','🟢 Regen SP'],
  ['ac_buff','🛡 Buff AC'],['ac_debuff','🛡 Debuff AC']
];

const ELEMENT_KEYS = [
  ['fire','🔥 Fire'],['ice','❄ Ice'],['lightning','⚡ Lightning'],['poison','☠ Poison'],
  ['dark','🌑 Dark'],['light','☀ Light'],['physical','⚔ Physical'],['magic','🔮 Magic']
];

// Stat options buat buff/debuff (ditambah heal_dot dan lainnya)
const BUFF_STAT_OPTIONS = [
  ['','- (cuma catatan)'],
  ['ac','AC'],['hp_max','HP Max'],['mp_max','MP Max'],['sp_max','SP Max'],
  ['atk','ATK'],['def','DEF'],
  ['dot','DOT (damage/giliran)'],
  ['heal_dot','HEAL (regen HP/giliran)'],
  ['mp_regen','Regen MP/giliran'],
  ['sp_regen','Regen SP/giliran'],
  ['other','Lainnya']
];

// Skill status effect: bisa dikaitkan ke skill -> jika kena, otomatis ceklis condition
const STATUS_EFFECT_OPTIONS = ['','Stunned','Frozen','Silenced','Poisoned','Blinded','Sleep','Confused','Burn','Fear','Paralyzed','Bleeding'];

// Tipe efek item inventory — kaya potion di RPG pada umumnya: bukan cuma HP, tapi juga MP/SP,
// bisa nyembuhin status (cure), bahkan revive (hapus kondisi fatal + heal sekaligus).
const INV_ITEM_TYPES = [
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
const INV_ITEM_TYPE_LABEL = Object.fromEntries(INV_ITEM_TYPES);

// Slot inventory dasar 10, DM bisa kasih slot tambahan lewat sheet.inv_extra_slots
const INV_BASE_SLOTS = 10;

// =============================== STATE ===================================
let invState = [{ checked: false, item: '', desc: '', type: 'misc', qty: 1 }];
let invExtraSlots = 0;
const GEAR_SLOTS = [['helmet','Helmet'],['armor','Armor'],['gloves','Gloves'],['boots','Boots'],
  ['accessory1','Accessory I'],['accessory2','Accessory II'],['necklace','Necklace'],['artifact','Artifact / Relic']];
// gearState: tiap slot = { key, item, stat, amount, equipped } — dipakai (equip) untuk nambah status kaya RPG pada umumnya
let gearState = GEAR_SLOTS.map(([key]) => ({ key, item: '', stat: '', amount: '', equipped: false }));

// Trait sekarang beneran ngefek ke gameplay — tiap slot = { nama, stat, amount }, aktif terus
// (gak perlu di-equip kaya gear, soalnya trait ras itu bawaan/inheren). Dihitung ke computeBuffTotals()
// sama kaya gear & buff, jadi otomatis kepakai ke AC/HP/MP/SP/ATK/DEF effective di battle.
const RACE_TRAIT_SLOTS = 4;
const RACE_TRAIT_STAT_OPTIONS = [
  ['','- (cuma catatan)'],['ac','AC'],['hp_max','HP Max'],['mp_max','MP Max'],['sp_max','SP Max'],
  ['atk','ATK'],['def','DEF'],['other','Lainnya']
];
// Preset Ras — pilih salah satu buat auto-isi 4 slot Trait di atas. Tetap bisa diedit manual
// setelah di-apply (misal mau nambah/ganti angka), jadi fleksibel tapi tetap ngefek ke battle.
const RACE_PRESETS = [
  { id: 'human', nama: 'Manusia', desc: 'Serbaguna, gampang beradaptasi ke kelas apa pun.',
    traits: [{ nama: 'Serbaguna', stat: 'atk', amount: '1' }, { nama: 'Pekerja Keras', stat: 'def', amount: '1' }] },
  { id: 'elf', nama: 'Elf', desc: 'Gesit dan dekat dengan sihir.',
    traits: [{ nama: 'Gesit', stat: 'ac', amount: '2' }, { nama: 'Afinitas Sihir', stat: 'mp_max', amount: '5' }] },
  { id: 'dwarf', nama: 'Dwarf', desc: 'Tubuh kekar, tahan banting.',
    traits: [{ nama: 'Tubuh Kekar', stat: 'hp_max', amount: '10' }, { nama: 'Kulit Keras', stat: 'def', amount: '1' }] },
  { id: 'orc', nama: 'Orc', desc: 'Kekuatan fisik luar biasa, kurang selaras dengan sihir.',
    traits: [{ nama: 'Kekuatan Buas', stat: 'atk', amount: '2' }, { nama: 'Kurang Selaras Sihir', stat: 'mp_max', amount: '-3' }] },
  { id: 'beastkin', nama: 'Beastkin', desc: 'Insting pemburu, lincah dan waspada.',
    traits: [{ nama: 'Insting Pemburu', stat: 'atk', amount: '1' }, { nama: 'Refleks Waspada', stat: 'ac', amount: '1' }] },
  { id: 'dragonkin', nama: 'Dragonkin', desc: 'Darah naga mengalir, kuat dan tangguh.',
    traits: [{ nama: 'Darah Naga', stat: 'hp_max', amount: '5' }, { nama: 'Cakar Naga', stat: 'atk', amount: '1' }] },
  { id: 'undead', nama: 'Undead', desc: 'Stamina tanpa lelah, tapi vitalitasnya rapuh.',
    traits: [{ nama: 'Tanpa Lelah', stat: 'sp_max', amount: '5' }, { nama: 'Vitalitas Rapuh', stat: 'hp_max', amount: '-5' }] }
];
// raceTraitState: array 4 slot { nama, stat, amount } — selalu aktif, gak ada toggle equip
let raceTraitState = Array.from({ length: RACE_TRAIT_SLOTS }, () => ({ nama: '', stat: '', amount: '' }));

let buffState = [];
let companionState = [];
let classCatalog = {};
let myUnlockedClasses = [];
let shopItems = {};

// Battle state
const battleState = {
  map: {}, tokens: {}, maps: {}, activeMapId: 'main',
  battle: { entries: {}, turn: { activeId: null, round: 1 } },
  music: { tracks: {}, playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false } }
};
let diceLog = [];
let onlinePlayersList = [];
let storyState = { scene: { title:'', desc:'', imageUrl:null, active:false }, dialogue: { npcName:'', npcPortrait:null, text:'', active:false }, quests: {} };
let sceneBannerDismissedAt = parseInt(localStorage.getItem('dnd_scene_dismissed_' + CODE) || '0', 10) || 0;
let dialogueBoxDismissedAt = parseInt(localStorage.getItem('dnd_dialogue_dismissed_' + CODE) || '0', 10) || 0;

// Map state (no zoom — peta selalu fit ke ukuran gambar aslinya)

// =============================== UTIL ====================================
function escapeAttrVal(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pEscapeHtml(str) { return escapeAttrVal(str); }
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function fmtMod(n) { return n > 0 ? `+${n}` : `${n}`; }

function rollDiceFormula(formula) {
  const m = String(formula).trim().match(/^(-?)(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { const n = parseFloat(formula); return isNaN(n) ? 0 : n; }
  const neg = m[1] === '-';
  const count = parseInt(m[2] || '1', 10);
  const sides = parseInt(m[3], 10);
  const mod = parseInt(m[4] || '0', 10);
  let total = mod;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  return neg ? -total : total;
}

// =============================== TOAST ==================================
function showToast(message) {
  const wrap = document.getElementById('itemToast');
  const el = document.createElement('div');
  el.className = 'toast-entry';
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// =============================== ONLINE PLAYERS =========================
function renderOnlinePlayers() {
  const bar = document.getElementById('onlinePlayersBar');
  if (!bar) return;
  if (!onlinePlayersList.length) { bar.innerHTML = '<span class="hint">Belum ada pemain lain online.</span>'; return; }
  bar.innerHTML = onlinePlayersList.map(p =>
    `<span class="online-pill"><span class="dot ${p.online ? '' : 'offline'}"></span>${escapeAttrVal(p.nama_karakter || p.name)}</span>`
  ).join('');
}

socket.on('players-list-update', (list) => {
  onlinePlayersList = list || [];
  renderOnlinePlayers();
});

// =============================== TABS ===================================
function showPageTab(name) {
  ['sheet','battle','map','story','companion','shop'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === name ? '' : 'none';
    document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === name);
  });
  if (name === 'battle') renderBattleStatus();
  if (name === 'map') renderPMap();
  if (name === 'story') renderStoryPlayer();
  if (name === 'companion') renderCompanions();
  if (name === 'shop') renderShopList();
}
document.getElementById('tabBtnSheet').addEventListener('click', () => showPageTab('sheet'));
document.getElementById('tabBtnBattle').addEventListener('click', () => showPageTab('battle'));
document.getElementById('tabBtnMap').addEventListener('click', () => showPageTab('map'));
document.getElementById('tabBtnStory').addEventListener('click', () => showPageTab('story'));
document.getElementById('tabBtnCompanion').addEventListener('click', () => showPageTab('companion'));
document.getElementById('tabBtnShop').addEventListener('click', () => showPageTab('shop'));

function showBattleSubTab(name) {
  document.getElementById('battle-sub-battle').style.display = name === 'battle' ? '' : 'none';
  document.getElementById('battle-sub-dice').style.display = name === 'dice' ? '' : 'none';
  document.getElementById('battleSubTabBattle').classList.toggle('active', name === 'battle');
  document.getElementById('battleSubTabDice').classList.toggle('active', name === 'dice');
}
document.getElementById('battleSubTabBattle').addEventListener('click', () => showBattleSubTab('battle'));
document.getElementById('battleSubTabDice').addEventListener('click', () => showBattleSubTab('dice'));

// =============================== CLASS PICKER ==========================
function renderClassPicker() {
  const hint = document.getElementById('classHint');
  const row = document.getElementById('classPickRow');
  const preview = document.getElementById('classPreview');
  const unlocked = myUnlockedClasses.map(id => classCatalog[id]).filter(Boolean);
  if (!unlocked.length) { hint.textContent = 'DM belum membuka kelas apa pun untukmu.'; row.style.display = 'none'; preview.innerHTML = ''; return; }
  hint.textContent = 'Kelas yang sudah dibuka DM untukmu:';
  row.style.display = 'flex';
  const sel = document.getElementById('f_class_pick');
  const prevVal = sel.value;
  sel.innerHTML = unlocked.map(c => `<option value="${c.id}">${escapeAttrVal(c.nama)}${c.exp_req ? ' (EXP: '+c.exp_req+')' : ''}</option>`).join('');
  if (unlocked.some(c => c.id === prevVal)) sel.value = prevVal;
  renderClassPreview();
  sel.onchange = renderClassPreview;
}

function renderClassPreview() {
  const kelas = classCatalog[document.getElementById('f_class_pick').value];
  const preview = document.getElementById('classPreview');
  if (!kelas) { preview.innerHTML = ''; return; }
  const skillLine = arr => (arr || []).filter(s => s.nama).map(s => escapeAttrVal(s.nama)).join(', ') || '-';
  preview.innerHTML = `
    <div class="hint">${escapeAttrVal(kelas.deskripsi || '')}</div>
    <div class="hint" style="margin-top:4px;"><strong>Active:</strong> ${skillLine(kelas.skills?.active)}</div>
    <div class="hint"><strong>Passive:</strong> ${skillLine(kelas.skills?.passive)}</div>
    <div class="hint"><strong>Ultimate:</strong> ${skillLine(kelas.skills?.ultimate)}</div>`;
}

document.getElementById('btnChangeClass').addEventListener('click', () => {
  const classId = document.getElementById('f_class_pick').value;
  if (!classId) return;
  const kelas = classCatalog[classId];
  if (!kelas) return;
  if (!confirm(`Pilih kelas "${kelas.nama}"? Skill saat ini akan diganti.`)) return;
  socket.emit('player:change-class', { code: CODE, playerId: PLAYER_ID, classId }, (res) => {
    if (res && res.ok) { fillForm(res.sheet); showToast(`🎓 Kelas diganti menjadi ${kelas.nama}.`); }
    else alert(res && res.error ? res.error : 'Gagal mengganti kelas.');
  });
});

// =============================== INVENTORY ==============================
function invMaxSlots() { return INV_BASE_SLOTS + (parseInt(invExtraSlots, 10) || 0); }

function renderInventory() {
  const box = document.getElementById('inventoryContainer');
  box.innerHTML = '';
  invState.forEach((it, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'inv-row-v2';
    wrap.innerHTML = `
      <div class="inv-header">
        <span class="inv-num">${i + 1}</span>
        <input type="checkbox" ${it.checked ? 'checked' : ''} title="Sudah dipakai">
        <input type="text" value="${escapeAttrVal(it.item)}" placeholder="Nama item" data-fromdm="${it.fromDM ? '1' : '0'}" style="flex:1;">
        ${it.fromDM ? '<span class="dm-tag">dari DM</span>' : ''}${it.fromShop ? '<span class="dm-tag" style="background:var(--sapphire);">dari Shop</span>' : ''}
        <input type="number" min="1" value="${it.qty || 1}" style="width:50px;" title="Qty">
        <button type="button" class="inv-remove" title="Hapus slot">×</button>
      </div>
      <div class="row" style="margin:0; gap:6px;">
        <select style="max-width:150px;" title="Tipe item">
          ${INV_ITEM_TYPES.map(([t,label]) => `<option value="${t}" ${(it.type||'misc')===t?'selected':''}>${label}</option>`).join('')}
        </select>
        <input type="text" value="${escapeAttrVal(it.formula||'')}" placeholder="Formula (mis. 1d4+2)" style="flex:1;">
        <input type="text" value="${escapeAttrVal(it.desc||'')}" placeholder="Deskripsi item…" style="flex:2;">
      </div>`;
    wrap.querySelector('input[type=checkbox]').addEventListener('change', e => { it.checked = e.target.checked; scheduleSave(); });
    wrap.querySelector('input[type=text]').addEventListener('input', e => { it.item = e.target.value; scheduleSave(); });
    wrap.querySelector('input[type=number]').addEventListener('input', e => { it.qty = parseInt(e.target.value,10)||1; scheduleSave(); });
    wrap.querySelectorAll('select')[0].addEventListener('change', e => { it.type = e.target.value; scheduleSave(); renderBattleInventory(); });
    wrap.querySelectorAll('input[type=text]')[1].addEventListener('input', e => { it.formula = e.target.value; scheduleSave(); });
    wrap.querySelectorAll('input[type=text]')[2].addEventListener('input', e => { it.desc = e.target.value; scheduleSave(); });
    wrap.querySelector('.inv-remove').addEventListener('click', () => { invState.splice(i, 1); renderInventory(); scheduleSave(); });
    box.appendChild(wrap);
  });
  const max = invMaxSlots();
  const countLabel = document.getElementById('invCountLabel');
  if (countLabel) countLabel.textContent = `(${invState.length}/${max} slot)`;
  const counterEl = document.getElementById('invSlotCounter');
  if (counterEl) {
    counterEl.textContent = invState.length >= max
      ? `Slot penuh (${invState.length}/${max}) — minta DM tambah slot kalau perlu.`
      : `${invState.length}/${max} slot terpakai`;
    counterEl.classList.toggle('full', invState.length >= max);
  }
  const addBtn = document.getElementById('btnAddInvSlot');
  if (addBtn) addBtn.disabled = invState.length >= max;
}
document.getElementById('btnAddInvSlot').addEventListener('click', () => {
  if (invState.length >= invMaxSlots()) return;
  invState.push({ checked: false, item: '', desc: '', type: 'misc', qty: 1 });
  renderInventory(); scheduleSave();
});

// =============================== SURVIVAL (Lapar & Haus) =================
// Konsumsi item bertipe 'food'/'drink' dari inventory buat isi ulang lapar/haus.
// Formula item dipakai sebagai jumlah flat (bukan dice roll) — misal isi "30".
function consumeSurvivalItem(itemType, hungerOrThirstFieldId, maxFieldId, label) {
  const idx = invState.findIndex(it => it.item && it.type === itemType && !it.checked && (it.qty || 1) > 0);
  if (idx === -1) {
    document.getElementById('survivalActionStatus').textContent = `Kamu tidak punya item ${label} di inventory.`;
    return;
  }
  const it = invState[idx];
  const amount = parseInt(it.formula, 10) || 20;
  const max = parseInt(val(maxFieldId), 10) || 100;
  const cur = parseInt(val(hungerOrThirstFieldId), 10) || 0;
  document.getElementById(hungerOrThirstFieldId).value = Math.max(0, Math.min(max, cur + amount));
  if ((it.qty || 1) > 1) { it.qty = (it.qty || 1) - 1; } else { it.checked = true; }
  renderInventory();
  updateHpBar();
  document.getElementById('survivalActionStatus').textContent = `✓ Pakai "${it.item}" — ${label} +${amount}.`;
  scheduleSave();
}
document.getElementById('btnEat').addEventListener('click', () => consumeSurvivalItem('food', 'f_hunger', 'f_hunger_max', 'Lapar'));
document.getElementById('btnDrink').addEventListener('click', () => consumeSurvivalItem('drink', 'f_thirst', 'f_thirst_max', 'Haus'));

// =============================== GEARS (equipment slot ala inventory) ===
const GEAR_STAT_OPTIONS = [
  ['','- (cuma catatan)'],['ac','AC'],['hp_max','HP Max'],['mp_max','MP Max'],['sp_max','SP Max'],
  ['atk','ATK'],['def','DEF'],['other','Lainnya']
];
function renderGears() {
  const box = document.getElementById('gearsContainer');
  if (!box) return;
  box.innerHTML = GEAR_SLOTS.map(([key, label]) => {
    const g = gearState.find(x => x.key === key) || { key, item: '', stat: '', amount: '', equipped: false };
    return `<div class="inv-row-v2" data-gear="${key}">
      <div class="inv-header">
        <span class="inv-num">${label}</span>
        <input type="text" data-gf="item" value="${escapeAttrVal(g.item)}" placeholder="Nama item ${label.toLowerCase()}" style="flex:1;">
        <label class="hint" style="margin:0; display:flex; align-items:center; gap:3px;">
          <input type="checkbox" data-gf="equipped" ${g.equipped ? 'checked' : ''} style="width:auto;"> Equip
        </label>
      </div>
      <div class="row" style="margin:0; gap:6px;">
        <select data-gf="stat" style="max-width:120px;" title="Efek stat saat di-equip">
          ${GEAR_STAT_OPTIONS.map(([k,l]) => `<option value="${k}" ${g.stat===k?'selected':''}>${l}</option>`).join('')}
        </select>
        <input type="text" data-gf="amount" value="${escapeAttrVal(g.amount)}" placeholder="Jumlah (+/-)" style="max-width:110px;">
        <span class="hint" style="flex:1;">${g.equipped && g.stat ? `✓ Aktif: ${g.stat.toUpperCase()} ${fmtMod(parseFloat(g.amount)||0)}` : ''}</span>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-gear]').forEach(wrap => {
    const key = wrap.dataset.gear;
    const g = gearState.find(x => x.key === key);
    wrap.querySelectorAll('[data-gf]').forEach(el => {
      const ev = () => {
        const f = el.dataset.gf;
        g[f] = f === 'equipped' ? el.checked : el.value;
        renderGears(); renderBuffTotalsSummary(document.getElementById('buffTotalsSheet')); renderBattleStatus(); scheduleSave();
      };
      el.addEventListener('input', ev); el.addEventListener('change', ev);
    });
  });
}

// =============================== TRAIT (ras + efek stat) =================
function renderRaceTraits() {
  const box = document.getElementById('raceTraitContainer');
  if (!box) return;

  const picker = `
    <div class="row" style="margin-bottom:8px; align-items:center;">
      <select id="racePresetPicker" style="flex:1;">
        <option value="">— Pilih Ras (auto-isi 4 Trait di bawah) —</option>
        ${RACE_PRESETS.map(r => `<option value="${r.id}">${escapeAttrVal(r.nama)}</option>`).join('')}
      </select>
      <button type="button" id="btnApplyRacePreset" class="small secondary" style="white-space:nowrap;">Terapkan</button>
    </div>
    <p class="hint" id="racePresetDesc" style="margin:0 0 8px;"></p>`;

  const rows = raceTraitState.map((t, i) => `
    <div class="inv-row-v2" data-rt="${i}">
      <div class="inv-header">
        <span class="inv-num">◆ ${i + 1}</span>
        <input type="text" data-rf="nama" value="${escapeAttrVal(t.nama)}" placeholder="Nama trait" style="flex:1;">
      </div>
      <div class="row" style="margin:0; gap:6px;">
        <select data-rf="stat" style="max-width:130px;" title="Efek stat trait ini">
          ${RACE_TRAIT_STAT_OPTIONS.map(([k,l]) => `<option value="${k}" ${t.stat===k?'selected':''}>${l}</option>`).join('')}
        </select>
        <input type="text" data-rf="amount" value="${escapeAttrVal(t.amount)}" placeholder="Jumlah (+/-)" style="max-width:110px;">
        <span class="hint" style="flex:1;">${t.stat ? `✓ Aktif: ${t.stat.toUpperCase()} ${fmtMod(parseFloat(t.amount)||0)}` : ''}</span>
      </div>
    </div>`).join('');

  box.innerHTML = picker + rows;

  document.getElementById('racePresetPicker').addEventListener('change', (e) => {
    const preset = RACE_PRESETS.find(r => r.id === e.target.value);
    document.getElementById('racePresetDesc').textContent = preset ? preset.desc : '';
  });
  document.getElementById('btnApplyRacePreset').addEventListener('click', () => {
    const id = document.getElementById('racePresetPicker').value;
    const preset = RACE_PRESETS.find(r => r.id === id);
    if (!preset) return alert('Pilih ras dulu.');
    const hasExisting = raceTraitState.some(t => t.nama || t.stat);
    if (hasExisting && !confirm(`Terapkan trait "${preset.nama}"? Trait yang udah diisi sekarang bakal ketimpa.`)) return;
    raceTraitState = Array.from({ length: RACE_TRAIT_SLOTS }, (_, i) => {
      const src = preset.traits[i];
      return src ? { nama: src.nama, stat: src.stat, amount: src.amount } : { nama: '', stat: '', amount: '' };
    });
    // Isi juga field "Ras" (flavor) kalau masih kosong, biar konsisten sama trait yg baru diterapkan
    const rasEl = document.getElementById('f_ras');
    if (rasEl && !rasEl.value.trim()) rasEl.value = preset.nama;
    renderRaceTraits();
    renderBuffTotalsSummary(document.getElementById('buffTotalsSheet'));
    renderBattleStatus();
    scheduleSave();
  });

  box.querySelectorAll('[data-rt]').forEach(wrap => {
    const i = parseInt(wrap.dataset.rt, 10);
    wrap.querySelectorAll('[data-rf]').forEach(el => {
      const ev = () => {
        raceTraitState[i][el.dataset.rf] = el.value;
        renderRaceTraits();
        renderBuffTotalsSummary(document.getElementById('buffTotalsSheet'));
        renderBattleStatus();
        scheduleSave();
      };
      el.addEventListener('input', ev); el.addEventListener('change', ev);
    });
  });
}

// =============================== BUFF/DEBUFF ============================
function computeBuffTotals() {
  const totals = { ac: 0, hp_max: 0, mp_max: 0, sp_max: 0, atk: 0, def: 0, other: 0 };
  buffState.forEach(b => {
    const stat = b.stat;
    const amount = parseFloat(b.jumlah);
    if (!stat || !(stat in totals) || isNaN(amount)) return;
    totals[stat] += amount;
  });
  // Gear yang di-equip juga nambah status, kaya item RPG pada umumnya
  (gearState || []).forEach(g => {
    if (!g.equipped) return;
    const stat = g.stat;
    const amount = parseFloat(g.amount);
    if (!stat || !(stat in totals) || isNaN(amount)) return;
    totals[stat] += amount;
  });
  // Trait ras — selalu aktif (bawaan), gak perlu di-equip kaya gear
  (raceTraitState || []).forEach(t => {
    const stat = t.stat;
    const amount = parseFloat(t.amount);
    if (!stat || !(stat in totals) || isNaN(amount)) return;
    totals[stat] += amount;
  });
  return totals;
}

function buffStatSelectHtml(b) {
  return `<select data-f="stat">${BUFF_STAT_OPTIONS.map(([k,label]) =>
    `<option value="${k}" ${b.stat===k?'selected':''}>${label}</option>`).join('')}</select>`;
}

// Auto-apply conditions from buffs (DOT poison → Poisoned, burn → Burn, dll)
function syncConditionsFromBuffs() {
  const activeEffects = buffState.filter(b => b.stat === 'dot' || b.stat === 'heal_dot');
  const hasPoison = activeEffects.some(b => (b.nama||'').toLowerCase().includes('poison') || (b.nama||'').toLowerCase().includes('racun'));
  const hasBurn = activeEffects.some(b => (b.nama||'').toLowerCase().includes('burn') || (b.nama||'').toLowerCase().includes('bakar'));
  const hasBleeding = activeEffects.some(b => (b.nama||'').toLowerCase().includes('bleed') || (b.nama||'').toLowerCase().includes('luka'));
  document.querySelectorAll('.cond-box').forEach(cb => {
    if (cb.value === 'Poisoned' && hasPoison) cb.checked = true;
    if (cb.value === 'Burn' && hasBurn) cb.checked = true;
    if (cb.value === 'Bleeding' && hasBleeding) cb.checked = true;
  });
}

function renderBuffsSheet() {
  const box = document.getElementById('buffContainer');
  if (!box) return;
  const active = document.activeElement;
  if (box.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
  box.innerHTML = `<p class="hint" style="margin-bottom:6px;">
    <strong>DOT</strong> = damage per giliran · <strong>HEAL</strong> = regen HP per giliran · 
    <strong>Regen MP/SP</strong> = regenerasi MP/SP per giliran.<br>
    Jumlah boleh angka (mis. 5) atau formula dadu (mis. 1d4+2). Negatif = kebalikannya.
    Centang "Status Condition" buat efek yang juga mengenakan kondisi pada karakter.
  </p>`;
  if (!buffState.length) { box.innerHTML += '<p class="hint">Belum ada efek aktif.</p>'; }
  buffState.forEach((b, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'border-bottom:1px solid var(--gold); padding-bottom:8px; margin-bottom:8px;';
    row.innerHTML = `
      <div class="row">
        <div class="field"><label>Nama Efek</label><input type="text" data-f="nama" value="${escapeAttrVal(b.nama)}"></div>
        <div class="field" style="max-width:100px;"><label>Jenis</label>
          <select data-f="jenis">
            <option value="">-</option>
            <option value="Buff" ${b.jenis==='Buff'?'selected':''}>Buff</option>
            <option value="Debuff" ${b.jenis==='Debuff'?'selected':''}>Debuff</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field" style="max-width:160px;"><label>Efek ke Stat</label>${buffStatSelectHtml(b)}</div>
        <div class="field" style="max-width:110px;"><label>Jumlah (+/-)</label><input type="text" data-f="jumlah" placeholder="-2 / 1d4+2" value="${escapeAttrVal(b.jumlah)}"></div>
        <div class="field" style="max-width:110px;"><label>Sisa Giliran</label><input type="number" step="1" min="0" data-f="sisaTurn" placeholder="kosong=tetap" value="${escapeAttrVal(b.sisaTurn)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Durasi / Catatan</label><input type="text" data-f="durasi" value="${escapeAttrVal(b.durasi)}"></div>
        <div class="field" style="max-width:140px;"><label>Status Condition</label>
          <select data-f="statusEffect">
            ${STATUS_EFFECT_OPTIONS.map(s => `<option value="${s}" ${b.statusEffect===s?'selected':''}>${s||'(tidak ada)'}</option>`).join('')}
          </select>
        </div>
      </div>
      <button type="button" class="secondary small" data-remove style="margin-top:4px;">× Hapus Efek</button>`;
    row.querySelectorAll('[data-f]').forEach(el => {
      const ev = () => { b[el.dataset.f] = el.value; syncConditionsFromBuffs(); renderBuffsBattle(); renderBattleStatus(); scheduleSave(); };
      el.addEventListener('input', ev); el.addEventListener('change', ev);
    });
    row.querySelector('[data-remove]').addEventListener('click', () => { buffState.splice(i, 1); renderBuffsSheet(); renderBuffsBattle(); renderBattleStatus(); scheduleSave(); });
    box.appendChild(row);
  });
  renderBuffTotalsSummary(document.getElementById('buffTotalsSheet'));
}
document.getElementById('btnAddBuffSheet').addEventListener('click', () => {
  buffState.push({ nama: '', jenis: '', stat: '', jumlah: '', sisaTurn: '', durasi: '', statusEffect: '' });
  renderBuffsSheet(); renderBuffsBattle(); scheduleSave();
});

function renderBuffTotalsSummary(box) {
  if (!box) return;
  const t = computeBuffTotals();
  const parts = [];
  if (t.ac) parts.push(`AC ${fmtMod(t.ac)}`);
  if (t.hp_max) parts.push(`HP Max ${fmtMod(t.hp_max)}`);
  if (t.mp_max) parts.push(`MP Max ${fmtMod(t.mp_max)}`);
  if (t.sp_max) parts.push(`SP Max ${fmtMod(t.sp_max)}`);
  if (t.atk) parts.push(`ATK ${fmtMod(t.atk)}`);
  if (t.def) parts.push(`DEF ${fmtMod(t.def)}`);
  box.innerHTML = parts.length
    ? `<strong>🌀 Modifier Aktif:</strong> ${parts.join(' · ')}`
    : '<span class="hint">Belum ada modifier stat aktif.</span>';
}

function renderBuffsBattle() {
  const box = document.getElementById('btBuffList');
  if (!box) return;
  const active = document.activeElement;
  if (box.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'battle-skill-cat';
  title.textContent = '🌀 Buff / Debuff Aktif';
  box.appendChild(title);
  if (!buffState.length) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Belum ada efek aktif.'; box.appendChild(p);
  }
  buffState.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'battle-buff-row';
    const statLabel = (BUFF_STAT_OPTIONS.find(([k]) => k === b.stat) || ['','?'])[1];
    const jenis = b.jenis || '-';
    const jumlah = b.jumlah || '0';
    row.innerHTML = `
      <span style="flex:1;">${pEscapeHtml(b.nama || '—')} <span class="hint">${jenis} · ${statLabel} ${jumlah}</span>${b.sisaTurn ? ` <span class="hint">(${b.sisaTurn} giliran)</span>` : ' <span class="hint">(permanen)</span>'}</span>
      <button type="button" class="small" data-usebuff="${i}" title="Terapkan efek ini ke target di battle">⚡ Terapkan</button>`;
    // Tombol "Terapkan" langsung kirim efek ke target battle
    row.querySelector('[data-usebuff]').addEventListener('click', () => useBuffInBattle(b));
    box.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'secondary small'; addBtn.style.cssText = 'width:100%; margin-top:4px;';
  addBtn.textContent = '+ Tambah Efek Baru';
  addBtn.addEventListener('click', () => {
    buffState.push({ nama:'', jenis:'', stat:'', jumlah:'', sisaTurn:'', durasi:'', statusEffect:'' });
    renderBuffsSheet(); renderBuffsBattle(); scheduleSave();
  });
  box.appendChild(addBtn);
}

function useBuffInBattle(b) {
  const targetSel = document.getElementById('pActionTarget');
  const targetId = targetSel ? targetSel.value : '';
  if (!targetId) { alert('Pilih target di panel Aksi Roll dulu.'); return; }
  const from = val('f_nama_karakter') || NAME || 'Player';
  let actionType = b.jenis === 'Buff' ? 'buff' : 'debuff';
  let formula = b.jumlah || '0';
  if (b.stat === 'dot') actionType = 'damage';
  if (b.stat === 'heal_dot') actionType = 'heal';
  if (b.stat === 'mp_regen') actionType = 'mana_regen';
  if (b.stat === 'sp_regen') actionType = 'sp_regen';
  socket.emit('battle:roll-action', {
    code: CODE, targetId, actionType, formula, actorName: from,
    note: `Efek: ${b.nama || 'Buff/Debuff'}`
  }, (res) => {
    const status = document.getElementById('pActionStatus');
    if (res && res.ok) {
      if (status) status.textContent = `✓ Efek "${b.nama}" diterapkan: ${res.roll.total}.`;
    } else {
      if (status) status.textContent = res && res.error ? res.error : 'Gagal menerapkan efek.';
    }
  });
}

// =============================== COMPANIONS =============================
function renderCompanions() {
  const box = document.getElementById('companionList');
  if (!box) return;
  box.innerHTML = '';
  if (!companionState.length) {
    box.innerHTML = '<p class="hint">Belum ada companion/summon. DM akan menambahkannya, atau tambah manual di bawah.</p>';
    return;
  }
  companionState.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'companion-card';
    card.innerHTML = `
      <button type="button" class="companion-remove" title="Hapus companion">×</button>
      <div class="companion-card-title">🐾 ${escapeAttrVal(c.nama || 'Companion')} <span class="hint">${escapeAttrVal(c.tipe || '')}</span></div>
      <div class="row">
        <div class="field"><label>Nama</label><input type="text" data-cf="nama" value="${escapeAttrVal(c.nama)}" ${c.fromDM?'readonly':''}></div>
        <div class="field"><label>Tipe / Ras</label><input type="text" data-cf="tipe" value="${escapeAttrVal(c.tipe)}"></div>
        <div class="field" style="max-width:70px;"><label>Level</label><input type="text" data-cf="level" value="${escapeAttrVal(c.level)}" ${c.fromDM?'readonly':''}></div>
      </div>
      <div class="row">
        <div class="field"><label>HP</label><input type="number" data-cf="hp" value="${escapeAttrVal(c.hp)}"></div>
        <div class="field"><label>HP Max</label><input type="number" data-cf="hp_max" value="${escapeAttrVal(c.hp_max)}" ${c.fromDM?'readonly':''}></div>
        <div class="field"><label>MP</label><input type="number" data-cf="mp" value="${escapeAttrVal(c.mp)}"></div>
        <div class="field"><label>MP Max</label><input type="number" data-cf="mp_max" value="${escapeAttrVal(c.mp_max)}" ${c.fromDM?'readonly':''}></div>
      </div>
      <div class="field"><label>Skill / Ability <span class="hint">${c.fromDM?'— dari DM':''}</span></label><textarea data-cf="skill" rows="2" ${c.fromDM?'readonly':''}>${escapeAttrVal(c.skill)}</textarea></div>
      <div class="field"><label>Catatan</label><textarea data-cf="catatan" rows="2">${escapeAttrVal(c.catatan)}</textarea></div>
      ${c.fromDM ? '<span class="hint" style="font-size:11px;">📌 Diberikan DM — Nama/Level/HP Max/Skill hanya bisa diubah DM</span>' : ''}`;
    card.querySelectorAll('[data-cf]').forEach(el => {
      el.addEventListener('input', e => { c[e.target.dataset.cf] = e.target.value; renderCompanions(); scheduleSave(); });
    });
    card.querySelector('.companion-remove').addEventListener('click', () => {
      if (!confirm('Hapus companion ini?')) return;
      companionState.splice(i, 1); renderCompanions(); scheduleSave();
    });
    box.appendChild(card);
  });
}
document.getElementById('btnAddCompanion').addEventListener('click', () => {
  companionState.push({ nama: '', tipe: '', level: '', hp: '', hp_max: '', mp: '', mp_max: '', skill: '', catatan: '', fromDM: false });
  renderCompanions(); scheduleSave();
});

// =============================== SHOP (player-facing) ===================
function renderShopList() {
  const box = document.getElementById('shopItemList');
  if (!box) return;
  const goldDisplay = document.getElementById('shopGoldDisplay');
  const myGold = parseFloat(val('f_gold')) || 0;
  if (goldDisplay) goldDisplay.textContent = myGold;

  const items = Object.values(shopItems || {});
  if (!items.length) { box.innerHTML = '<p class="hint">DM belum menambahkan item ke toko.</p>'; return; }

  box.innerHTML = items.map(it => {
    const price = parseFloat(it.harga) || 0;
    const stokLimited = it.stok !== '' && it.stok != null && !isNaN(parseInt(it.stok, 10));
    const stokNum = stokLimited ? parseInt(it.stok, 10) : null;
    const outOfStock = stokLimited && stokNum <= 0;
    const cantAfford = myGold < price;
    return `<div class="shop-card" data-id="${it.id}">
      <div class="shop-card-top">
        <div>
          <div class="shop-card-name">${pEscapeHtml(it.nama)} ${it.tipe ? `<span class="hint">(${pEscapeHtml(it.tipe)})</span>` : ''}</div>
          ${it.desc || it.deskripsi ? `<div class="shop-card-desc">${pEscapeHtml(it.deskripsi || it.desc)}</div>` : ''}
        </div>
        <div class="shop-card-price">🪙 ${price}</div>
      </div>
      <div class="shop-card-buy-row">
        <span class="hint">Stok: ${stokLimited ? stokNum : '~'}</span>
        <input type="number" min="1" value="1" class="shop-buy-qty" style="max-width:60px;" ${outOfStock ? 'disabled' : ''}>
        <button type="button" class="small shop-buy-btn" data-id="${it.id}" ${outOfStock || cantAfford ? 'disabled' : ''}>${outOfStock ? 'Stok Habis' : cantAfford ? 'Gold Kurang' : '🛒 Beli'}</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.shop-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.shop-card');
      const qty = parseInt(card.querySelector('.shop-buy-qty').value, 10) || 1;
      buyShopItem(btn.dataset.id, qty);
    });
  });
}

function buyShopItem(itemId, qty) {
  socket.emit('player:buy-item', { code: CODE, playerId: PLAYER_ID, itemId, qty }, (res) => {
    if (res && res.ok) {
      fillForm(res.sheet);
      showToast(`🛒 Berhasil membeli item. Gold sekarang: ${res.sheet.gold}.`);
      renderShopList();
    } else {
      alert(res && res.error ? res.error : 'Gagal membeli item.');
    }
  });
}

// =============================== STATIC SECTIONS ========================
function renderStaticSections() {
  // Ability scores
  const ab = document.getElementById('abilityContainer');
  ab.innerHTML = ABILITIES.map(([key,label,full]) => `
    <div class="ability-card">
      <h3>${label}<div class="hint">${full}</div></h3>
      <div class="trio">
        <div><label>Score</label><input type="number" id="ab_${key}_score" data-key="${key}"></div>
        <div><label>Mod</label><input type="text" id="ab_${key}_mod" readonly></div>
        <div><label>Save</label><input type="text" id="ab_${key}_save"></div>
      </div>
    </div>`).join('');
  ABILITIES.forEach(([key]) => {
    document.getElementById(`ab_${key}_score`).addEventListener('input', () => updateMod(key));
  });

  // Conditions
  document.getElementById('conditionContainer').innerHTML =
    CONDITIONS.map(c => `<label class="${c.fatal?'condition-fatal':c.dot?'condition-dot':c.debuff?'condition-debuff':''}"><input type="checkbox" class="cond-box" value="${c.name}"> ${c.name}${c.fatal?' ⛔':c.dot?' 🔥':c.debuff?' 🌀':''}</label>`).join('') +
    `<label>Other: <input type="text" id="f_condition_other" style="width:100px; display:inline-block;"></label>`;

  // Death count
  document.getElementById('deathCountContainer').innerHTML = ['1st','2nd','3rd']
    .map((t,i) => `<label><input type="checkbox" class="death-box" data-i="${i}"> ${t}</label>`).join('');

  // Equipment slots
  document.getElementById('equipmentContainer').innerHTML = [0,1].map(i => `
    <div style="border:1px dashed var(--gold); border-radius:6px; padding:8px; margin-bottom:8px;">
      <div class="hint" style="margin-bottom:4px;">EQUIPMENT ${i+1}</div>
      <div class="row">
        <div class="field"><label>Nama</label><input type="text" id="eq_${i}_nama"></div>
        <div class="field"><label>Tipe</label><input type="text" id="eq_${i}_tipe"></div>
      </div>
      <div class="row">
        <div class="field"><label>ATK Bonus</label><input type="text" id="eq_${i}_atk_bonus"></div>
        <div class="field"><label>Damage</label><input type="text" id="eq_${i}_damage"></div>
        <div class="field" style="max-width:110px;"><label>Elemen</label>
          <select id="eq_${i}_element">
            <option value="">-</option>
            ${ELEMENT_KEYS.map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label>Properties / Catatan</label><textarea id="eq_${i}_catatan" rows="2"></textarea></div>
    </div>`).join('');

  // Gears — kaya inventory: isi item, pilih efek stat, "Equip" buat mengaktifkan statusnya
  renderGears();

  // Extra weapon
  document.getElementById('extraWeaponContainer').innerHTML = [0,1].map(i => `
    <div style="border:1px dashed var(--gold); border-radius:6px; padding:6px; margin-bottom:6px;">
      <div class="row">
        <div class="field"><label>Nama ${i+1}</label><input type="text" id="ew_${i}_nama"></div>
        <div class="field"><label>ATK</label><input type="text" id="ew_${i}_atk_bonus"></div>
        <div class="field"><label>DMG</label><input type="text" id="ew_${i}_damage"></div>
      </div>
      <div class="row">
        <div class="field" style="max-width:110px;"><label>Elemen</label>
          <select id="ew_${i}_element">
            <option value="">-</option>
            ${ELEMENT_KEYS.map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Catatan</label><input type="text" id="ew_${i}_catatan"></div>
      </div>
    </div>`).join('');

  // Skills: Active 5, Passive 2, Ultimate 2
  const skillBlock = (prefix, n, defaultAction) => Array.from({ length: n }).map((_, i) => `
    <div style="border-bottom:1px dashed var(--gold); padding-bottom:8px; margin-bottom:8px;">
      <div class="row">
        <div class="field" style="margin-bottom:4px;"><label>#${i+1}</label><input type="text" id="${prefix}_${i}_nama" placeholder="Nama skill"></div>
        <div class="field" style="max-width:80px; margin-bottom:4px;"><label>Rank/Lvl</label><input type="text" id="${prefix}_${i}_rank"></div>
      </div>
      <div class="row">
        <div class="field" style="max-width:70px; margin:0;"><label>MP</label><input type="number" id="${prefix}_${i}_mp_cost" placeholder="0"></div>
        <div class="field" style="max-width:70px; margin:0;"><label>SP</label><input type="number" id="${prefix}_${i}_sp_cost" placeholder="0"></div>
        <div class="field" style="max-width:130px; margin:0;"><label>Jenis Aksi</label>
          <select id="${prefix}_${i}_action">${SKILL_ACTION_OPTIONS.map(([v,l]) => `<option value="${v}" ${v===defaultAction?'selected':''}>${l}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin:0;"><label>Formula Dadu</label><input type="text" id="${prefix}_${i}_formula" placeholder="1d8+3"></div>
      </div>
      <div class="row" style="margin-top:4px;">
        <div class="field" style="max-width:160px; margin:0;"><label>Status Effect</label>
          <select id="${prefix}_${i}_statusEffect">
            ${STATUS_EFFECT_OPTIONS.map(s => `<option value="${s}">${s||'(tidak ada)'}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0;"><label>Deskripsi</label><input type="text" id="${prefix}_${i}_desc" placeholder="Efek skill…"></div>
      </div>
    </div>`).join('');

  document.getElementById('skillActiveContainer').innerHTML = skillBlock('sk_active', 5, 'damage');
  document.getElementById('skillPassiveContainer').innerHTML = skillBlock('sk_passive', 2, 'buff');
  document.getElementById('skillUltimateContainer').innerHTML = skillBlock('sk_ultimate', 2, 'ultimate');

  // Trait (Race) — sekarang punya efek stat beneran, render-nya di renderRaceTraits()
  renderRaceTraits();

  // Atribut Elemen (class trait renamed)
  document.getElementById('classTraitContainer').innerHTML = ELEMENT_KEYS.map(([key, label]) => `
    <div class="attr-trait-row">
      <label class="attr-trait-label">${label}</label>
      <input type="text" id="ct_${key}" class="attr-trait-pct" placeholder="0%">
      <span class="attr-trait-applies hint" id="ct_${key}_info"></span>
    </div>`).join('');
  ELEMENT_KEYS.forEach(([key]) => {
    document.getElementById(`ct_${key}`).addEventListener('input', () => updateAttrTraitInfo(key));
  });
}

function updateAttrTraitInfo(key) {
  const pct = parseFloat(val(`ct_${key}`)) || 0;
  const el = document.getElementById(`ct_${key}_info`);
  if (!el) return;
  if (pct === 0) { el.textContent = ''; return; }
  const dmgOut = pct > 0 ? `+${pct}% dmg keluar` : `${pct}% dmg keluar`;
  const dmgIn = pct > 0 ? `-${pct}% dmg masuk` : `+${Math.abs(pct)}% dmg masuk`;
  el.textContent = `${dmgOut} | ${dmgIn}`;
  el.style.color = pct > 0 ? 'var(--gold)' : 'var(--crimson-bright)';
}

function updateMod(key) {
  const score = parseInt(document.getElementById(`ab_${key}_score`).value, 10);
  const modEl = document.getElementById(`ab_${key}_mod`);
  if (isNaN(score)) { modEl.value = ''; return; }
  const mod = Math.floor((score - 10) / 2);
  modEl.value = (mod >= 0 ? '+' : '') + mod;
}

function updateHpBar() {
  setResourceBar('hpBar', 'f_current_hp', 'f_max_hp');
  setResourceBar('mpBar', 'f_mp_current', 'f_mp_max');
  setResourceBar('spBar', 'f_sp_current', 'f_sp_max');
  setResourceBar('hungerBar', 'f_hunger', 'f_hunger_max');
  setResourceBar('thirstBar', 'f_thirst', 'f_thirst_max');
}
function setResourceBar(barId, curId, maxId) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  const max = parseInt(val(maxId), 10);
  const cur = parseInt(val(curId), 10);
  if (!max || isNaN(max)) { bar.style.width = '100%'; return; }
  bar.style.width = Math.max(0, Math.min(100, (isNaN(cur) ? max : cur) / max * 100)) + '%';
}

// =============================== FILL FORM ==============================
function fillForm(sheet) {
  document.getElementById('f_nama_karakter').value = sheet.nama_karakter || '';
  document.getElementById('f_kelas').value = sheet.kelas || '';
  document.getElementById('f_ras').value = sheet.ras || '';
  document.getElementById('f_alignment').value = sheet.alignment || '';
  document.getElementById('f_lv').value = sheet.lv || '';
  document.getElementById('f_exp').value = sheet.exp || '';
  document.getElementById('f_kelas_exp').value = sheet.kelas_exp || '';
  document.getElementById('charNameDisplay').textContent = sheet.nama_karakter || 'Character Sheet';

  ABILITIES.forEach(([key]) => {
    const a = sheet.ability[key] || {};
    document.getElementById(`ab_${key}_score`).value = a.score || '';
    document.getElementById(`ab_${key}_save`).value = a.save || '';
    updateMod(key);
  });

  document.getElementById('f_ac').value = sheet.ac || '';
  document.getElementById('f_initiative').value = sheet.initiative || '';
  document.getElementById('f_max_hp').value = sheet.max_hp || '';
  document.getElementById('f_current_hp').value = sheet.current_hp || '';
  document.getElementById('f_temp_hp').value = sheet.temp_hp || '';
  document.getElementById('f_mp_max').value = sheet.mp_max || '';
  document.getElementById('f_mp_current').value = sheet.mp_current || '';
  document.getElementById('f_sp_max').value = sheet.sp_max || '';
  document.getElementById('f_sp_current').value = sheet.sp_current || '';
  const surv = sheet.survival || { hunger: 100, hunger_max: 100, thirst: 100, thirst_max: 100 };
  document.getElementById('f_hunger').value = surv.hunger ?? 100;
  document.getElementById('f_hunger_max').value = surv.hunger_max ?? 100;
  document.getElementById('f_thirst').value = surv.thirst ?? 100;
  document.getElementById('f_thirst_max').value = surv.thirst_max ?? 100;
  updateHpBar();

  document.querySelectorAll('.cond-box').forEach(cb => { cb.checked = (sheet.condition || []).includes(cb.value); });
  document.getElementById('f_condition_other').value = sheet.condition_other || '';
  document.querySelectorAll('.death-box').forEach(cb => { cb.checked = !!(sheet.death_count || [])[+cb.dataset.i]; });
  document.getElementById('f_goal').value = sheet.goal || '';

  (sheet.equipment || []).forEach((eq, i) => {
    ['nama','tipe','atk_bonus','damage','catatan'].forEach(f => {
      const el = document.getElementById(`eq_${i}_${f}`); if (el) el.value = eq[f] || '';
    });
    const eEl = document.getElementById(`eq_${i}_element`); if (eEl) eEl.value = eq.element || '';
  });

  const gearsSaved = sheet.gears;
  if (Array.isArray(gearsSaved) && gearsSaved.length) {
    gearState = GEAR_SLOTS.map(([key]) => {
      const found = gearsSaved.find(x => x && x.key === key);
      return found ? { key, item: found.item || '', stat: found.stat || '', amount: found.amount || '', equipped: !!found.equipped } : { key, item: '', stat: '', amount: '', equipped: false };
    });
  } else if (gearsSaved && typeof gearsSaved === 'object') {
    // Backward-compat: format lama cuma { helmet: 'nama', ... } tanpa efek stat
    gearState = GEAR_SLOTS.map(([key]) => ({ key, item: gearsSaved[key] || '', stat: '', amount: '', equipped: false }));
  } else {
    gearState = GEAR_SLOTS.map(([key]) => ({ key, item: '', stat: '', amount: '', equipped: false }));
  }
  renderGears();

  (sheet.extra_weapon || []).forEach((ew, i) => {
    ['nama','atk_bonus','damage','catatan'].forEach(f => {
      const el = document.getElementById(`ew_${i}_${f}`); if (el) el.value = ew[f] || '';
    });
    const eEl = document.getElementById(`ew_${i}_element`); if (eEl) eEl.value = ew.element || '';
  });

  invState = (sheet.inventory && sheet.inventory.length)
    ? JSON.parse(JSON.stringify(sheet.inventory))
    : [{ checked: false, item: '', desc: '', type: 'misc', qty: 1 }];
  invExtraSlots = parseInt(sheet.inv_extra_slots, 10) || 0;
  // Kalau slot yang keisi (dari import/legacy) lebih banyak dari cap, cap tetap ngikutin isi biar gak kepotong datanya
  renderInventory();

  document.getElementById('f_gold').value = sheet.gold || '';
  const goldDisplay = document.getElementById('shopGoldDisplay');
  if (goldDisplay) goldDisplay.textContent = sheet.gold || '0';

  // Companion (baru)
  companionState = sheet.companions ? JSON.parse(JSON.stringify(sheet.companions)) : [];
  renderCompanions();

  // Skills: active 5, passive 2, ultimate 2
  const skills = sheet.skills || {};
  const defaultActionByCat = { active: 'damage', passive: 'buff', ultimate: 'ultimate' };
  const nByCat = { active: 5, passive: 2, ultimate: 2 };
  ['active','passive','ultimate'].forEach(cat => {
    const n = nByCat[cat];
    for (let i = 0; i < n; i++) {
      ['nama','rank','formula','desc'].forEach(f => { const el = document.getElementById(`sk_${cat}_${i}_${f}`); if (el) el.value = ''; });
      ['mp_cost','sp_cost'].forEach(f => { const el = document.getElementById(`sk_${cat}_${i}_${f}`); if (el) el.value = ''; });
      const acEl = document.getElementById(`sk_${cat}_${i}_action`); if (acEl) acEl.value = defaultActionByCat[cat];
      const seEl = document.getElementById(`sk_${cat}_${i}_statusEffect`); if (seEl) seEl.value = '';
    }
    (skills[cat] || []).forEach((s, i) => {
      if (i >= n) return;
      ['nama','rank','formula','desc'].forEach(f => { const el = document.getElementById(`sk_${cat}_${i}_${f}`); if (el) el.value = s[f] || ''; });
      ['mp_cost','sp_cost'].forEach(f => { const el = document.getElementById(`sk_${cat}_${i}_${f}`); if (el) el.value = s[f] || ''; });
      const acEl = document.getElementById(`sk_${cat}_${i}_action`); if (acEl) acEl.value = s.action || defaultActionByCat[cat];
      const seEl = document.getElementById(`sk_${cat}_${i}_statusEffect`); if (seEl) seEl.value = s.statusEffect || '';
    });
  });

  buffState = (sheet.buffs && sheet.buffs.length)
    ? JSON.parse(JSON.stringify(sheet.buffs)).filter(b => b && (b.nama || b.jenis || b.durasi))
    : [];
  renderBuffsSheet(); renderBuffsBattle(); syncConditionsFromBuffs();

  // race_trait dulu array of string (flavor text doang), sekarang array of {nama,stat,amount} biar ngefek ke gameplay.
  // Data lama otomatis dikonversi: string jadi {nama: string, stat:'', amount:''} (gak ngefek, tinggal diedit manual).
  raceTraitState = Array.from({ length: RACE_TRAIT_SLOTS }, (_, i) => {
    const src = (sheet.race_trait || [])[i];
    if (src && typeof src === 'object') return { nama: src.nama || '', stat: src.stat || '', amount: src.amount || '' };
    if (typeof src === 'string' && src) return { nama: src, stat: '', amount: '' };
    return { nama: '', stat: '', amount: '' };
  });
  renderRaceTraits();

  const ct = sheet.class_trait || {};
  ELEMENT_KEYS.forEach(([key]) => {
    const el = document.getElementById(`ct_${key}`); if (el) el.value = ct[key] || '';
    updateAttrTraitInfo(key);
  });

  document.getElementById('f_catatan_lain').value = sheet.catatan_lain || '';
  renderBattleStatus();
}

// =============================== READ FORM ==============================
function readForm() {
  const sheet = {
    nama_karakter: val('f_nama_karakter'), kelas: val('f_kelas'), ras: val('f_ras'),
    alignment: val('f_alignment'), lv: val('f_lv'), exp: val('f_exp'), kelas_exp: val('f_kelas_exp'),
    ability: {}, condition: [], condition_other: val('f_condition_other'),
    ac: val('f_ac'), initiative: val('f_initiative'),
    max_hp: val('f_max_hp'), current_hp: val('f_current_hp'), temp_hp: val('f_temp_hp'),
    mp_max: val('f_mp_max'), mp_current: val('f_mp_current'), sp_max: val('f_sp_max'), sp_current: val('f_sp_current'),
    survival: {
      hunger: parseInt(val('f_hunger'), 10) || 0, hunger_max: parseInt(val('f_hunger_max'), 10) || 100,
      thirst: parseInt(val('f_thirst'), 10) || 0, thirst_max: parseInt(val('f_thirst_max'), 10) || 100
    },
    death_count: [0,1,2].map(i => document.querySelector(`.death-box[data-i="${i}"]`).checked),
    goal: val('f_goal'),
    equipment: [0,1].map(i => ({
      nama: val(`eq_${i}_nama`), tipe: val(`eq_${i}_tipe`),
      atk_bonus: val(`eq_${i}_atk_bonus`), damage: val(`eq_${i}_damage`),
      catatan: val(`eq_${i}_catatan`), element: val(`eq_${i}_element`)
    })),
    gears: gearState,
    extra_weapon: [0,1].map(i => ({
      nama: val(`ew_${i}_nama`), atk_bonus: val(`ew_${i}_atk_bonus`),
      damage: val(`ew_${i}_damage`), catatan: val(`ew_${i}_catatan`), element: val(`ew_${i}_element`)
    })),
    inventory: invState,
    inv_extra_slots: invExtraSlots,
    gold: val('f_gold'),
    companions: companionState,
    skills: { active: [], passive: [], ultimate: [] },
    buffs: buffState,
    race_trait: raceTraitState,
    class_trait: {},
    catatan_lain: val('f_catatan_lain')
  };
  ABILITIES.forEach(([key]) => {
    sheet.ability[key] = { score: val(`ab_${key}_score`), mod: val(`ab_${key}_mod`), save: val(`ab_${key}_save`) };
  });
  document.querySelectorAll('.cond-box').forEach(cb => { if (cb.checked) sheet.condition.push(cb.value); });
  const nByCat = { active: 5, passive: 2, ultimate: 2 };
  ['active','passive','ultimate'].forEach(cat => {
    for (let i = 0; i < nByCat[cat]; i++) {
      sheet.skills[cat].push({
        nama: val(`sk_${cat}_${i}_nama`), rank: val(`sk_${cat}_${i}_rank`),
        mp_cost: val(`sk_${cat}_${i}_mp_cost`), sp_cost: val(`sk_${cat}_${i}_sp_cost`),
        formula: val(`sk_${cat}_${i}_formula`), action: val(`sk_${cat}_${i}_action`),
        statusEffect: val(`sk_${cat}_${i}_statusEffect`), desc: val(`sk_${cat}_${i}_desc`)
      });
    }
  });
  ELEMENT_KEYS.forEach(([key]) => { sheet.class_trait[key] = val(`ct_${key}`); });
  return sheet;
}

// =============================== SAVE ===================================
let saveTimer = null;
function scheduleSave() {
  document.getElementById('btnSave').textContent = '💾 Menyimpan…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 700);
}
function doSave() {
  const sheet = readForm();
  socket.emit('player:update-sheet', { code: CODE, playerId: PLAYER_ID, sheet });
  document.getElementById('charNameDisplay').textContent = sheet.nama_karakter || 'Character Sheet';
  document.getElementById('btnSave').textContent = '💾 Tersimpan ✓';
  setTimeout(() => { document.getElementById('btnSave').textContent = '💾 Simpan'; }, 1200);
}
document.getElementById('btnSave').addEventListener('click', doSave);

// =============================== EXPORT/IMPORT ==========================
document.getElementById('btnExportSheet').addEventListener('click', () => {
  const sheet = readForm();
  const blob = new Blob([JSON.stringify({ type: 'dnd-vtt-character-sheet', version: 2, sheet }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (sheet.nama_karakter || 'character').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'character';
  a.href = url; a.download = `${safeName}_sheet.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
document.getElementById('btnImportSheet').addEventListener('click', () => document.getElementById('importSheetFile').click());
document.getElementById('importSheetFile').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const sheet = data && data.sheet ? data.sheet : data;
      if (!sheet || typeof sheet !== 'object') throw new Error('Format tidak valid.');
      if (!confirm('Import sheet ini? Data saat ini akan ditimpa.')) { e.target.value = ''; return; }
      fillForm(sheet); doSave();
      showToast('📥 Sheet berhasil diimport & tersimpan.');
    } catch (err) { alert('Gagal membaca file: ' + err.message); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// =============================== INIT ===================================
renderStaticSections();
['f_max_hp','f_current_hp','f_mp_max','f_mp_current','f_sp_max','f_sp_current'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateHpBar);
});
document.querySelector('.sheet').addEventListener('input', scheduleSave);
document.querySelector('.sheet').addEventListener('change', scheduleSave);

// =============================== SOCKET =================================
socket.on('connect', () => {
  document.getElementById('connBadge').textContent = 'terhubung';
  document.getElementById('connBadge').className = 'badge online';
  socket.emit('player:join-session', { code: CODE, name: NAME, playerId: PLAYER_ID }, (res) => {
    if (!res.ok) { alert(res.error || 'Gagal terhubung ke sesi.'); location.href = '/'; return; }
    PLAYER_ID = res.playerId;
    localStorage.setItem('dnd_player_id_' + CODE, PLAYER_ID);
    fillForm(res.state.me.sheet);
    classCatalog = res.state.classes || {};
    myUnlockedClasses = res.state.me.unlockedClasses || [];
    renderClassPicker();
    battleState.map = res.state.map || {};
    battleState.tokens = res.state.tokens || {};
    battleState.maps = Object.fromEntries((res.state.maps||[]).map(m => [m.id, m]));
    battleState.activeMapId = res.state.activeMapId || 'main';
    { const label = document.getElementById('pMapNameLabel'); if (label) { const nm = (battleState.maps[battleState.activeMapId]||{}).name || ''; label.textContent = nm ? `— ${nm}` : ''; } }
    battleState.battle = res.state.battle || { entries: {}, turn: { activeId: null, round: 1 } };
    battleState.music = res.state.music || { tracks: {}, playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false } };
    diceLog = res.state.log || [];
    onlinePlayersList = res.state.playersList || [];
    shopItems = (res.state.shop && res.state.shop.items) || {};
    storyState = res.state.story || storyState;
    renderPMap(); renderPBattle(); renderDiceLog(); syncPlayerMusic(); renderPMusicList(); renderOnlinePlayers(); renderShopList();
    renderSceneBanner(); renderDialogueBox(); renderStoryPlayer();
  });
});

socket.on('shop-updated', (items) => { shopItems = items || {}; renderShopList(); });
socket.on('classes-update', (classes) => { classCatalog = classes || {}; renderClassPicker(); });
socket.on('your-classes-updated', ({ unlockedClasses, note }) => {
  myUnlockedClasses = unlockedClasses || []; renderClassPicker();
  if (note) showToast('🔓 ' + note);
});
socket.on('disconnect', () => {
  document.getElementById('connBadge').textContent = 'terputus';
  document.getElementById('connBadge').className = 'badge offline';
});
socket.on('your-sheet-updated', ({ sheet, note }) => {
  if (sheet) fillForm(sheet); if (note) showToast('🔔 ' + note);
  // Sync companion from DM
  if (sheet && sheet.companions) { companionState = JSON.parse(JSON.stringify(sheet.companions)); renderCompanions(); }
});
socket.on('you-were-removed', ({ note }) => {
  alert(note || 'DM mengeluarkanmu dari sesi ini.');
  localStorage.removeItem('dnd_player_id_' + CODE); location.href = '/';
});
socket.on('players-list-update', (list) => { onlinePlayersList = list || []; renderOnlinePlayers(); });

// =============================== MAP (fit-to-image, no zoom) ============
const pMapWrap = document.getElementById('pMapWrap');
const pMapImg = document.getElementById('pMapImg');
const pMapInner = document.getElementById('pMapInner');
const pGridOverlay = document.getElementById('pGridOverlay');

socket.on('map-updated', (map) => { battleState.map = map; renderPMap(); });
socket.on('tokens-updated', (tokens) => { battleState.tokens = tokens; renderPTokens(); });
// DM yang atur peta mana yang lagi aktif (mis. pindah ke "Lantai 2 Dungeon") — player otomatis
// ikut pindah, gak bisa milih sendiri, biar peta yang belum waktunya gak kebuka duluan.
socket.on('maps-updated', ({ maps, activeMapId }) => {
  battleState.maps = Object.fromEntries((maps||[]).map(m => [m.id, m]));
  battleState.activeMapId = activeMapId;
  const label = document.getElementById('pMapNameLabel');
  if (label) {
    const name = (battleState.maps[activeMapId]||{}).name || '';
    label.textContent = name ? `— ${name}` : '';
  }
});

function initMapControls() {
  window.addEventListener('resize', () => renderFogCanvasPlayer());
  // Peta gak butuh reflow khusus pas gambar kelar dimuat — cukup re-render fog
  pMapImg.addEventListener('load', () => renderFogCanvasPlayer());
}

function renderPMap() {
  const map = battleState.map || {};
  if (map.imageUrl) {
    pMapImg.src = map.imageUrl;
    pMapImg.style.display = 'block';
    pMapWrap.classList.remove('no-image');
  } else {
    pMapImg.removeAttribute('src');
    pMapImg.style.display = 'none';
    pMapWrap.classList.add('no-image');
  }
  const size = map.gridSize || 50;
  if (map.gridVisible) {
    pGridOverlay.style.backgroundImage =
      `repeating-linear-gradient(0deg, rgba(220,190,120,.55) 0 1px, transparent 1px ${size}px),
       repeating-linear-gradient(90deg, rgba(220,190,120,.55) 0 1px, transparent 1px ${size}px)`;
  } else { pGridOverlay.style.backgroundImage = 'none'; }
  renderFogCanvasPlayer(); // ini juga otomatis manggil renderPTokens() di akhirnya
}

// =============================== FOG OF WAR (player, view-only, DM yang kendaliin on/off) ====
const FOG_COLS = 30, FOG_ROWS = 20; // sama persis dengan resolusi di sisi DM biar sinkron
const fogCanvasPlayer = document.getElementById('pFogLayer');
function renderFogCanvasPlayer() {
  const map = battleState.map || {};
  if (!map.fogVisible) { fogCanvasPlayer.style.display = 'none'; renderPTokens(); return; }
  fogCanvasPlayer.style.display = '';
  const w = pMapInner.offsetWidth || pMapWrap.offsetWidth || 800;
  const h = pMapInner.offsetHeight || pMapWrap.offsetHeight || 400;
  fogCanvasPlayer.width = w; fogCanvasPlayer.height = h;
  const ctx = fogCanvasPlayer.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8,8,12,0.97)'; // player: kabut nyaris gelap total di area belum dibuka DM
  ctx.fillRect(0, 0, w, h);
  const revealed = map.fogRevealed || {};
  const cw = w / FOG_COLS, ch = h / FOG_ROWS;
  ctx.globalCompositeOperation = 'destination-out';
  Object.keys(revealed).forEach(key => {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
  });
  ctx.globalCompositeOperation = 'source-over';
  renderPTokens();
}

let pDraggingTokenId = null;
window.addEventListener('mousemove', (e) => {
  if (!pDraggingTokenId) return;
  const el = pMapInner.querySelector(`.token[data-id="${pDraggingTokenId}"]`);
  if (!el) return;
  const rect = pMapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  el.style.left = x + '%'; el.style.top = y + '%';
});
window.addEventListener('mouseup', (e) => {
  if (!pDraggingTokenId) return;
  const id = pDraggingTokenId; pDraggingTokenId = null;
  const rect = pMapInner.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  const y = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
  socket.emit('token:move', { code: CODE, tokenId: id, x, y });
});

function renderPTokens() {
  pMapInner.querySelectorAll('.token').forEach(el => el.remove());
  const map = battleState.map || {};
  const fogOn = !!map.fogVisible;
  const revealed = map.fogRevealed || {};
  Object.values(battleState.tokens || {}).forEach(tok => {
    const mine = tok.ownerId === PLAYER_ID;
    const ownedByAnyPlayer = !!tok.ownerId; // token yang di-assign ke salah satu player (party member)
    // Fog of War: yang disembunyiin di area gelap cuma token yang DIKENDALIKAN DM (enemy/NPC/dekorasi
    // tanpa owner) — belum "ditemukan" beneran ya belum kelihatan. Token milik SIAPA PUN yang lagi main
    // (diri sendiri maupun sesama player/party member) tetap selalu kelihatan, soalnya sesama anggota
    // party normalnya emang saling tahu posisi satu sama lain, gak ketutup fog of war.
    if (fogOn && !mine && !ownedByAnyPlayer) {
      const col = Math.min(FOG_COLS - 1, Math.max(0, Math.floor((parseFloat(tok.x) || 0) / 100 * FOG_COLS)));
      const row = Math.min(FOG_ROWS - 1, Math.max(0, Math.floor((parseFloat(tok.y) || 0) / 100 * FOG_ROWS)));
      if (!revealed[col + ',' + row]) return; // masih di area gelap, skip render
    }
    const el = document.createElement('div');
    el.className = 'token' + (mine ? ' draggable mine' : '');
    el.style.left = tok.x + '%';
    el.style.top = tok.y + '%';
    el.dataset.id = tok.id;

    // Nama selalu tampil sebagai label di atas token (bukan cuma inisial di dalam lingkaran)
    // — biar jelas siapa itu siapa pas battle rame-rame.
    const nametag = document.createElement('div');
    nametag.className = 'token-nametag';
    nametag.textContent = tok.label || '';
    el.appendChild(nametag);

    const circle = document.createElement('div');
    circle.className = 'token-circle';
    circle.style.background = tok.imageUrl ? 'transparent' : (tok.color || '#555');
    if (tok.tokenType === 'enemy') circle.style.borderColor = '#e07a6b';
    else if (tok.tokenType === 'ally') circle.style.borderColor = '#7bd39a';

    if (tok.imageUrl) {
      const img = document.createElement('img');
      img.src = tok.imageUrl; img.className = 'token-img'; img.draggable = false;
      circle.appendChild(img);
    } else {
      circle.textContent = (tok.label || '').slice(0, 2);
    }
    el.appendChild(circle);

    el.title = (tok.label || '') + (mine ? ' (token kamu — bisa digeser)' : '');
    if (mine) el.addEventListener('mousedown', (e) => { pDraggingTokenId = tok.id; e.preventDefault(); e.stopPropagation(); });
    pMapInner.appendChild(el);
  });
}

// =============================== BATTLE STATUS ==========================
function setBarFill(id, cur, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const m = parseFloat(max), c = parseFloat(cur);
  if (!m || isNaN(m)) { el.style.width = '0%'; return; }
  el.style.width = Math.max(0, Math.min(100, (isNaN(c) ? m : c) / m * 100)) + '%';
}

const SKILL_ACTION_LABEL = Object.fromEntries(SKILL_ACTION_OPTIONS);

function renderBattleInventory() {
  const box = document.getElementById('btInventoryBattle');
  if (!box) return;
  const items = invState.filter(it => it.item && it.type && it.type !== 'misc' && !it.checked);
  if (!items.length) { box.innerHTML = ''; return; }
  let html = '<div class="battle-skill-cat">🎒 Inventory (Bisa Dipakai)</div>';
  items.forEach((it) => {
    const label = INV_ITEM_TYPE_LABEL[it.type] || '📦';
    html += `<div class="skill-line" style="align-items:center;">
      <span>${pEscapeHtml(it.item)} <span class="hint">${label}${it.formula ? ' · ' + pEscapeHtml(it.formula) : ''}${it.aoe ? ' · 💥AoE' : ''}${it.desc ? ' · ' + pEscapeHtml(it.desc) : ''}</span> <span class="hint">(qty: ${it.qty||1})</span></span>
      <button type="button" class="small inv-use-btn" data-inv-i="${invState.indexOf(it)}" title="${it.aoe?'Otomatis kena ke semua musuh/sekutu':'Terapkan ke target terpilih'}">⚡ Pakai</button>
    </div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll('.inv-use-btn').forEach(btn => {
    btn.addEventListener('click', () => useInventoryInBattle(parseInt(btn.dataset.invI, 10)));
  });
}

// Item -> actionType battle. cure & revive ditangani terpisah (lewat battle:apply-status).
const INV_TYPE_TO_ACTION = { heal: 'heal', damage: 'damage', buff: 'buff', debuff: 'debuff', mana_regen: 'mana_regen', sp_regen: 'sp_regen' };

function useInventoryInBattle(idx) {
  const it = invState[idx];
  if (!it) return;
  const targetSel = document.getElementById('pActionTarget');
  const targetId = targetSel ? targetSel.value : '';
  if (!targetId) { alert('Pilih target dulu di panel Aksi Roll.'); return; }
  const from = val('f_nama_karakter') || NAME || 'Player';
  const status = document.getElementById('pActionStatus');

  const consumeItem = () => {
    if ((it.qty || 1) > 1) { it.qty = (it.qty || 1) - 1; } else { it.checked = true; }
    renderInventory(); renderBattleInventory(); scheduleSave();
  };

  // Item yang ditandai AoE di toko/DM otomatis nembak ke semua musuh, walau target yang lagi
  // dipilih di panel cuma 1 orang — biar player gak perlu ganti-ganti dropdown target manual.
  const effectiveTargetId = it.aoe ? '__aoe_enemy__' : targetId;

  if (it.type === 'cure') {
    // Cure: hapus semua status condition di target (pakai kondisi 'Normal' yang artinya bersih)
    socket.emit('battle:apply-status', { code: CODE, targetId: it.aoe ? '__aoe_ally__' : targetId, condition: 'Normal', actorName: from }, (res) => {
      if (res && res.ok) {
        if (status) status.textContent = res.aoe ? `✓ Item "${it.item}" dipakai: status condition ${res.affected.join(', ')} dibersihkan.` : `✓ Item "${it.item}" dipakai: status condition target dibersihkan.`;
        consumeItem();
      } else if (status) status.textContent = res && res.error ? res.error : 'Gagal memakai item.';
    });
    return;
  }

  if (it.type === 'revive') {
    // Revive: bersihkan kondisi fatal + heal sesuai formula (default 1d8 kalau kosong)
    const formula = it.formula || '1d8';
    const reviveTarget = it.aoe ? '__aoe_ally__' : targetId;
    socket.emit('battle:apply-status', { code: CODE, targetId: reviveTarget, condition: 'Normal', actorName: from }, () => {
      socket.emit('battle:roll-action', { code: CODE, targetId: reviveTarget, actionType: 'heal', formula, actorName: from, note: `Item Revive: ${it.item}` }, (res) => {
        if (res && res.ok) {
          if (status) status.textContent = res.aoe
            ? `⚕ Item "${it.item}" dipakai ke semua sekutu: kondisi fatal dibersihkan & heal ${formula}.`
            : `⚕ Item "${it.item}" dipakai: kondisi fatal dibersihkan & heal ${formula} = ${res.roll.total}.`;
          consumeItem();
        } else if (status) status.textContent = res && res.error ? res.error : 'Gagal memakai item.';
      });
    });
    return;
  }

  const actionType = INV_TYPE_TO_ACTION[it.type] || 'damage';
  const formula = it.formula || '1';
  socket.emit('battle:roll-action', { code: CODE, targetId: effectiveTargetId, actionType, formula, actorName: from, note: `Item: ${it.item}` }, (res) => {
    if (res && res.ok) {
      if (res.aoe) {
        const summary = (res.results||[]).map(r => `${r.entryName}: ${r.roll.total}`).join(', ');
        if (status) status.textContent = `💥 Item "${it.item}" dipakai (AoE): ${summary}.`;
      } else if (status) status.textContent = `✓ Item "${it.item}" dipakai: ${formula} = ${res.roll.total}.`;
      consumeItem();
    } else {
      if (status) status.textContent = res && res.error ? res.error : 'Gagal memakai item.';
    }
  });
}

function renderBattleCompanionBlock() {
  const box = document.getElementById('btCompanionBlock');
  if (!box || !companionState.length) { if (box) box.innerHTML = ''; return; }
  let html = '<div class="battle-skill-cat">🐾 Companion</div>';
  companionState.filter(c => c.nama).forEach(c => {
    html += `<div class="skill-line">
      <span>${pEscapeHtml(c.nama)} <span class="hint">${pEscapeHtml(c.tipe || '')} · Lv.${pEscapeHtml(c.level||'-')}</span></span>
      <span class="hint">HP ${pEscapeHtml(c.hp||'?')}/${pEscapeHtml(c.hp_max||'?')} · MP ${pEscapeHtml(c.mp||'?')}/${pEscapeHtml(c.mp_max||'?')}</span>
    </div>`;
  });
  box.innerHTML = html;
}

function renderBattleSkillList() {
  const box = document.getElementById('btSkillList');
  if (!box) return;
  const catLabel = { active: '❌ Active', passive: '✳ Passive', ultimate: '🔥 Ultimate' };
  const defaultActionByCat = { active: 'damage', passive: 'buff', ultimate: 'ultimate' };
  const nByCat = { active: 5, passive: 2, ultimate: 2 };
  const mpCur = parseInt(val('f_mp_current'), 10) || 0;
  const spCur = parseInt(val('f_sp_current'), 10) || 0;
  let html = '';

  // Check if player has fatal condition (can't take turn)
  const activeConditions = [];
  document.querySelectorAll('.cond-box').forEach(cb => { if (cb.checked) activeConditions.push(cb.value); });
  const hasFatal = activeConditions.some(c => {
    const cObj = CONDITIONS.find(x => x.name === c);
    return cObj && cObj.fatal;
  });

  if (hasFatal) {
    const fatalHint = document.getElementById('pFatalHint');
    if (fatalHint) { fatalHint.style.display = ''; fatalHint.textContent = '⛔ Kondisi fatal aktif — karakter tidak bisa mengambil giliran! (' + activeConditions.filter(c => CONDITIONS.find(x => x.name === c && x.fatal)).join(', ') + ')'; }
    box.innerHTML = '<p class="hint" style="color:var(--crimson-bright);">⛔ Tidak bisa pakai skill saat terkena kondisi fatal.</p>';
    return;
  } else {
    const fatalHint = document.getElementById('pFatalHint');
    if (fatalHint) fatalHint.style.display = 'none';
  }

  ['active','passive','ultimate'].forEach(cat => {
    const n = nByCat[cat];
    const lines = [];
    for (let i = 0; i < n; i++) {
      const nama = val(`sk_${cat}_${i}_nama`); if (!nama) continue;
      const rank = val(`sk_${cat}_${i}_rank`);
      const mpCost = parseInt(val(`sk_${cat}_${i}_mp_cost`), 10) || 0;
      const spCost = parseInt(val(`sk_${cat}_${i}_sp_cost`), 10) || 0;
      const formula = val(`sk_${cat}_${i}_formula`);
      const action = val(`sk_${cat}_${i}_action`) || defaultActionByCat[cat];
      const statusEffect = val(`sk_${cat}_${i}_statusEffect`);
      const desc = val(`sk_${cat}_${i}_desc`);
      const costParts = [];
      if (mpCost > 0) costParts.push(`🔵${mpCost} MP`);
      if (spCost > 0) costParts.push(`🟢${spCost} SP`);
      const cantAfford = (mpCost > 0 && mpCur < mpCost) || (spCost > 0 && spCur < spCost);
      lines.push(`
        <div class="skill-line" style="align-items:center; flex-wrap:wrap; gap:4px;">
          <span style="flex:1; min-width:120px;">${pEscapeHtml(nama)} <span class="hint">${pEscapeHtml(rank||'-')} · ${pEscapeHtml(SKILL_ACTION_LABEL[action]||action)}</span>${costParts.length?` <span class="hint">(${costParts.join(', ')})</span>`:''}${statusEffect?` <span class="hint">[→${pEscapeHtml(statusEffect)}]</span>`:''}${desc?`<br><span class="hint" style="font-size:11px;">${pEscapeHtml(desc)}</span>`:''}</span>
          <button type="button" class="small skill-use-btn" ${cantAfford?'disabled title="MP/SP tidak cukup"':''} data-cat="${cat}" data-i="${i}" data-mp="${mpCost}" data-sp="${spCost}" data-formula="${escapeAttrVal(formula)}" data-action="${action}" data-status="${escapeAttrVal(statusEffect)}">⚡ Pakai</button>
        </div>`);
    }
    if (lines.length) html += `<div class="battle-skill-cat">${catLabel[cat]}</div>` + lines.join('');
  });
  box.innerHTML = html || '<p class="hint">Belum ada skill diisi di tab Sheet.</p>';
  box.querySelectorAll('.skill-use-btn').forEach(btn => { btn.addEventListener('click', () => useSkillInBattle(btn.dataset)); });
}

function useSkillInBattle(ds) {
  const nama = val(`sk_${ds.cat}_${ds.i}_nama`) || 'Skill';
  const mpCost = parseInt(ds.mp,10)||0;
  const spCost = parseInt(ds.sp,10)||0;
  const mpCur = parseInt(val('f_mp_current'),10)||0;
  const spCur = parseInt(val('f_sp_current'),10)||0;
  if (mpCost > 0 && mpCur < mpCost) { alert(`MP tidak cukup untuk "${nama}" (butuh ${mpCost}, sisa ${mpCur}).`); return; }
  if (spCost > 0 && spCur < spCost) { alert(`SP tidak cukup untuk "${nama}" (butuh ${spCost}, sisa ${spCur}).`); return; }
  if (mpCost > 0) document.getElementById('f_mp_current').value = mpCur - mpCost;
  if (spCost > 0) document.getElementById('f_sp_current').value = spCur - spCost;
  renderBattleStatus(); scheduleSave();

  // Apply status effect to target
  const statusEffect = ds.status;
  const from = val('f_nama_karakter') || NAME || 'Player';
  const actionType = ds.action || 'damage';
  const targetSel = document.getElementById('pActionTarget');
  const targetId = targetSel ? targetSel.value : '';
  const status = document.getElementById('pActionStatus');
  const costText = [mpCost>0?`-${mpCost} MP`:null,spCost>0?`-${spCost} SP`:null].filter(Boolean).join(', ');
  const note = `Skill: ${nama}${costText?' ('+costText+')':''}${statusEffect?' [Status: '+statusEffect+']':''}`;

  if (ds.formula && targetId) {
    // Apply elemental modifier from class traits
    const element = val(`eq_0_element`) || val(`eq_1_element`) || '';
    const elemPct = element ? (parseFloat(val(`ct_${element}`)) || 0) : 0;
    let formula = ds.formula;
    if (elemPct && (actionType === 'damage' || actionType === 'ultimate')) {
      // Send element info as note for server-side modifier
    }
    socket.emit('battle:roll-action', {
      code: CODE, targetId, actionType, formula, actorName: from, note,
      elementType: element, elemBonus: elemPct
    }, (res) => {
      if (res && res.ok) {
        if (res.aoe) {
          const summary = (res.results||[]).map(r => `${r.entryName}: ${r.roll.total}`).join(', ');
          if (status) status.textContent = `💥 "${nama}" diterapkan (AoE): ${summary}.`;
        } else if (status) status.textContent = `⚡ "${nama}" diterapkan: ${ds.formula} = ${res.roll.total}.`;
        // Apply status effect condition on target (reflect on actor too if self-buff; ikut AoE kalau targetnya AoE)
        if (statusEffect && statusEffect !== '') {
          socket.emit('battle:apply-status', { code: CODE, targetId, condition: statusEffect, actorName: from });
        }
      } else {
        if (status) status.textContent = res && res.error ? res.error : `Gagal menerapkan skill "${nama}".`;
        socket.emit('chat:send', { code: CODE, from, text: `Pakai skill "${nama}"${costText?' ('+costText+')':''}`, type: 'chat' });
      }
    });
  } else {
    socket.emit('chat:send', { code: CODE, from, text: `Pakai skill "${nama}"${costText?' ('+costText+')':''}`, type: 'chat' });
    if (ds.formula) {
      document.getElementById('pActionFormula').value = ds.formula;
      const typeSel = document.getElementById('pActionType'); if (typeSel) typeSel.value = actionType;
      if (status) status.textContent = `Pilih target lalu klik "🎲 Roll & Terapkan" untuk menyelesaikan skill "${nama}".`;
    }
  }
}

function renderBattleEquipList() {
  const box = document.getElementById('btEquipList');
  if (!box) return;
  let html = '';
  const eqLines = [];
  [0,1].forEach(i => {
    const nama = val(`eq_${i}_nama`); if (!nama) return;
    const parts = [];
    if (val(`eq_${i}_atk_bonus`)) parts.push('ATK '+val(`eq_${i}_atk_bonus`));
    if (val(`eq_${i}_damage`)) parts.push('DMG '+val(`eq_${i}_damage`));
    if (val(`eq_${i}_tipe`)) parts.push(val(`eq_${i}_tipe`));
    if (val(`eq_${i}_element`)) parts.push('🔥'+val(`eq_${i}_element`));
    eqLines.push(`<div class="skill-line"><span>${pEscapeHtml(nama)}</span><span class="hint">${pEscapeHtml(parts.join(' · ')||'-')}</span></div>`);
  });
  if (eqLines.length) html += '<div class="battle-skill-cat">⚔ Equipment</div>' + eqLines.join('');
  const ewLines = [];
  [0,1].forEach(i => {
    const nama = val(`ew_${i}_nama`); if (!nama) return;
    const parts = [];
    if (val(`ew_${i}_atk_bonus`)) parts.push('ATK '+val(`ew_${i}_atk_bonus`));
    if (val(`ew_${i}_damage`)) parts.push('DMG '+val(`ew_${i}_damage`));
    if (val(`ew_${i}_element`)) parts.push(val(`ew_${i}_element`));
    ewLines.push(`<div class="skill-line"><span>${pEscapeHtml(nama)}</span><span class="hint">${pEscapeHtml(parts.join(' · ')||'-')}</span>
      <button type="button" class="small" data-ew="${i}" title="Gunakan extra weapon ini di battle">⚡ Pakai</button></div>`);
  });
  if (ewLines.length) html += '<div class="battle-skill-cat">🗡 Extra Weapon</div>' + ewLines.join('');
  box.innerHTML = html || '<p class="hint">Belum ada equipment diisi di tab Sheet.</p>';
  box.querySelectorAll('[data-ew]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.ew, 10);
      const nama = val(`ew_${i}_nama`);
      const dmg = val(`ew_${i}_damage`) || '1d6';
      const element = val(`ew_${i}_element`);
      document.getElementById('pActionFormula').value = dmg;
      document.getElementById('pActionType').value = 'damage';
      if (element) document.getElementById('pDmgElement').value = element;
      const status = document.getElementById('pActionStatus');
      if (status) status.textContent = `Extra weapon "${nama}" siap — pilih target lalu Roll.`;
    });
  });
}

function renderBattleStatus() {
  if (!document.getElementById('bt_current_hp')) return;
  const totals = computeBuffTotals();
  const clampCurrentToEffMax = (curId, maxId, mod) => {
    const maxEff = (parseFloat(val(maxId))||0) + (mod||0);
    const curEl = document.getElementById(curId);
    const curVal = parseFloat(curEl.value);
    if (!isNaN(curVal) && maxEff > 0 && curVal > maxEff) { curEl.value = maxEff; return true; }
    return false;
  };
  let clamped = false;
  clamped = clampCurrentToEffMax('f_current_hp','f_max_hp',totals.hp_max) || clamped;
  clamped = clampCurrentToEffMax('f_mp_current','f_mp_max',totals.mp_max) || clamped;
  clamped = clampCurrentToEffMax('f_sp_current','f_sp_max',totals.sp_max) || clamped;

  [['f_ac','bt_ac'],['f_current_hp','bt_current_hp'],['f_max_hp','bt_max_hp'],
   ['f_mp_current','bt_mp_current'],['f_mp_max','bt_mp_max'],
   ['f_sp_current','bt_sp_current'],['f_sp_max','bt_sp_max']].forEach(([src,dst]) => {
    document.getElementById(dst).value = document.getElementById(src).value;
  });
  setBarFill('btHpFill',val('f_current_hp'),val('f_max_hp'));
  setBarFill('btMpFill',val('f_mp_current'),val('f_mp_max'));
  setBarFill('btSpFill',val('f_sp_current'),val('f_sp_max'));

  const effBadge = (id, base, mod) => {
    const el = document.getElementById(id); if (!el) return;
    const baseNum = parseFloat(base);
    if (mod && !isNaN(baseNum)) { el.textContent = `→ ${baseNum+mod} (${fmtMod(mod)})`; el.style.display = ''; }
    else { el.textContent = ''; el.style.display = 'none'; }
  };
  effBadge('bt_ac_eff',val('f_ac'),totals.ac);
  effBadge('bt_hp_max_eff',val('f_max_hp'),totals.hp_max);
  effBadge('bt_mp_max_eff',val('f_mp_max'),totals.mp_max);
  effBadge('bt_sp_max_eff',val('f_sp_max'),totals.sp_max);

  if (clamped) scheduleSave();
  renderBattleSkillList(); renderBattleEquipList(); renderBuffsBattle();
  renderBattleInventory(); renderBattleCompanionBlock();
}

[['bt_current_hp','f_current_hp'],['bt_mp_current','f_mp_current'],['bt_sp_current','f_sp_current']].forEach(([btId,fId]) => {
  const el = document.getElementById(btId); if (!el) return;
  el.addEventListener('input', () => { document.getElementById(fId).value = el.value; updateHpBar(); renderBattleStatus(); });
});
document.querySelector('.sheet').addEventListener('input', renderBattleStatus);
document.querySelector('.sheet').addEventListener('change', renderBattleStatus);

// =============================== BATTLE LIST ============================
socket.on('battle-updated', (battle) => { battleState.battle = battle; renderPBattle(); });
socket.on('battle-apply-status', ({ targetId, condition }) => {
  // If I'm the target, auto-check the condition
  const myEntry = Object.values(battleState.battle.entries || {}).find(e => e.refType === 'player' && e.refId === PLAYER_ID);
  if (myEntry && myEntry.id === targetId) {
    document.querySelectorAll('.cond-box').forEach(cb => { if (cb.value === condition) cb.checked = true; });
    scheduleSave();
    showToast(`⚠ Kondisi "${condition}" diterapkan ke karaktermu!`);
  }
});

function renderPBattle() {
  const turn = (battleState.battle && battleState.battle.turn) || { activeId: null, round: 1 };
  document.getElementById('pRoundBadge').textContent = 'Round ' + (turn.round || 1);
  const entries = Object.values((battleState.battle && battleState.battle.entries) || {});
  const list = entries.sort((a,b) => { const rb=parseFloat(b.roll)||0,ra=parseFloat(a.roll)||0; if(rb!==ra) return rb-ra; return (a.name||'').localeCompare(b.name||''); });
  const box = document.getElementById('pBattleList');
  if (!list.length) { box.innerHTML = '<p class="hint">Belum ada battle yang berjalan.</p>'; document.getElementById('pTurnHint').textContent = ''; return; }
  const activeEntry = list.find(e => e.id === turn.activeId);
  const myTurn = activeEntry && activeEntry.refType === 'player' && activeEntry.refId === PLAYER_ID;
  document.getElementById('pTurnHint').textContent = myTurn ? '⚡ Ini giliranmu!' : '';
  box.innerHTML = list.map(e => {
    const pct = (() => { const m=parseFloat(e.hp_max),c=parseFloat(e.hp_current); if(!m||isNaN(m)) return 0; return Math.max(0,Math.min(100,(isNaN(c)?m:c)/m*100)); })();
    const conditions = (e.conditions || []).map(c => `<span class="hint">${pEscapeHtml(c)}</span>`).join(' ');
    return `<div class="battle-row ${e.id===turn.activeId?'active':''}">
      <div class="roll-num">${e.roll??'-'}</div>
      <div class="b-info">
        <div class="b-name">${pEscapeHtml(e.name)} <span class="type-pill ${e.type}">${e.type}</span></div>
        <div class="mini-bar-wrap hp" style="margin-top:4px;"><div class="mini-bar-fill" style="width:${pct}%;"></div></div>
        <div class="hint">${e.hp_current??'?'} / ${e.hp_max??'?'} HP${e.ac!==undefined&&e.ac!==''?' · AC '+e.ac:''}</div>
        ${conditions ? `<div style="margin-top:2px;">${conditions}</div>` : ''}
      </div>
      ${e.id===turn.activeId?'<span class="turn-flag">GILIRAN</span>':''}
    </div>`;
  }).join('');

  const targetSel = document.getElementById('pActionTarget');
  if (targetSel) {
    const prevVal = targetSel.value;
    const opts = list.map(e => `<option value="${e.id}">${escapeAttrVal(e.name)} (${e.type})</option>`);
    // Opsi AoE: cuma dimunculin kalau ada minimal 1 peserta yang cocok di grupnya, biar gak nembak kosong.
    const hasEnemy = list.some(e => e.type === 'enemy');
    const hasAlly = list.some(e => e.type === 'pc' || e.type === 'ally');
    const aoeOpts = [];
    if (hasEnemy) aoeOpts.push(`<option value="__aoe_enemy__">💥 Semua Musuh (AoE)</option>`);
    if (hasAlly) aoeOpts.push(`<option value="__aoe_ally__">💥 Semua Sekutu (AoE)</option>`);
    if (list.length > 1) aoeOpts.push(`<option value="__aoe_all__">💥 Semua Peserta (AoE)</option>`);
    targetSel.innerHTML = (aoeOpts.length ? aoeOpts.join('') : '') + (opts.join('') || '<option value="">(belum ada peserta)</option>');
    if (list.some(e => e.id === prevVal) || aoeOpts.some(o => o.includes(`value="${prevVal}"`))) targetSel.value = prevVal;
  }
}

// Aksi Roll dengan elemental modifier
document.getElementById('btnPActionRoll').addEventListener('click', () => {
  const targetId = val('pActionTarget');
  if (!targetId) return alert('Belum ada target battle untuk disasar.');
  const actionType = val('pActionType');
  let formula = val('pActionFormula').trim() || '1d6';
  const actorName = val('f_nama_karakter') || NAME || 'Player';
  const elementType = val('pDmgElement');
  const elemPct = elementType ? (parseFloat(val(`ct_${elementType}`)) || 0) : 0;
  let atkNote = '';
  if (actionType === 'damage' || actionType === 'ultimate') {
    const atkMod = computeBuffTotals().atk;
    if (atkMod) { formula = `${formula}${atkMod>0?'+':''}${atkMod}`; atkNote = ` (ATK ${fmtMod(atkMod)} otomatis ditambahkan)`; }
  }
  socket.emit('battle:roll-action', { code: CODE, targetId, actionType, formula, actorName, elementType, elemBonus: elemPct }, (res) => {
    const status = document.getElementById('pActionStatus');
    if (res && res.ok) {
      if (res.aoe) {
        const summary = (res.results||[]).map(r => `${r.entryName}: ${r.roll.total}`).join(', ');
        status.textContent = `💥 AoE ${formula} diterapkan ke ${res.results.length} target — ${summary}.${atkNote}`;
      } else {
        status.textContent = `✓ ${formula} = ${res.roll.total} diterapkan.${atkNote}${elemPct?' ('+elementType+' '+fmtMod(elemPct)+'%)':''}`;
      }
      document.getElementById('pActionFormula').value = '';
    } else { status.textContent = res && res.error ? res.error : 'Gagal menerapkan aksi.'; }
  });
});

// =============================== DICE LOG / CHAT ========================
socket.on('chat:new', (entry) => {
  diceLog.push(entry); renderDiceLog();
  if (STORY_LOG_TYPES_P.includes(entry.type) && document.getElementById('tab-story').style.display !== 'none') renderStoryRecapPlayer();
});
socket.on('chat:cleared', () => { diceLog = []; renderDiceLog(); });
socket.on('chat:revealed', (entry) => {
  const idx = diceLog.findIndex(e => e.id === entry.id);
  if (idx >= 0) diceLog[idx] = entry; else diceLog.push(entry);
  renderDiceLog();
});

function renderDiceLog() {
  const box = document.getElementById('pDiceLog');
  if (!box) return;
  box.innerHTML = diceLog.map(e => {
    // Color by type
    let cls = e.type || 'chat';
    // Identify DM vs player vs system
    if (e.from === 'DM' || e.from === 'dm') cls = 'dm';
    else if (e.from === 'Sistema' || e.from === 'system' || e.type === 'system') cls = 'system';
    else if (e.type === 'roll') cls = 'roll';
    else if (e.type === 'damage') cls = 'damage';
    else if (e.type === 'heal') cls = 'heal';
    else cls = 'player';
    return `<div class="entry ${cls}${e.secret?' secret':''}">
      <span class="from">${pEscapeHtml(e.from)}:</span> ${pEscapeHtml(e.text)}
      ${e.imageUrl?`<div><img src="${e.imageUrl}" style="max-width:180px; border-radius:5px; border:1px solid var(--gold); margin-top:4px;"></div>`:''}
      ${e.secret?`<span class="secret-badge">🔒 rahasia</span>`:''}
      ${e.ts?`<span class="ts">${new Date(e.ts).toLocaleTimeString()}</span>`:''}
    </div>`;
  }).join('') || '<p class="hint">Belum ada log.</p>';
  box.scrollTop = box.scrollHeight;
}

// =============================== STORY (Scene Banner / Dialog / Quest / Handout) ===
function renderSceneBanner() {
  const scene = (storyState && storyState.scene) || {};
  const el = document.getElementById('sceneBanner'); if (!el) return;
  const isNew = (scene.updatedAt || 0) > sceneBannerDismissedAt;
  if (scene.active && isNew) {
    el.classList.add('show');
    document.getElementById('sceneBannerTitle').textContent = scene.title || '';
    document.getElementById('sceneBannerDesc').textContent = scene.desc || '';
    const img = document.getElementById('sceneBannerImg');
    if (scene.imageUrl) { img.src = scene.imageUrl; img.style.display = ''; } else { img.style.display = 'none'; img.src = ''; }
  } else {
    el.classList.remove('show');
  }
}
document.getElementById('btnSceneBannerClose').addEventListener('click', () => {
  sceneBannerDismissedAt = Date.now();
  localStorage.setItem('dnd_scene_dismissed_' + CODE, String(sceneBannerDismissedAt));
  document.getElementById('sceneBanner').classList.remove('show');
});
socket.on('scene-updated', (scene) => {
  storyState.scene = scene;
  if (scene.active) sceneBannerDismissedAt = 0; // adegan baru dari DM selalu tampil lagi
  renderSceneBanner();
  if (document.getElementById('tab-story').style.display !== 'none') renderStoryPlayer();
});

function renderDialogueBox() {
  const dlg = (storyState && storyState.dialogue) || {};
  const el = document.getElementById('dialogueBox'); if (!el) return;
  const isNew = (dlg.updatedAt || 0) > dialogueBoxDismissedAt;
  if (dlg.active && isNew) {
    el.classList.add('show');
    document.getElementById('dialogueNameEl').textContent = dlg.npcName || 'NPC';
    document.getElementById('dialogueTextEl').textContent = dlg.text || '';
    const img = document.getElementById('dialoguePortraitImg');
    if (dlg.npcPortrait) { img.src = dlg.npcPortrait; img.style.display = ''; } else { img.style.display = 'none'; img.src = ''; }
  } else {
    el.classList.remove('show');
  }
}
document.getElementById('btnDialogueClose').addEventListener('click', () => {
  dialogueBoxDismissedAt = Date.now();
  localStorage.setItem('dnd_dialogue_dismissed_' + CODE, String(dialogueBoxDismissedAt));
  document.getElementById('dialogueBox').classList.remove('show');
});
socket.on('dialogue-updated', (dialogue) => {
  storyState.dialogue = dialogue;
  if (dialogue.active) dialogueBoxDismissedAt = 0; // dialog baru dari DM selalu tampil lagi
  renderDialogueBox();
  if (document.getElementById('tab-story').style.display !== 'none') renderStoryPlayer();
});

function renderPlayerQuestList() {
  const box = document.getElementById('pQuestList'); if (!box) return;
  const quests = Object.values((storyState && storyState.quests) || {}).sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
  if (!quests.length) { box.innerHTML = '<p class="hint">Belum ada quest.</p>'; return; }
  box.innerHTML = quests.map(q => {
    const mine = (q.acceptedBy || {})[PLAYER_ID];
    let actionHtml;
    if (!mine) {
      actionHtml = `<button type="button" class="small quest-accept-btn" data-id="${q.id}" style="width:100%; margin-top:6px;">🙋 Ambil Quest</button>`;
    } else if (!mine.completed) {
      actionHtml = `<button type="button" class="small secondary quest-complete-btn" data-id="${q.id}" style="width:100%; margin-top:6px;">✅ Tandai Selesai</button>`;
    } else {
      actionHtml = `<p class="hint" style="margin-top:6px;">✅ Kamu sudah menandai quest ini selesai — menunggu konfirmasi DM.</p>`;
    }
    return `
    <div class="quest-card">
      <div class="quest-card-top">
        <span class="quest-card-title">${pEscapeHtml(q.title)}</span>
        <span class="quest-status-badge ${q.status}">${q.status === 'aktif' ? '🟡 Aktif' : q.status === 'selesai' ? '✅ Selesai' : '❌ Gagal'}</span>
      </div>
      ${q.desc ? `<div class="quest-card-desc">${pEscapeHtml(q.desc)}</div>` : ''}
      ${actionHtml}
    </div>`;
  }).join('');
  box.querySelectorAll('.quest-accept-btn').forEach(btn => {
    btn.onclick = () => socket.emit('player:quest-accept', { code: CODE, questId: btn.dataset.id }, (res) => {
      if (!res || !res.ok) alert((res && res.error) || 'Gagal ambil quest.');
    });
  });
  box.querySelectorAll('.quest-complete-btn').forEach(btn => {
    btn.onclick = () => socket.emit('player:quest-complete', { code: CODE, questId: btn.dataset.id }, (res) => {
      if (!res || !res.ok) alert((res && res.error) || 'Gagal menandai quest selesai.');
    });
  });
}
socket.on('quests-updated', (quests) => {
  storyState.quests = quests;
  renderPlayerQuestList();
  if (document.getElementById('tab-story').style.display !== 'none') renderStoryRecapPlayer();
});

const STORY_LOG_TYPES_P = ['narrative','scene','dialogue','quest','handout'];
function renderStoryRecapPlayer() {
  const box = document.getElementById('pStoryRecapList'); if (!box) return;
  const entries = diceLog.filter(e => STORY_LOG_TYPES_P.includes(e.type)).sort((a,b) => (a.ts||0)-(b.ts||0));
  if (!entries.length) { box.innerHTML = '<p class="hint">Belum ada momen cerita.</p>'; return; }
  box.innerHTML = entries.map(e => `
    <div class="story-recap-entry">
      <span class="from">${pEscapeHtml(e.from)}:</span> ${pEscapeHtml(e.text)}
      ${e.ts ? `<span class="ts">${new Date(e.ts).toLocaleString()}</span>` : ''}
    </div>`).join('');
}
function renderStoryPlayer() { renderPlayerQuestList(); renderStoryRecapPlayer(); }

// ---- Handout modal ----
function openHandoutModal(handout) {
  document.getElementById('handoutModalTitle').textContent = '🎁 ' + (handout.title || 'Dokumen');
  const img = document.getElementById('handoutModalImg');
  if (handout.imageUrl) { img.src = handout.imageUrl; img.style.display = ''; } else { img.style.display = 'none'; img.src = ''; }
  document.getElementById('handoutModalText').textContent = handout.text || '';
  document.getElementById('handoutModal').classList.add('show');
}
document.getElementById('btnHandoutModalClose').addEventListener('click', () => {
  document.getElementById('handoutModal').classList.remove('show');
});
socket.on('story:handout', (handout) => {
  openHandoutModal(handout);
  showToast('🎁 Kamu menerima dokumen: ' + (handout.title || ''));
});

const P_DICE_TYPES = [4,6,8,10,12,20,100];
document.getElementById('pDiceQuickRow').innerHTML = P_DICE_TYPES.map(d => `<button type="button" class="dice-btn" data-sides="${d}">d${d}</button>`).join('');
document.getElementById('pDiceQuickRow').querySelectorAll('.dice-btn').forEach(btn => {
  btn.addEventListener('click', () => rollAndSendP('1d' + btn.dataset.sides));
});

document.getElementById('btnPRollDice').addEventListener('click', () => { rollAndSendP(val('pDiceFormula').trim() || '1d20'); });
document.getElementById('btnPSendChat').addEventListener('click', sendPChat);
document.getElementById('pChatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendPChat(); });

const DICE_FORMULA_RE_P = /^\d*d\d+([+-]\d+)?$/i;
function sendPChat() {
  const input = document.getElementById('pChatInput');
  const text = input.value.trim(); if (!text) return;
  if (DICE_FORMULA_RE_P.test(text)) { rollAndSendP(text); }
  else {
    const from = val('f_nama_karakter') || NAME || 'Player';
    socket.emit('chat:send', { code: CODE, from, text, type: 'chat' });
  }
  input.value = '';
}

function rollAndSendP(formula) {
  const from = val('f_nama_karakter') || NAME || 'Player';
  const m = formula.match(/(\d*)d(\d+)([+-]\d+)?/i);
  let result = '?';
  if (m) {
    const n = parseInt(m[1]||'1',10), sides = parseInt(m[2],10), mod = parseInt(m[3]||'0',10);
    let total = mod; const rolls = [];
    for (let i = 0; i < n; i++) { const r = 1+Math.floor(Math.random()*sides); rolls.push(r); total+=r; }
    result = `${total} (${rolls.join('+')}${mod?(mod>0?'+'+mod:mod):''})`; 
  }
  socket.emit('chat:send', { code: CODE, from, text: `${formula} = ${result}`, type: 'roll' });
}

// =============================== MUSIK ==================================
socket.on('music-updated', (tracks) => { battleState.music.tracks = tracks; syncPlayerMusic(); renderPMusicList(); });
socket.on('music-state', (playback) => { battleState.music.playback = playback; syncPlayerMusic(); renderPMusicList(); });

function renderPMusicList() {
  const box = document.getElementById('pMusicList'); if (!box) return;
  const tracks = Object.values((battleState.music && battleState.music.tracks) || {});
  const pb = (battleState.music && battleState.music.playback) || {};
  if (!tracks.length) { box.innerHTML = '<p class="hint">Belum ada lagu.</p>'; return; }
  box.innerHTML = tracks.map(t => `
    <div class="music-item ${t.id===pb.trackId?'playing':''}" data-id="${t.id}">
      <span class="m-name">${t.id===pb.trackId&&pb.isPlaying?'▶ ':''}${pEscapeHtml(t.name)}${t.addedBy ? ` <span class="hint">(dari ${pEscapeHtml(t.addedBy)})</span>` : ''}</span>
      <button type="button" class="small p-music-play">Putar</button>
      ${t.addedBy === (NAME || '') ? '<button type="button" class="row-remove p-music-remove" title="Hapus lagumu">×</button>' : ''}
    </div>`).join('');
  box.querySelectorAll('.p-music-play').forEach(btn => {
    btn.onclick = () => socket.emit('player:music-play', { code: CODE, id: btn.closest('.music-item').dataset.id });
  });
  box.querySelectorAll('.p-music-remove').forEach(btn => {
    btn.onclick = () => socket.emit('player:music-remove', { code: CODE, id: btn.closest('.music-item').dataset.id });
  });
}
document.getElementById('btnPMusicAdd').addEventListener('click', () => {
  const url = document.getElementById('pMusicUrl').value.trim(); if (!url) return;
  const name = document.getElementById('pMusicName').value.trim() || 'Lagu dari URL';
  socket.emit('player:music-add', { code: CODE, name, url }, (res) => {
    if (!res || !res.ok) { alert((res && res.error) || 'Gagal nambah lagu.'); return; }
    document.getElementById('pMusicUrl').value = ''; document.getElementById('pMusicName').value = '';
  });
});

const playerMusicPlayer = document.getElementById('playerMusicPlayer');
let playerMusicUnlocked = false;
let pYtPlayer = null, pYtReady = false, pYtLoadedId = null;

window.onYouTubeIframeAPIReady = function () {
  pYtPlayer = new YT.Player('ytPlayer', {
    height: '1', width: '1',
    playerVars: { controls: 0, disablekb: 1, playsinline: 1 },
    events: {
      onReady: () => { pYtReady = true; syncPlayerMusic(); },
      onStateChange: (ev) => {
        if (ev.data === YT.PlayerState.ENDED) {
          const pb = (battleState.music && battleState.music.playback) || {};
          if (pb.loop) { pYtPlayer.seekTo(0,true); pYtPlayer.playVideo(); }
        }
      }
    }
  });
};

function syncPlayerMusic() {
  const pb = (battleState.music && battleState.music.playback) || {};
  const track = pb.trackId && battleState.music.tracks ? battleState.music.tracks[pb.trackId] : null;
  const barTrack = document.getElementById('musicBarTrack');
  if (barTrack) barTrack.textContent = track ? (pb.isPlaying ? '▶ ' : '⏸ ') + track.name : 'Tidak ada musik.';
  if (track && track.type === 'youtube') {
    playerMusicPlayer.pause(); playerMusicPlayer.removeAttribute('src'); playerMusicPlayer.dataset.trackId = '';
    if (!pYtReady || !pYtPlayer) return;
    if (pYtLoadedId !== track.videoId) { pYtLoadedId = track.videoId; if (pb.isPlaying) pYtPlayer.loadVideoById(track.videoId); else pYtPlayer.cueVideoById(track.videoId); }
    pYtPlayer.setVolume(Math.round((pb.volume??0.7)*100));
    if (pb.isPlaying) { const t=Math.max(0,(Date.now()-pb.startTs)/1000); if(typeof pYtPlayer.getCurrentTime==='function'&&Math.abs((pYtPlayer.getCurrentTime()||0)-t)>1.5) pYtPlayer.seekTo(t,true); pYtPlayer.playVideo(); }
    else { pYtPlayer.pauseVideo(); if(pb.position) pYtPlayer.seekTo(pb.position,true); }
    return;
  }
  if (pYtReady && pYtPlayer && pYtLoadedId) { pYtPlayer.stopVideo(); pYtLoadedId = null; }
  playerMusicPlayer.loop = !!pb.loop;
  playerMusicPlayer.volume = pb.volume ?? 0.7;
  if (!track) { playerMusicPlayer.pause(); playerMusicPlayer.removeAttribute('src'); return; }
  if (playerMusicPlayer.dataset.trackId !== pb.trackId) { playerMusicPlayer.src = track.url; playerMusicPlayer.dataset.trackId = pb.trackId; }
  if (pb.isPlaying) {
    const targetTime = Math.max(0,(Date.now()-pb.startTs)/1000);
    if (Math.abs((playerMusicPlayer.currentTime||0)-targetTime)>1.5) playerMusicPlayer.currentTime = targetTime;
    playerMusicPlayer.play().catch(()=>{});
  } else { playerMusicPlayer.pause(); playerMusicPlayer.currentTime = pb.position||0; }
}
document.addEventListener('click', () => { if (!playerMusicUnlocked) { playerMusicUnlocked=true; syncPlayerMusic(); } }, { once: true });
document.getElementById('btnMusicUnlock').addEventListener('click', () => { playerMusicUnlocked=true; syncPlayerMusic(); });
const volEl = document.getElementById('musicBarVolume');
if (volEl) volEl.addEventListener('input', e => { playerMusicPlayer.volume = parseFloat(e.target.value); });
const muteEl = document.getElementById('btnMusicMute');
if (muteEl) muteEl.addEventListener('click', () => { playerMusicPlayer.muted = !playerMusicPlayer.muted; muteEl.textContent = playerMusicPlayer.muted ? '🔇' : '🔊'; });

// Panggil sekali di akhir file — pastiin semua const (pMapWrap, pMapImg, dst) & fungsi
// yang dipakai di dalamnya udah kebentuk duluan (hindari temporal dead zone error
// yang bisa bikin seluruh script berhenti sebelum sempat konek socket).
initMapControls();

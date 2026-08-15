// server.js — DnD VTT + Character Sheet server
// Jalankan dengan: npm install && npm start
// Buka di browser: http://localhost:3000

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100mb, biar upload gambar map muat

const PORT = process.env.PORT || 3000;

// ---------- Supabase ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseFetch(method, endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Persistence via Supabase ----------

/** @type {Record<string, Session>} */
let sessions = {};

async function loadSessions() {
  try {
    const rows = await supabaseFetch('GET', 'sessions?select=code,data');
    sessions = {};
    (rows || []).forEach(row => {
      try {
        sessions[row.code] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      } catch (e) {}
    });
    console.log(`Loaded ${Object.keys(sessions).length} sesi dari Supabase.`);
  } catch (e) {
    console.error('Gagal load dari Supabase, mulai dari kosong.', e.message);
    sessions = {};
  }
}

async function saveSession(code) {
  const session = sessions[code];
  if (!session) return;
  try {
    await supabaseFetch('POST', 'sessions', { code, data: session });
  } catch (e) {
    console.error('Gagal simpan sesi ke Supabase:', e.message);
  }
}

async function deleteSession(code) {
  try {
    await supabaseFetch('DELETE', `sessions?code=eq.${code}`);
  } catch (e) {
    console.error('Gagal hapus sesi dari Supabase:', e.message);
  }
}

let saveTimeouts = {};
function saveSessionsDebounced(code) {
  // Kalau dipanggil tanpa code (legacy), simpan semua
  if (!code) {
    Object.keys(sessions).forEach(c => saveSessionsDebounced(c));
    return;
  }
  clearTimeout(saveTimeouts[code]);
  saveTimeouts[code] = setTimeout(() => saveSession(code), 300);
}

// Inisialisasi: load semua sesi dari Supabase lalu jalankan server
loadSessions().then(() => {
  Object.values(sessions).forEach(ensureSessionDefaults);
  server.listen(PORT, () => {
    console.log('========================================');
    console.log(`  DnD VTT server jalan di http://localhost:${PORT}`);
    console.log('  DM  -> http://localhost:' + PORT + '/dm.html');
    console.log('  Player -> http://localhost:' + PORT + '/');
    console.log('========================================');
  });
});

// ---------- Helpers ----------
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa karakter yg gampang ketuker
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (sessions[code]);
  return code;
}

function genId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

// ---------- Kelas (class) helpers ----------
function blankClassSkills() {
  return { active: [], passive: [], ultimate: [] };
}

// Migrasi/pastikan struktur data lama (sessions.json sebelum fitur kelas & gold) tetap jalan
function blankMusic() {
  return {
    tracks: {},
    playback: { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: 0.7, loop: false }
  };
}

// ---------- Story-telling: scene banner, dialog NPC, quest tracker ----------
function blankStory() {
  return {
    scene: { title: '', desc: '', imageUrl: null, active: false, updatedAt: 0 },
    dialogue: { npcName: '', npcPortrait: null, text: '', active: false, updatedAt: 0 },
    quests: {}
  };
}

// ---------- Survival: hunger & thirst ----------
function blankSurvival() {
  return { hunger: 100, hunger_max: 100, thirst: 100, thirst_max: 100 };
}

// Deteksi link YouTube (watch, youtu.be, shorts, embed) dan ambil video ID-nya.
function extractYoutubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function ensureSessionDefaults(session) {
  if (!session.classes) session.classes = {};
  if (!session.music) session.music = blankMusic();
  if (!session.music.playback) session.music.playback = blankMusic().playback;
  if (!session.shop) session.shop = { items: {} };
  if (!session.npcs) session.npcs = {};
  if (!session.story) session.story = blankStory();
  if (!session.story.scene) session.story.scene = blankStory().scene;
  if (!session.story.dialogue) session.story.dialogue = blankStory().dialogue;
  if (!session.story.quests) session.story.quests = {};
  // Migrasi quest lama (sebelum fitur "ambil quest") biar punya daftar player yang ambil/selesaikan
  Object.values(session.story.quests).forEach(q => { if (!q.acceptedBy) q.acceptedBy = {}; });
  // Migrasi peta lama (1 map + 1 dict token flat) -> banyak map, tiap map punya token & fog sendiri.
  // Biar bisa DM benar-benar bikin "Map 2", "Map 3" dst (mis. per lantai dungeon) tanpa numpuk token lintas map.
  if (!session.maps) {
    const legacyMap = session.map || {};
    const mainMap = newMap('Map 1');
    mainMap.id = 'main';
    Object.assign(mainMap, legacyMap);
    mainMap.tokens = session.tokens || {};
    if (!mainMap.fogRevealed) mainMap.fogRevealed = {};
    session.maps = { main: mainMap };
    session.activeMapId = 'main';
    delete session.map;
    delete session.tokens;
  }
  if (!session.maps[session.activeMapId]) session.activeMapId = Object.keys(session.maps)[0];
  Object.values(session.maps).forEach(m => {
    if (!m.tokens) m.tokens = {};
    if (!m.fogRevealed) m.fogRevealed = {};
  });
  Object.values(session.players || {}).forEach(ensurePlayerDefaults);
  return session;
}
// Bikin objek map baru (dipakai pas create-session & pas DM klik "+ Map Baru")
function newMap(name) {
  return {
    id: genId('map'), name: name || 'Map',
    imageUrl: null, width: null, height: null,
    gridSize: 50, gridVisible: true, offsetX: 0, offsetY: 0,
    fogVisible: false, fogRevealed: {}, tokens: {}
  };
}
function activeMap(session) { return session.maps[session.activeMapId]; }
// Daftar ringkas map buat kirim tab list ke client (gak perlu kirim semua token/fog tiap map sekaligus)
function mapTabList(session) {
  return Object.values(session.maps).map(m => ({ id: m.id, name: m.name }));
}
function ensurePlayerDefaults(player) {
  if (!Array.isArray(player.unlockedClasses)) player.unlockedClasses = [];
  if (!Array.isArray(player.sheet.companions)) player.sheet.companions = [];
  if (!Array.isArray(player.sheet.buffs)) player.sheet.buffs = [];
  // Migrate pet -> companion
  if (player.sheet.pet && player.sheet.pet.nama && !player.sheet.companions.length) {
    player.sheet.companions.push({
      nama: player.sheet.pet.nama, tipe: player.sheet.pet.tipe || '',
      level: player.sheet.pet.level || '', hp: player.sheet.pet.hp || '',
      hp_max: player.sheet.pet.hp || '', mp: player.sheet.pet.mp || '',
      mp_max: player.sheet.pet.mp || '', skill: player.sheet.pet.skill || '',
      catatan: player.sheet.pet.catatan || '', fromDM: false
    });
    delete player.sheet.pet;
  }
  // Skills migration: passive was 5 -> now 2
  if (player.sheet.skills && Array.isArray(player.sheet.skills.passive) && player.sheet.skills.passive.length > 2) {
    player.sheet.skills.passive = player.sheet.skills.passive.slice(0, 2);
  }
  // Inventory: cap slot dasar 10 + slot tambahan pemberian DM (data lama yang lebih banyak tetap dipertahankan,
  // tapi gak akan bisa nambah lagi dari sisi player kalau udah lewat cap - itu diatur di client + validasi update-sheet)
  if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
  if (typeof player.sheet.inv_extra_slots !== 'number') player.sheet.inv_extra_slots = parseInt(player.sheet.inv_extra_slots, 10) || 0;
  // Survival: lapar & haus (data lama sebelum fitur ini otomatis dikasih nilai penuh)
  if (!player.sheet.survival || typeof player.sheet.survival !== 'object') player.sheet.survival = blankSurvival();
  ['hunger','hunger_max','thirst','thirst_max'].forEach(k => {
    if (typeof player.sheet.survival[k] !== 'number' || isNaN(player.sheet.survival[k])) {
      player.sheet.survival[k] = blankSurvival()[k];
    }
  });
  return player;
}

const INV_BASE_SLOTS = 10;
function invMaxSlotsForPlayer(player) {
  return INV_BASE_SLOTS + (parseInt(player.sheet.inv_extra_slots, 10) || 0);
}

function blankSheet(name) {
  return {
    nama_karakter: name || '',
    kelas: '', ras: '', alignment: '', lv: '', exp: '', kelas_exp: '',
    ability: {
      str: { score: '', mod: '', save: '' },
      con: { score: '', mod: '', save: '' },
      dex: { score: '', mod: '', save: '' },
      cha: { score: '', mod: '', save: '' },
      wis: { score: '', mod: '', save: '' },
      int: { score: '', mod: '', save: '' }
    },
    ac: '', initiative: '',
    max_hp: '', current_hp: '', temp_hp: '',
    mp_max: '', mp_current: '', sp_max: '', sp_current: '',
    condition: [],
    condition_other: '',
    survival: blankSurvival(),
    death_count: [false, false, false],
    goal: '',
    equipment: [
      { nama: '', tipe: '', atk_bonus: '', damage: '', catatan: '' },
      { nama: '', tipe: '', atk_bonus: '', damage: '', catatan: '' }
    ],
    gears: ['helmet','armor','gloves','boots','accessory1','accessory2','necklace','artifact']
      .map(key => ({ key, item: '', stat: '', amount: '', equipped: false })),
    extra_weapon: [
      { nama: '', atk_bonus: '', damage: '' },
      { nama: '', atk_bonus: '', damage: '' }
    ],
    inventory: Array.from({ length: 6 }, () => ({ checked: false, item: '', desc: '', type: 'misc', qty: 1 })), // cap 10 slot di client, DM bisa kasih slot tambahan
    inv_extra_slots: 0, // slot tambahan yang dikasih DM (di atas 10 slot dasar)
    gold: '',
    companions: [],
    skills: {
      active: Array.from({ length: 5 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'damage', statusEffect: '', desc: '' })),
      passive: Array.from({ length: 2 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'buff', statusEffect: '', desc: '' })),
      ultimate: Array.from({ length: 2 }, () => ({ nama: '', rank: '', mp_cost: '', sp_cost: '', formula: '', action: 'ultimate', statusEffect: '', desc: '' }))
    },
    buffs: [],
    // race_trait sekarang array of {nama, stat, amount} — trait bawaan ras yang beneran ngefek ke
    // AC/HP/MP/SP/ATK/DEF (dihitung bareng gear & buff di client). Sheet lama (array of string,
    // sebelum fitur ini) otomatis dikonversi jadi {nama: string, stat:'', amount:''} di client.
    race_trait: Array.from({ length: 4 }, () => ({ nama: '', stat: '', amount: '' })),
    class_trait: { fire: '', ice: '', lightning: '', poison: '', dark: '', light: '', physical: '', magic: '' },
    catatan_lain: ''
  };
}

function sortedBattleList(session) {
  const entries = Object.values((session.battle && session.battle.entries) || {});
  return entries.sort((a, b) => {
    const rb = parseFloat(b.roll) || 0, ra = parseFloat(a.roll) || 0;
    if (rb !== ra) return rb - ra;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function battleAdvance(session, dir) {
  const list = sortedBattleList(session);
  if (!list.length) return;
  const turn = session.battle.turn;
  let idx = list.findIndex(e => e.id === turn.activeId);
  if (idx === -1) {
    // belum ada giliran aktif (atau entri sebelumnya sudah dihapus) -> mulai dari awal/akhir
    idx = dir > 0 ? -1 : list.length;
  }
  idx += dir;
  if (idx >= list.length) { idx = 0; turn.round += 1; }
  if (idx < 0) { idx = list.length - 1; turn.round = Math.max(1, turn.round - 1); }
  turn.activeId = list[idx].id;
}

function publicPlayerList(session) {
  return Object.values(session.players).map(p => ({
    id: p.id,
    name: p.name,
    online: !!p.socketId,
    nama_karakter: p.sheet.nama_karakter,
    kelas: p.sheet.kelas,
    lv: p.sheet.lv,
    current_hp: p.sheet.current_hp,
    max_hp: p.sheet.max_hp
  }));
}

function sessionStateForDM(session) {
  return {
    code: session.code,
    players: session.players,
    npcs: session.npcs,
    classes: session.classes || {},
    maps: mapTabList(session),
    activeMapId: session.activeMapId,
    map: activeMap(session),
    tokens: activeMap(session).tokens,
    battle: session.battle,
    music: session.music,
    story: session.story,
    shop: session.shop || { items: {} },
    log: session.log.slice(-100),
    notes: session.notes || ''
  };
}

function sessionStateForPlayer(session, playerId) {
  return {
    code: session.code,
    me: session.players[playerId],
    players: publicPlayerList(session),
    playersList: publicPlayerList(session),
    classes: session.classes || {},
    maps: mapTabList(session),
    activeMapId: session.activeMapId,
    map: activeMap(session),
    tokens: activeMap(session).tokens,
    battle: session.battle,
    music: session.music,
    story: session.story,
    shop: session.shop || { items: {} },
    log: session.log.filter(e => !e.secret).slice(-100)
  };
}

// ---------- Dice formula helper (dipakai server utk aksi roll battle) ----------
function rollFormulaServer(formula) {
  const str = String(formula || '').trim();
  const m = str.match(/(\d*)d(\d+)([+-]\d+)?/i);
  if (!m) {
    const flat = parseInt(str, 10);
    if (!isNaN(flat)) return { total: flat, detail: String(flat) };
    return { total: 0, detail: '0' };
  }
  const n = Math.min(100, parseInt(m[1] || '1', 10));
  const sides = parseInt(m[2], 10);
  const mod = parseInt(m[3] || '0', 10);
  let total = mod;
  const rolls = [];
  for (let i = 0; i < n; i++) { const r = 1 + Math.floor(Math.random() * sides); rolls.push(r); total += r; }
  return { total, detail: `${rolls.join('+')}${mod ? (mod > 0 ? '+' + mod : mod) : ''}` };
}

// Aksi roll battle: tiap actionType memetakan ke field mana di battle entry yang berubah
const BATTLE_ACTION_MAP = {
  damage:     { field: 'hp_current', sign: -1, maxField: 'hp_max' },
  ultimate:   { field: 'hp_current', sign: -1, maxField: 'hp_max' },
  heal:       { field: 'hp_current', sign: +1, maxField: 'hp_max' },
  mana_regen: { field: 'mp_current', sign: +1, maxField: 'mp_max' },
  sp_regen:   { field: 'sp_current', sign: +1, maxField: 'sp_max' },
  ac_buff:    { field: 'ac', sign: +1, maxField: null },
  ac_debuff:  { field: 'ac', sign: -1, maxField: null },
  buff:       null,
  debuff:     null
};
const BATTLE_ACTION_LABEL = {
  damage: 'Damage', ultimate: 'Ultimate', heal: 'Heal', buff: 'Buff', debuff: 'Debuff',
  mana_regen: 'Regen Mana', sp_regen: 'Regen SP', ac_buff: 'Buff AC', ac_debuff: 'Debuff AC'
};

// ---------- AoE targeting: targetId khusus "__aoe_enemy__" / "__aoe_ally__" / "__aoe_all__" ----------
// dikirim dari client kalau player/DM milih opsi "Semua Musuh/Sekutu" di dropdown target,
// jadi 1 skill/item/aksi otomatis kena ke banyak entry battle sekaligus (gak perlu diulang manual).
const AOE_GROUP_LABEL = { enemy: 'semua musuh', ally: 'semua sekutu', all: 'semua peserta' };
function aoeGroupFromTargetId(targetId) {
  if (typeof targetId !== 'string' || !targetId.startsWith('__aoe_')) return null;
  const group = targetId.slice('__aoe_'.length, targetId.length - 2); // buang prefix & '__' penutup
  return AOE_GROUP_LABEL[group] ? group : null;
}
function entryMatchesAoeGroup(entry, group) {
  if (group === 'enemy') return entry.type === 'enemy';
  if (group === 'ally') return entry.type === 'pc' || entry.type === 'ally';
  if (group === 'all') return true;
  return false;
}
// Balikin daftar id entry battle yang jadi sasaran (single id kalau bukan AoE, banyak id kalau AoE).
function resolveTargetIds(session, targetId) {
  const group = aoeGroupFromTargetId(targetId);
  if (group) {
    return Object.keys(session.battle.entries || {}).filter(id => entryMatchesAoeGroup(session.battle.entries[id], group));
  }
  return (session.battle.entries || {})[targetId] ? [targetId] : [];
}

// Jumlahkan modifier stat tertentu dari daftar buff/debuff sebuah sheet (mis. total DEF aktif).
function sumBuffStat(buffs, stat) {
  if (!Array.isArray(buffs)) return 0;
  let total = 0;
  buffs.forEach(b => {
    if (b && b.stat === stat) {
      const n = parseFloat(b.jumlah);
      if (!isNaN(n)) total += n;
    }
  });
  return total;
}

// Hitung nilai efek DOT dari field "jumlah", yang boleh diisi angka polos (mis. "5", "-3")
// ATAU formula dice (mis. "1d4+2", atau "-1d6" utk heal berbasis dice). Awalan "-" di depan
// formula dice berarti heal (dibalik jadi minus setelah dice-nya di-roll).
function resolveDotAmount(raw) {
  const str = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!str) return null;
  const isDice = /\d*d\d+/i.test(str);
  const isNegDice = isDice && str.startsWith('-');
  const roll = rollFormulaServer(isNegDice ? str.slice(1).trim() : str);
  const total = isNegDice ? -roll.total : roll.total;
  return { amount: total, detail: (isNegDice ? '-(' + roll.detail + ')' : roll.detail), isDice };
}

// Terapkan semua efek stat='dot' (Damage/Heal per Giliran) yang ada di sebuah daftar buff ke HP
// sebuah battle entry. Dipakai baik utk buff yang nempel di sheet player maupun buff yang nempel
// langsung di battle entry (NPC/ally/enemy), makanya nama/label log-nya diberi lewat parameter.
function applyDotBuffsToEntry(session, entry, buffs, displayName) {
  if (!entry || !Array.isArray(buffs) || !buffs.length) return;
  buffs.forEach(b => {
    if (!b) return;
    // DOT = damage per giliran (kurangi HP)
    if (b.stat === 'dot') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.hp_max);
      let next = (parseFloat(entry.hp_current) || 0) - amt;
      next = Math.max(0, next);
      if (!isNaN(max)) next = Math.min(next, max);
      entry.hp_current = next;
      const maxLabel = !isNaN(max) ? '/' + max : '';
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `☠ ${b.nama || 'DOT'} pada ${displayName}: HP berkurang ${amt} (${resolved.detail}) → HP jadi ${next}${maxLabel}.`,
        type: 'damage', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // HEAL DOT = regen HP per giliran (tambah HP)
    if (b.stat === 'heal_dot') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.hp_max);
      let next = (parseFloat(entry.hp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.hp_current = next;
      const maxLabel = !isNaN(max) ? '/' + max : '';
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `💚 ${b.nama || 'Heal OT'} pada ${displayName}: HP pulih ${amt} (${resolved.detail}) → HP jadi ${next}${maxLabel}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // MP regen per giliran
    if (b.stat === 'mp_regen') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.mp_max);
      let next = (parseFloat(entry.mp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.mp_current = next;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `🔵 ${b.nama || 'MP Regen'} pada ${displayName}: MP pulih ${amt} → MP jadi ${next}${!isNaN(max)?'/'+max:''}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
    // SP regen per giliran
    if (b.stat === 'sp_regen') {
      const resolved = resolveDotAmount(b.jumlah);
      if (!resolved || !resolved.amount) return;
      const amt = Math.abs(resolved.amount);
      const max = parseFloat(entry.sp_max);
      let next = (parseFloat(entry.sp_current) || 0) + amt;
      if (!isNaN(max)) next = Math.min(next, max);
      entry.sp_current = next;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `🟢 ${b.nama || 'SP Regen'} pada ${displayName}: SP pulih ${amt} → SP jadi ${next}${!isNaN(max)?'/'+max:''}.`,
        type: 'heal', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
  });
  // Sync ke sheet player jika entry adalah PC
  if (entry.refType === 'player' && session.players[entry.refId]) {
    const tp = session.players[entry.refId];
    tp.sheet.current_hp = entry.hp_current;
    tp.sheet.mp_current = entry.mp_current;
    tp.sheet.sp_current = entry.sp_current;
    if (tp.socketId) io.to(tp.socketId).emit('your-sheet-updated', { sheet: tp.sheet });
    io.to('dm-' + session.code).emit('sheet-updated', { playerId: tp.id, sheet: tp.sheet });
  }
}

// Setiap round battle maju/mundur, kurangi (atau kembalikan) "Sisa Giliran" tiap buff/debuff yang
// punya nilai itu diisi. Kalau sampai 0 (pas maju), efeknya otomatis dihapus & diumumkan di log.
// Efek dengan stat = 'dot' juga otomatis diterapkan tiap round maju — baik buff yang nempel di
// sheet player (mis. racun kena ke PC) MAUPUN buff yang nempel langsung di battle entry NPC/
// ally/enemy (mis. DM kasih "Terbakar" ke musuh langsung dari Battle Tracker).
function tickBuffDurations(session, delta) {
  if (!delta) return;
  if (delta > 0) {
    Object.values(session.players).forEach(p => {
      const entry = Object.values(session.battle.entries || {}).find(en => en.refType === 'player' && en.refId === p.id);
      if (entry) applyDotBuffsToEntry(session, entry, p.sheet && p.sheet.buffs, p.sheet.nama_karakter || p.name);
    });
    Object.values(session.battle.entries || {}).forEach(en => {
      if (en.refType === 'player') return; // sudah ditangani lewat sheet di atas
      applyDotBuffsToEntry(session, en, en.buffs, en.name);
    });
  }
  Object.values(session.battle.entries || {}).forEach(en => {
    if (en.refType === 'player' || !Array.isArray(en.buffs) || !en.buffs.length) return;
    const expired = [];
    const kept = en.buffs.filter(b => {
      if (!b || b.sisaTurn === undefined || b.sisaTurn === '' || b.sisaTurn === null) return true;
      const n = parseFloat(b.sisaTurn);
      if (isNaN(n)) return true;
      const next = n - delta;
      if (delta > 0 && next <= 0) { expired.push(b.nama || 'Efek'); return false; }
      b.sisaTurn = next;
      return true;
    });
    if (expired.length) {
      en.buffs = kept;
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `⏳ Buff/Debuff pada ${en.name}: ${expired.join(', ')} sudah berakhir.`,
        type: 'roll', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    } else {
      en.buffs = kept;
    }
  });
  Object.values(session.players).forEach(p => {
    const buffs = p.sheet && p.sheet.buffs;
    if (!Array.isArray(buffs) || !buffs.length) return;
    const expired = [];
    let changed = false;
    const kept = buffs.filter(b => {
      if (!b || b.sisaTurn === undefined || b.sisaTurn === '' || b.sisaTurn === null) return true;
      const n = parseFloat(b.sisaTurn);
      if (isNaN(n)) return true;
      const next = n - delta;
      if (delta > 0 && next <= 0) { expired.push(b.nama || 'Efek'); changed = true; return false; }
      if (next !== n) { b.sisaTurn = next; changed = true; }
      return true;
    });
    if (!changed) return;
    p.sheet.buffs = kept;
    io.to('dm-' + session.code).emit('sheet-updated', { playerId: p.id, sheet: p.sheet });
    if (p.socketId && expired.length) {
      io.to(p.socketId).emit('your-sheet-updated', { sheet: p.sheet, note: `⏳ Efek berakhir: ${expired.join(', ')}` });
    }
    if (expired.length) {
      const logEntry = {
        id: genId('log'), from: 'Sistem',
        text: `⏳ Buff/Debuff pada ${p.sheet.nama_karakter || p.name}: ${expired.join(', ')} sudah berakhir.`,
        type: 'roll', ts: Date.now(), secret: false
      };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + session.code).emit('chat:new', logEntry);
    }
  });
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {

  // === DM: buat sesi baru ===
  socket.on('dm:create-session', ({ dmName }, cb) => {
    const code = genCode();
    sessions[code] = {
      code,
      dmName: dmName || 'Dungeon Master',
      dmSocketId: socket.id,
      createdAt: Date.now(),
      players: {},
      npcs: {},
      classes: {},
      maps: { main: Object.assign(newMap('Map 1'), { id: 'main' }) },
      activeMapId: 'main',
      battle: { entries: {}, turn: { activeId: null, round: 1 } },
      music: blankMusic(),
      story: blankStory(),
      log: [],
      notes: ''
    };
    socket.join('room-' + code);
    socket.join('dm-' + code);
    socket.data.role = 'dm';
    socket.data.code = code;
    saveSessionsDebounced(code);
    cb && cb({ ok: true, code, state: sessionStateForDM(sessions[code]) });
  });

  // === DM: reconnect ke sesi yang sudah ada ===
  // Sekarang wajib isi nama DM juga (kayak login biasa: kode + nama), bukan cuma kode doang,
  // biar orang lain yang cuma nemu/nebak kode sesi gak bisa asal masuk jadi DM.
  socket.on('dm:rejoin-session', ({ code, dmName }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Kode sesi tidak ditemukan.' });
    const nameInput = (dmName || '').trim();
    if (!nameInput) return cb && cb({ ok: false, error: 'Isi nama DM dulu ya.' });
    if (nameInput.toLowerCase() !== (session.dmName || '').trim().toLowerCase()) {
      return cb && cb({ ok: false, error: 'Nama DM tidak cocok dengan sesi ini.' });
    }
    ensureSessionDefaults(session);
    session.dmSocketId = socket.id;
    socket.join('room-' + code);
    socket.join('dm-' + code);
    socket.data.role = 'dm';
    socket.data.code = code;
    cb && cb({ ok: true, code, state: sessionStateForDM(session) });
    socket.to('room-' + code).emit('dm:online', true);
  });

  // === Player: join / rejoin sesi ===
  socket.on('player:join-session', ({ code, name, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Kode sesi tidak ditemukan.' });
    ensureSessionDefaults(session);

    let player;
    if (playerId && session.players[playerId]) {
      player = session.players[playerId];
      player.socketId = socket.id;
      if (name) player.name = name;
    } else {
      const id = genId('p');
      player = { id, name: name || 'Player', socketId: socket.id, sheet: blankSheet(name), unlockedClasses: [] };
      session.players[id] = player;
    }
    socket.join('room-' + code);
    socket.data.role = 'player';
    socket.data.code = code;
    socket.data.playerId = player.id;

    saveSessionsDebounced(code);
    cb && cb({ ok: true, code, playerId: player.id, state: sessionStateForPlayer(session, player.id) });

    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('dm-' + code).emit('player-online', { id: player.id, online: true });
    // Broadcast online list to all players
    io.to('room-' + code).emit('players-list-update', publicPlayerList(session));
  });

  // === Player: update character sheet ===
  socket.on('player:update-sheet', ({ code, playerId, sheet }) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return;
    if (session.players[playerId].socketId !== socket.id) return; // hanya pemilik yang boleh update
    const existing = session.players[playerId];
    // inv_extra_slots murni kontrol DM — player gak boleh ubah dari sisi client, apapun yang dikirim diabaikan
    sheet.inv_extra_slots = existing.sheet.inv_extra_slots || 0;
    // Cap inventory ke slot maksimum (10 dasar + extra dari DM) biar gak bisa dibypass dari client
    if (Array.isArray(sheet.inventory)) {
      const maxSlots = INV_BASE_SLOTS + (parseInt(sheet.inv_extra_slots, 10) || 0);
      if (sheet.inventory.length > maxSlots) sheet.inventory = sheet.inventory.slice(0, maxSlots);
    }
    session.players[playerId].sheet = sheet;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));

    // Sinkronkan HP/MP/SP/AC ke entri battle milik player ini (kalau sedang ikut battle),
    // supaya daftar Battle & Giliran di layar DM dan semua player selalu menampilkan
    // angka terbaru dari sheet, bukan angka lama waktu pertama kali ditambahkan ke battle.
    let battleTouched = false;
    Object.values(session.battle.entries || {}).forEach(en => {
      if (en.refType === 'player' && en.refId === playerId) {
        en.hp_max = sheet.max_hp ?? en.hp_max;
        en.hp_current = sheet.current_hp ?? en.hp_current;
        en.mp_max = sheet.mp_max ?? en.mp_max;
        en.mp_current = sheet.mp_current ?? en.mp_current;
        en.sp_max = sheet.sp_max ?? en.sp_max;
        en.sp_current = sheet.sp_current ?? en.sp_current;
        en.ac = sheet.ac ?? en.ac;
        battleTouched = true;
      }
    });
    if (battleTouched) {
      saveSessionsDebounced(code);
      io.to('room-' + code).emit('battle-updated', session.battle);
    }
  });

  // === DM: minta sheet lengkap seorang player (untuk dibuka di panel DM) ===
  socket.on('dm:get-player-sheet', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false });
    ensurePlayerDefaults(session.players[playerId]);
    cb && cb({
      ok: true,
      sheet: session.players[playerId].sheet,
      name: session.players[playerId].name,
      unlockedClasses: session.players[playerId].unlockedClasses
    });
  });

  // === DM: beri item ke player (masuk ke inventory player, muncul real-time) ===
  socket.on('dm:give-item', ({ code, playerId, name, qty, desc }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const itemName = (name || '').trim();
    if (!itemName) return cb && cb({ ok: false, error: 'Nama item kosong.' });
    const q = parseInt(qty, 10) || 1;
    const player = session.players[playerId];
    if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
    player.sheet.inventory.push({
      checked: false, item: itemName, qty: q,
      desc: (desc || '').trim(), type: 'misc', fromDM: true
    });
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const label = q > 1 ? `${itemName} x${q}` : itemName;
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengirim item: ${label}` });
    }
    cb && cb({ ok: true });
  });

  // === DM: beri companion ke player ===
  socket.on('dm:give-companion', ({ code, playerId, companion }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    if (!Array.isArray(player.sheet.companions)) player.sheet.companions = [];
    const comp = {
      nama: companion.nama || '', tipe: companion.tipe || '',
      level: companion.level || '', hp: companion.hp || '',
      hp_max: companion.hp_max || '', mp: companion.mp || '',
      mp_max: companion.mp_max || '', skill: companion.skill || '',
      catatan: companion.catatan || '', fromDM: true
    };
    player.sheet.companions.push(comp);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', {
        sheet: player.sheet,
        note: `DM menambahkan companion: ${comp.nama}`
      });
    }
    cb && cb({ ok: true });
  });

  // === DM: hapus player (alias baru yang lebih eksplisit) ===
  socket.on('dm:remove-player', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    ensureSessionDefaults(session);
    const player = session.players[playerId];
    Object.values(session.maps || {}).forEach(m => {
      Object.keys(m.tokens || {}).forEach(tid => {
        if (m.tokens[tid].ownerId === playerId) delete m.tokens[tid];
      });
    });
    Object.keys(session.battle.entries || {}).forEach(eid => {
      const en = session.battle.entries[eid];
      if (en.refType === 'player' && en.refId === playerId) delete session.battle.entries[eid];
    });
    const kickedSocketId = player.socketId;
    delete session.players[playerId];
    saveSessionsDebounced(code);
    if (kickedSocketId) {
      io.to(kickedSocketId).emit('you-were-removed', { note: 'DM mengeluarkanmu dari sesi ini.' });
      io.sockets.sockets.get(kickedSocketId)?.leave('room-' + code);
    }
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });

  // === DM: atur Level / EXP / EXP Kelas seorang player (progres hanya boleh diubah DM) ===
  socket.on('dm:set-progress', ({ code, playerId, lv, exp, kelas_exp }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    if (lv !== undefined) player.sheet.lv = lv;
    if (exp !== undefined) player.sheet.exp = exp;
    if (kelas_exp !== undefined) player.sheet.kelas_exp = kelas_exp;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: 'DM memperbarui Level/EXP karaktermu.' });
    }
    cb && cb({ ok: true });
  });

  // === DM: hapus player dari sesi (permanen, alias lama) ===
  socket.on('dm:delete-player', ({ code, playerId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    ensureSessionDefaults(session);
    const player = session.players[playerId];

    Object.values(session.maps || {}).forEach(m => {
      Object.keys(m.tokens || {}).forEach(tid => {
        if (m.tokens[tid].ownerId === playerId) delete m.tokens[tid];
      });
    });
    Object.keys(session.battle.entries || {}).forEach(eid => {
      const en = session.battle.entries[eid];
      if (en.refType === 'player' && en.refId === playerId) delete session.battle.entries[eid];
    });

    const kickedSocketId = player.socketId;
    delete session.players[playerId];
    saveSessionsDebounced(code);

    if (kickedSocketId) {
      io.to(kickedSocketId).emit('you-were-removed', { note: 'DM mengeluarkanmu dari sesi ini.' });
      io.sockets.sockets.get(kickedSocketId)?.leave('room-' + code);
    }
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('tokens-updated', activeMap(session).tokens);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true });
  });

  // === DM: beri / atur Pet seorang player (nama, tipe, level, hp, mp, skill) ===
  socket.on('dm:set-pet', ({ code, playerId, pet }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    const p = pet || {};
    player.sheet.pet = {
      nama: p.nama || '', tipe: p.tipe || '', level: p.level || '',
      hp: p.hp || '', mp: p.mp || '', skill: p.skill || '', catatan: p.catatan || ''
    };
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const note = p.nama ? `DM memperbarui pet-mu: ${p.nama} (Lv.${p.level || '-'}).` : 'DM memperbarui data pet-mu.';
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note });
    }
    cb && cb({ ok: true, pet: player.sheet.pet });
  });

  // === DM: beri gold ke player (bisa juga negatif utk mengurangi) ===
  socket.on('dm:give-gold', ({ code, playerId, amount }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const add = parseInt(amount, 10);
    if (!add) return cb && cb({ ok: false, error: 'Jumlah gold tidak valid.' });
    const player = session.players[playerId];
    const current = parseInt(player.sheet.gold, 10) || 0;
    const updated = current + add;
    player.sheet.gold = String(updated);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      const note = add > 0 ? `DM memberi ${add} gold (total: ${updated}).` : `DM mengurangi ${Math.abs(add)} gold (total: ${updated}).`;
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note });
    }
    cb && cb({ ok: true, gold: updated });
  });

  // DM mengatur ulang gold ke angka pasti (berguna kalau player mengisi gold asal-asalan)
  socket.on('dm:set-gold', ({ code, playerId, amount }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const val = parseInt(amount, 10);
    if (isNaN(val) || val < 0) return cb && cb({ ok: false, error: 'Jumlah gold tidak valid.' });
    const player = session.players[playerId];
    player.sheet.gold = String(val);
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengatur ulang gold-mu menjadi ${val}.` });
    }
    cb && cb({ ok: true, gold: val });
  });

  // === DM: atur hunger/thirst satu player langsung ke angka pasti ===
  socket.on('dm:set-survival', ({ code, playerId, hunger, thirst }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    ensurePlayerDefaults(player);
    const s = player.sheet.survival;
    if (hunger !== undefined && hunger !== null && hunger !== '') {
      s.hunger = Math.max(0, Math.min(s.hunger_max || 100, parseInt(hunger, 10) || 0));
    }
    if (thirst !== undefined && thirst !== null && thirst !== '') {
      s.thirst = Math.max(0, Math.min(s.thirst_max || 100, parseInt(thirst, 10) || 0));
    }
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', { sheet: player.sheet, note: `DM mengatur ulang lapar/haus-mu.` });
    }
    cb && cb({ ok: true, survival: s });
  });

  // === DM: "waktu berlalu" — lapar & haus semua player berkurang sekaligus (default -10) ===
  socket.on('dm:survival-tick', ({ code, hungerDelta, thirstDelta }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return cb && cb({ ok: false });
    const hd = Number.isFinite(parseInt(hungerDelta, 10)) ? parseInt(hungerDelta, 10) : -10;
    const td = Number.isFinite(parseInt(thirstDelta, 10)) ? parseInt(thirstDelta, 10) : -10;
    Object.values(session.players).forEach(p => {
      ensurePlayerDefaults(p);
      const s = p.sheet.survival;
      s.hunger = Math.max(0, Math.min(s.hunger_max || 100, s.hunger + hd));
      s.thirst = Math.max(0, Math.min(s.thirst_max || 100, s.thirst + td));
      io.to('dm-' + code).emit('sheet-updated', { playerId: p.id, sheet: p.sheet });
      if (p.socketId) io.to(p.socketId).emit('your-sheet-updated', { sheet: p.sheet, note: `⏳ Waktu berlalu — kamu jadi lebih lapar & haus.` });
    });
    saveSessionsDebounced(code);
    const logEntry = { id: genId('log'), from: 'Waktu', text: `⏳ Waktu berlalu — semua karakter jadi lebih lapar & haus.`, type: 'narrative', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === DM: kasih slot inventory tambahan ke player (di atas 10 slot dasar) ===
  socket.on('dm:set-inv-slots', ({ code, playerId, extraSlots }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const val = parseInt(extraSlots, 10);
    if (isNaN(val) || val < 0) return cb && cb({ ok: false, error: 'Jumlah slot tidak valid.' });
    const player = session.players[playerId];
    player.sheet.inv_extra_slots = val;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    if (player.socketId) {
      io.to(player.socketId).emit('your-sheet-updated', {
        sheet: player.sheet,
        note: `DM memberi ${val} slot inventory tambahan (total: ${INV_BASE_SLOTS + val} slot).`
      });
    }
    cb && cb({ ok: true, inv_extra_slots: val, totalSlots: INV_BASE_SLOTS + val });
  });

  // === Player: beli item dari Shop — potong gold, isi ke inventory, kurangi stok kalau terbatas ===
  socket.on('player:buy-item', ({ code, playerId, itemId, qty }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (session.players[playerId].socketId !== socket.id) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    ensureSessionDefaults(session);
    const item = session.shop.items[itemId];
    if (!item) return cb && cb({ ok: false, error: 'Item tidak ditemukan di toko.' });

    const buyQty = Math.max(1, parseInt(qty, 10) || 1);
    const price = parseFloat(item.harga) || 0;
    const totalPrice = price * buyQty;

    const player = session.players[playerId];
    const currentGold = parseFloat(player.sheet.gold) || 0;
    if (currentGold < totalPrice) return cb && cb({ ok: false, error: 'Gold tidak cukup.' });

    // Cek & potong stok kalau item ini stoknya terbatas (bukan '~' / kosong)
    let stokLimited = false, stokNum = null;
    if (item.stok !== '' && item.stok != null && !isNaN(parseInt(item.stok, 10))) {
      stokLimited = true; stokNum = parseInt(item.stok, 10);
      if (stokNum < buyQty) return cb && cb({ ok: false, error: 'Stok tidak cukup.' });
    }

    if (!Array.isArray(player.sheet.inventory)) player.sheet.inventory = [];
    const maxSlots = invMaxSlotsForPlayer(player);
    // Tumpuk ke slot yang sudah ada (item sama, dari shop, belum dipakai) kalau ada, biar gak makan slot baru terus
    let existing = player.sheet.inventory.find(it => it.item === item.nama && it.fromShop && !it.checked);
    if (existing) {
      existing.qty = (parseInt(existing.qty, 10) || 1) + buyQty;
      // Sinkronkan efek terbaru dari katalog toko, siapa tahu DM update efeknya setelah item ini pernah dibeli
      existing.type = item.efekTipe || 'misc';
      existing.formula = item.efekFormula || '';
      existing.aoe = !!item.aoe;
    } else {
      if (player.sheet.inventory.length >= maxSlots) {
        return cb && cb({ ok: false, error: `Inventory penuh (maks ${maxSlots} slot). Kosongkan slot dulu atau minta DM tambah slot.` });
      }
      // Efek (tipe + formula dadu + AoE) ikut kebawa otomatis dari katalog toko ke inventory,
      // jadi begitu dibeli item langsung bisa "⚡ Pakai" di battle tanpa diketik ulang.
      player.sheet.inventory.push({
        checked: false, item: item.nama, desc: item.deskripsi || '',
        type: item.efekTipe || 'misc', formula: item.efekFormula || '', aoe: !!item.aoe,
        qty: buyQty, fromShop: true
      });
    }

    if (stokLimited) { item.stok = stokNum - buyQty; }
    player.sheet.gold = String(currentGold - totalPrice);

    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    io.to('room-' + code).emit('shop-updated', session.shop.items);

    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: `🛒 ${player.sheet.nama_karakter || player.name} membeli ${item.nama}${buyQty > 1 ? ' x' + buyQty : ''} seharga ${totalPrice} gold.`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);

    cb && cb({ ok: true, sheet: player.sheet });
  });

  // === DM: kelola katalog Kelas sesi (CRUD) ===
  socket.on('dm:save-class', ({ code, kelas }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!kelas || !(kelas.nama || '').trim()) return cb && cb({ ok: false, error: 'Nama kelas kosong.' });
    if (!kelas.id) kelas.id = genId('cls');
    session.classes[kelas.id] = {
      id: kelas.id,
      nama: kelas.nama || '',
      exp_req: kelas.exp_req || '',
      deskripsi: kelas.deskripsi || '',
      // Skills dikosongkan — player isi sendiri di sheet mereka
      skills: { active: [], passive: [], ultimate: [] }
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('classes-update', session.classes);
    cb && cb({ ok: true, kelas: session.classes[kelas.id] });
  });

  socket.on('dm:delete-class', ({ code, classId }) => {
    const session = sessions[code];
    if (!session || !session.classes) return;
    delete session.classes[classId];
    // Lepas kelas ini dari daftar kelas terbuka semua player
    Object.values(session.players).forEach(p => {
      ensurePlayerDefaults(p);
      p.unlockedClasses = p.unlockedClasses.filter(id => id !== classId);
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('classes-update', session.classes);
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
  });

  // === DM: buka ("rank up") kelas tertentu utk seorang player ===
  socket.on('dm:set-unlocked-classes', ({ code, playerId, classIds }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    const player = session.players[playerId];
    const valid = Array.isArray(classIds) ? classIds.filter(id => session.classes && session.classes[id]) : [];
    player.unlockedClasses = valid;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    if (player.socketId) {
      io.to(player.socketId).emit('your-classes-updated', {
        unlockedClasses: player.unlockedClasses,
        note: 'DM membuka kelas baru untukmu — cek panel Kelas di sheet-mu.'
      });
    }
    cb && cb({ ok: true, unlockedClasses: player.unlockedClasses });
  });

  // === Player: pilih / ganti kelas dari daftar kelas yang sudah dibuka DM ===
  socket.on('player:change-class', ({ code, playerId, classId }, cb) => {
    const session = sessions[code];
    if (!session || !session.players[playerId]) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (session.players[playerId].socketId !== socket.id) return cb && cb({ ok: false, error: 'Tidak diizinkan.' });
    ensurePlayerDefaults(session.players[playerId]);
    const player = session.players[playerId];
    const kelas = session.classes && session.classes[classId];
    if (!kelas) return cb && cb({ ok: false, error: 'Kelas tidak ditemukan.' });
    if (!player.unlockedClasses.includes(classId)) return cb && cb({ ok: false, error: 'Kelas ini belum dibuka DM untukmu.' });

    player.sheet.kelas = kelas.nama;
    player.sheet.skills = JSON.parse(JSON.stringify(kelas.skills || blankClassSkills()));
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('sheet-updated', { playerId, sheet: player.sheet });
    io.to('dm-' + code).emit('players-update', publicPlayerList(session));
    cb && cb({ ok: true, sheet: player.sheet });
  });

  // === DM: catatan sesi (biar tidak lupa apa yang terjadi) ===
  socket.on('dm:update-notes', ({ code, notes }) => {
    const session = sessions[code];
    if (!session) return;
    session.notes = notes || '';
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('notes-updated', session.notes);
  });

  // Alias baru dari dm.js v2
  socket.on('dm:save-notes', ({ code, notes }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    session.notes = notes || '';
    saveSessionsDebounced(code);
    cb && cb({ ok: true });
  });

  // === DM: broadcast player list ke semua player (untuk online indicator) ===
  socket.on('dm:broadcast-players-list', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    io.to('room-' + code).emit('players-list-update', publicPlayerList(session));
  });

  // === DM: NPC CRUD ===
  socket.on('dm:save-npc', ({ code, npc }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (!npc.id) npc.id = genId('npc');
    session.npcs[npc.id] = npc;
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('npcs-update', session.npcs);
    cb && cb({ ok: true, npc });
  });

  socket.on('dm:delete-npc', ({ code, npcId }) => {
    const session = sessions[code];
    if (!session) return;
    delete session.npcs[npcId];
    saveSessionsDebounced(code);
    io.to('dm-' + code).emit('npcs-update', session.npcs);
  });

  // === DM: update map (gambar + grid) — selalu ke map yang lagi aktif/dibuka DM ===
  socket.on('dm:update-map', ({ code, imageUrl, width, height }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    map.imageUrl = imageUrl;
    map.width = width;
    map.height = height;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  socket.on('dm:update-grid', ({ code, gridSize, gridVisible, offsetX, offsetY, fogVisible }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (gridSize != null) map.gridSize = gridSize;
    if (gridVisible != null) map.gridVisible = gridVisible;
    if (fogVisible != null) map.fogVisible = fogVisible;
    if (offsetX != null) map.offsetX = offsetX;
    if (offsetY != null) map.offsetY = offsetY;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  // Fog of war: DM klik/drag buat "menghapus" (reveal) atau menutup lagi sel kabut di map
  socket.on('dm:fog-paint', ({ code, cells, reveal }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.fogRevealed) map.fogRevealed = {};
    (cells || []).forEach(key => {
      if (reveal) map.fogRevealed[key] = 1;
      else delete map.fogRevealed[key];
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  socket.on('dm:fog-reset', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    map.fogRevealed = {};
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('map-updated', map);
  });

  // === DM: kelola banyak map (tab) — bikin baru, pindah tab aktif, hapus tab ===
  socket.on('dm:map-add', ({ code, name }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const existingCount = Object.keys(session.maps).length;
    const map = newMap(name || `Map ${existingCount + 1}`);
    session.maps[map.id] = map;
    session.activeMapId = map.id;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true, mapId: map.id });
  });

  socket.on('dm:map-switch', ({ code, mapId }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!session.maps[mapId]) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    session.activeMapId = mapId;
    saveSessionsDebounced(code);
    const map = activeMap(session);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true });
  });

  socket.on('dm:map-rename', ({ code, mapId, name }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const map = session.maps[mapId];
    if (!map) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    map.name = (name || '').trim() || map.name;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    cb && cb({ ok: true });
  });

  socket.on('dm:map-delete', ({ code, mapId }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const ids = Object.keys(session.maps);
    if (ids.length <= 1) return cb && cb({ ok: false, error: 'Minimal harus ada 1 map.' });
    if (!session.maps[mapId]) return cb && cb({ ok: false, error: 'Map tidak ditemukan.' });
    delete session.maps[mapId];
    if (session.activeMapId === mapId) session.activeMapId = Object.keys(session.maps)[0];
    saveSessionsDebounced(code);
    const map = activeMap(session);
    io.to('room-' + code).emit('maps-updated', { maps: mapTabList(session), activeMapId: session.activeMapId });
    io.to('room-' + code).emit('map-updated', map);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
    cb && cb({ ok: true });
  });

  // === Token (dipakai DM & Player, dengan pengecekan kepemilikan sederhana) — selalu di map aktif ===
  socket.on('token:add', ({ code, token }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    token.id = token.id || genId('tok');
    map.tokens[token.id] = token;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:move', ({ code, tokenId, x, y }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.tokens[tokenId]) return;
    const tok = map.tokens[tokenId];
    // Player hanya boleh gerakkan token miliknya sendiri; DM boleh gerakkan semua
    if (socket.data.role === 'player' && tok.ownerId !== socket.data.playerId) return;
    tok.x = x; tok.y = y;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:update', ({ code, tokenId, patch }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    if (!map.tokens[tokenId]) return;
    Object.assign(map.tokens[tokenId], patch);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  socket.on('token:remove', ({ code, tokenId }) => {
    const session = sessions[code];
    if (!session) return;
    ensureSessionDefaults(session);
    const map = activeMap(session);
    delete map.tokens[tokenId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('tokens-updated', map.tokens);
  });

  // === Battle & Turn (allies / PC / enemy, digerakkan initiative) ===
  socket.on('dm:battle-add', ({ code, entry }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    const id = genId('bt');
    session.battle.entries[id] = {
      id,
      name: entry.name || 'Tanpa Nama',
      type: entry.type || 'ally', // 'pc' | 'ally' | 'enemy'
      roll: entry.roll ?? 0,
      hp_max: entry.hp_max ?? '',
      hp_current: entry.hp_current ?? entry.hp_max ?? '',
      mp_max: entry.mp_max ?? '',
      mp_current: entry.mp_current ?? entry.mp_max ?? '',
      sp_max: entry.sp_max ?? '',
      sp_current: entry.sp_current ?? entry.sp_max ?? '',
      ac: entry.ac ?? '',
      refType: entry.refType || null, // 'player' | 'npc' | null
      refId: entry.refId || null,
      elements: entry.elements || {}, // elemental atribut (dari class_trait NPC)
      conditions: [], // status conditions aktif
      buffs: Array.isArray(entry.buffs) ? entry.buffs : [] // DOT/HEAL/buff untuk NPC/ally/enemy
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    cb && cb({ ok: true, id });
  });

  socket.on('dm:battle-update', ({ code, id, patch }) => {
    const session = sessions[code];
    if (!session || !session.battle.entries[id]) return;
    Object.assign(session.battle.entries[id], patch);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session) return;
    delete session.battle.entries[id];
    if (session.battle.turn.activeId === id) session.battle.turn.activeId = null;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-clear', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    session.battle = { entries: {}, turn: { activeId: null, round: 1 } };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-next', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const roundBefore = session.battle.turn.round;
    battleAdvance(session, 1);
    tickBuffDurations(session, session.battle.turn.round - roundBefore);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  socket.on('dm:battle-prev', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const roundBefore = session.battle.turn.round;
    battleAdvance(session, -1);
    tickBuffDurations(session, session.battle.turn.round - roundBefore);
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
  });

  // === Aksi Roll Battle (dmg/heal/buff/debuff/ultimate/regen mana/regen sp/ac) ===
  // Dipakai player maupun DM. Mendukung elemental modifier dari class_trait actor
  // dan elemental resistance target. Juga heal overtime (heal_dot) dari buff entry.
  // Terapkan 1 aksi (damage/heal/buff/dll) ke 1 entry battle. Dipakai baik utk single target
  // maupun dipanggil berulang per-entry pas AoE. Gak ngirim socket event apa pun di sini —
  // biar caller yang atur emit-nya sekali aja setelah semua target selesai diproses.
  function applyActionToEntry(session, code, entry, { actionType, formula, actor, note, elementType, elemBonus }) {
    const map = BATTLE_ACTION_MAP[actionType];
    const roll = rollFormulaServer(formula);
    const label = BATTLE_ACTION_LABEL[actionType] || actionType;
    const noteSuffix = note ? ' — ' + note : '';

    let elemModifier = 0;
    let elemNote = '';
    if (elementType && (actionType === 'damage' || actionType === 'ultimate')) {
      const actorElemPct = parseFloat(elemBonus) || 0;
      let targetElemPct = 0;
      if (entry.refType === 'player' && session.players[entry.refId]) {
        const ct = session.players[entry.refId].sheet.class_trait || {};
        targetElemPct = parseFloat(ct[elementType]) || 0;
      } else if (entry.elements) {
        targetElemPct = parseFloat(entry.elements[elementType]) || 0;
      }
      const netPct = actorElemPct - targetElemPct;
      elemModifier = Math.round(roll.total * netPct / 100);
      if (netPct !== 0) {
        elemNote = ` [${elementType} ${netPct > 0 ? '+' : ''}${netPct}% = ${elemModifier > 0 ? '+' : ''}${elemModifier}]`;
      }
    }

    let defReduction = 0;
    if ((actionType === 'damage' || actionType === 'ultimate') && entry.refType === 'player') {
      const targetPlayer = session.players[entry.refId];
      const defTotal = targetPlayer ? sumBuffStat(targetPlayer.sheet && targetPlayer.sheet.buffs, 'def') : 0;
      if (defTotal) defReduction = Math.max(0, Math.min(roll.total + elemModifier, defTotal));
    }
    const effectiveTotal = Math.max(0, roll.total + elemModifier - defReduction);
    const defNote = defReduction ? ` (DEF -${defReduction})` : '';

    let resultText, logType = 'roll', next = null;
    if (map) {
      const cur = parseFloat(entry[map.field]) || 0;
      next = cur + map.sign * effectiveTotal;
      if (map.maxField) {
        const max = parseFloat(entry[map.maxField]);
        if (!isNaN(max)) next = Math.min(next, max);
      }
      next = Math.max(0, next);
      entry[map.field] = next;

      if (entry.refType === 'player' && session.players[entry.refId]) {
        const tp = session.players[entry.refId];
        const fieldMap = {
          hp_current: 'current_hp', mp_current: 'mp_current', sp_current: 'sp_current',
          hp_max: 'max_hp', mp_max: 'mp_max', sp_max: 'sp_max', ac: 'ac'
        };
        if (fieldMap[map.field]) {
          tp.sheet[fieldMap[map.field]] = next;
          if (tp.socketId) io.to(tp.socketId).emit('your-sheet-updated', { sheet: tp.sheet });
          io.to('dm-' + code).emit('sheet-updated', { playerId: tp.id, sheet: tp.sheet });
        }
      }

      const maxLabel = map.maxField && entry[map.maxField] !== '' ? '/' + entry[map.maxField] : '';
      resultText = `${actor} pakai ${label} ke ${entry.name}: ${formula || '-'} = ${roll.total} (${roll.detail})${elemNote}${defNote} → ${entry.name} jadi ${next}${maxLabel}${noteSuffix}`;
      logType = (actionType === 'damage' || actionType === 'ultimate') ? 'damage' : (actionType === 'heal' ? 'heal' : 'roll');
    } else {
      resultText = `${actor} pakai ${label} ke ${entry.name}: ${formula || '-'} = ${roll.total} (${roll.detail})${noteSuffix}`;
    }

    return { entryId: entry.id, entryName: entry.name, resultText, logType, next, roll: { ...roll, total: effectiveTotal } };
  }

  socket.on('battle:roll-action', ({ code, targetId, actionType, formula, actorName, note, elementType, elemBonus }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const targetIds = resolveTargetIds(session, targetId);
    if (!targetIds.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan (AoE: belum ada peserta yang cocok).' });
    const aoeGroup = aoeGroupFromTargetId(targetId);
    const actor = actorName || (socket.data.role === 'dm' ? 'DM' : 'Player');

    const results = targetIds
      .map(tid => session.battle.entries[tid])
      .filter(Boolean)
      .map(entry => applyActionToEntry(session, code, entry, { actionType, formula, actor, note, elementType, elemBonus }));
    if (!results.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan.' });

    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);

    let logEntry;
    if (aoeGroup) {
      const label = BATTLE_ACTION_LABEL[actionType] || actionType;
      const noteSuffix = note ? ' — ' + note : '';
      const summary = results.map(r => `${r.entryName}: ${r.roll.total}${r.next != null ? ` → ${r.next}` : ''}`).join(' | ');
      const logType = results.some(r => r.logType === 'damage') ? 'damage' : (results.some(r => r.logType === 'heal') ? 'heal' : 'roll');
      logEntry = {
        id: genId('log'), from: actor,
        text: `💥 ${actor} pakai ${label} (AoE ke ${AOE_GROUP_LABEL[aoeGroup]}): ${formula || '-'}${noteSuffix} → ${summary}`,
        type: logType, ts: Date.now(), secret: false
      };
    } else {
      logEntry = { id: genId('log'), from: actor, text: results[0].resultText, type: results[0].logType, ts: Date.now(), secret: false };
    }
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);

    cb && cb({
      ok: true,
      aoe: !!aoeGroup,
      results: results.map(r => ({ entryId: r.entryId, entryName: r.entryName, roll: r.roll, next: r.next })),
      entry: session.battle.entries[targetIds[0]],
      roll: results[0].roll
    });
  });

  // === Apply status condition ke target battle (support AoE ke banyak entry sekaligus) ===
  socket.on('battle:apply-status', ({ code, targetId, condition, actorName }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false, error: 'Sesi tidak ditemukan.' });
    const targetIds = resolveTargetIds(session, targetId);
    if (!targetIds.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan (AoE: belum ada peserta yang cocok).' });
    const aoeGroup = aoeGroupFromTargetId(targetId);
    const actor = actorName || (socket.data.role === 'dm' ? 'DM' : 'Player');
    const condText = condition === 'Normal' ? 'kondisi dihapus (Normal)' : `terkena ${condition}`;

    const affectedNames = [];
    targetIds.forEach(tid => {
      const entry = session.battle.entries[tid];
      if (!entry) return;
      if (!Array.isArray(entry.conditions)) entry.conditions = [];

      if (condition === 'Normal') {
        entry.conditions = [];
      } else if (!entry.conditions.includes(condition)) {
        entry.conditions.push(condition);
      }
      affectedNames.push(entry.name);

      if (entry.refType === 'player' && session.players[entry.refId]) {
        const tp = session.players[entry.refId];
        if (tp.socketId) io.to(tp.socketId).emit('battle-apply-status', { targetId: tid, condition });
      }
    });
    if (!affectedNames.length) return cb && cb({ ok: false, error: 'Target tidak ditemukan.' });

    const logEntry = {
      id: genId('log'), from: 'Sistem',
      text: aoeGroup
        ? `⚡ ${actor} menerapkan status ke ${AOE_GROUP_LABEL[aoeGroup]} (${affectedNames.join(', ')}): ${condText}.`
        : `⚡ ${actor} menerapkan status: ${affectedNames[0]} ${condText}.`,
      type: 'system', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();

    saveSessionsDebounced(code);
    io.to('room-' + code).emit('battle-updated', session.battle);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true, aoe: !!aoeGroup, affected: affectedNames });
  });

  // === DM: kelola katalog Shop Item (CRUD + import Excel/JSON bulk) ===
  socket.on('dm:shop-save-item', ({ code, item }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!item || !(item.nama || '').trim()) return cb && cb({ ok: false, error: 'Nama item kosong.' });
    const id = item.id || genId('shop');
    session.shop.items[id] = {
      id, nama: item.nama || '', harga: item.harga ?? 0, tipe: item.tipe || '',
      stok: item.stok ?? '', deskripsi: item.deskripsi || '',
      // Efek item (heal/damage/buff/dll + formula dadu) — dibawa otomatis ke inventory pas player beli,
      // jadi gak perlu diketik ulang manual tiap mau dipakai. aoe: true = otomatis kena ke semua musuh/sekutu.
      efekTipe: item.efekTipe || 'misc', efekFormula: item.efekFormula || '', aoe: !!item.aoe
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
    cb && cb({ ok: true, item: session.shop.items[id] });
  });

  socket.on('dm:shop-delete-item', ({ code, itemId }) => {
    const session = sessions[code];
    if (!session || !session.shop) return;
    delete session.shop.items[itemId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
  });

  // Import massal dari Excel (parsed jadi array of object di client via SheetJS)
  socket.on('dm:shop-import', ({ code, items }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    let count = 0;
    (items || []).forEach(it => {
      const nama = (it.nama || '').trim();
      if (!nama) return;
      const id = genId('shop');
      session.shop.items[id] = {
        id, nama, harga: it.harga ?? 0, tipe: it.tipe || '',
        stok: it.stok ?? '', deskripsi: it.deskripsi || '',
        efekTipe: it.efekTipe || it.efek_tipe || 'misc', efekFormula: it.efekFormula || it.efek_formula || '',
        aoe: !!(it.aoe === true || it.aoe === 'true' || it.aoe === 1 || it.aoe === '1')
      };
      count++;
    });
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
    cb && cb({ ok: true, count });
  });

  socket.on('dm:shop-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.shop) return;
    session.shop.items = {};
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('shop-updated', session.shop.items);
  });

  // === Musik (DM upload/URL/YouTube, play/pause/stop tersinkron ke semua player) ===
  socket.on('dm:music-add', ({ code, name, url }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!url) return cb && cb({ ok: false, error: 'URL/file kosong.' });
    const id = genId('mu');
    const ytId = extractYoutubeId(url);
    session.music.tracks[id] = ytId
      ? { id, name: name || 'Tanpa Judul', url, type: 'youtube', videoId: ytId, addedAt: Date.now() }
      : { id, name: name || 'Tanpa Judul', url, type: 'audio', addedAt: Date.now() };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
    cb && cb({ ok: true, id });
  });

  socket.on('dm:music-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session || !session.music.tracks[id]) return;
    delete session.music.tracks[id];
    if (session.music.playback.trackId === id) {
      session.music.playback = { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: session.music.playback.volume, loop: session.music.playback.loop };
      io.to('room-' + code).emit('music-state', session.music.playback);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
  });

  // === Player: nambahin lagu ke playlist bareng (cuma link YouTube, biar gak numpuk file base64 dari banyak orang) ===
  socket.on('player:music-add', ({ code, name, url }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!url) return cb && cb({ ok: false, error: 'Link kosong.' });
    const ytId = extractYoutubeId(url);
    if (!ytId) return cb && cb({ ok: false, error: 'Cuma link YouTube yang didukung ya.' });
    const player = session.players[socket.data.playerId];
    if (!player) return cb && cb({ ok: false });
    const id = genId('mu');
    session.music.tracks[id] = {
      id, name: (name || '').trim() || 'Tanpa Judul', url, type: 'youtube', videoId: ytId,
      addedAt: Date.now(), addedBy: player.name
    };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
    const logEntry = { id: genId('log'), from: 'Musik', text: `🎵 ${player.name} menambahkan lagu: ${session.music.tracks[id].name}`, type: 'narrative', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true, id });
  });

  // === Player: hapus lagu yang dia sendiri tambahkan ===
  socket.on('player:music-remove', ({ code, id }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return;
    const track = session.music.tracks[id];
    if (!track) return;
    const player = session.players[socket.data.playerId];
    if (!player || track.addedBy !== player.name) return; // cuma boleh hapus punya sendiri
    delete session.music.tracks[id];
    if (session.music.playback.trackId === id) {
      session.music.playback = { trackId: null, isPlaying: false, startTs: 0, position: 0, volume: session.music.playback.volume, loop: session.music.playback.loop };
      io.to('room-' + code).emit('music-state', session.music.playback);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-updated', session.music.tracks);
  });

  // === Player: putar lagu dari playlist bersama (kayak jukebox — kedengeran ke semua orang) ===
  socket.on('player:music-play', ({ code, id }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return;
    if (!session.music.tracks[id]) return;
    session.music.playback.trackId = id;
    session.music.playback.position = 0;
    session.music.playback.isPlaying = true;
    session.music.playback.startTs = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-play', ({ code, id }) => {
    const session = sessions[code];
    if (!session || !session.music.tracks[id]) return;
    session.music.playback.trackId = id;
    session.music.playback.position = 0;
    session.music.playback.isPlaying = true;
    session.music.playback.startTs = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-pause', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.music.playback.trackId) return;
    const pb = session.music.playback;
    if (pb.isPlaying) pb.position = (Date.now() - pb.startTs) / 1000;
    pb.isPlaying = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-resume', ({ code }) => {
    const session = sessions[code];
    if (!session || !session.music.playback.trackId) return;
    const pb = session.music.playback;
    pb.isPlaying = true;
    pb.startTs = Date.now() - (pb.position || 0) * 1000;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-stop', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    const pb = session.music.playback;
    pb.isPlaying = false;
    pb.position = 0;
    pb.startTs = 0;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', pb);
  });

  socket.on('dm:music-volume', ({ code, volume }) => {
    const session = sessions[code];
    if (!session) return;
    session.music.playback.volume = Math.max(0, Math.min(1, parseFloat(volume) || 0));
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  socket.on('dm:music-loop', ({ code, loop }) => {
    const session = sessions[code];
    if (!session) return;
    session.music.playback.loop = !!loop;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('music-state', session.music.playback);
  });

  // === Story: Scene Banner (adegan saat ini, tersiar ke semua player) ===
  socket.on('dm:scene-set', ({ code, title, desc, imageUrl }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!title || !title.trim()) return cb && cb({ ok: false, error: 'Isi judul adegan.' });
    session.story.scene = {
      title: title.trim(), desc: (desc || '').trim(),
      imageUrl: imageUrl !== undefined ? imageUrl : session.story.scene.imageUrl,
      active: true, updatedAt: Date.now()
    };
    const logEntry = {
      id: genId('log'), from: 'Cerita',
      text: `📖 ${session.story.scene.title}${session.story.scene.desc ? ' — ' + session.story.scene.desc : ''}`,
      type: 'narrative', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('scene-updated', session.story.scene);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  socket.on('dm:scene-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    session.story.scene.active = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('scene-updated', session.story.scene);
  });

  // === Story: Dialog NPC (visual-novel style, tersiar ke semua player) ===
  socket.on('dm:dialogue-say', ({ code, npcName, npcPortrait, text }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!text || !text.trim()) return cb && cb({ ok: false, error: 'Isi dialognya dulu.' });
    session.story.dialogue = {
      npcName: (npcName || 'NPC').trim() || 'NPC',
      npcPortrait: npcPortrait !== undefined ? npcPortrait : session.story.dialogue.npcPortrait,
      text: text.trim(), active: true, updatedAt: Date.now()
    };
    const logEntry = {
      id: genId('log'), from: session.story.dialogue.npcName,
      text: `💬 ${session.story.dialogue.text}`,
      type: 'dialogue', ts: Date.now(), secret: false
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('dialogue-updated', session.story.dialogue);
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  socket.on('dm:dialogue-clear', ({ code }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    session.story.dialogue.active = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('dialogue-updated', session.story.dialogue);
  });

  // === Story: Quest / Objective Tracker ===
  socket.on('dm:quest-save', ({ code, quest }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!quest || !quest.title || !quest.title.trim()) return cb && cb({ ok: false, error: 'Isi judul quest.' });
    const isExisting = quest.id && session.story.quests[quest.id];
    const id = isExisting ? quest.id : genId('q');
    const prevStatus = isExisting ? session.story.quests[id].status : null;
    const q = {
      id, title: quest.title.trim(), desc: (quest.desc || '').trim(),
      status: quest.status || 'aktif', updatedAt: Date.now(),
      acceptedBy: isExisting ? (session.story.quests[id].acceptedBy || {}) : {}
    };
    session.story.quests[id] = q;
    let logText = null;
    if (!isExisting) logText = `📜 Quest baru: ${q.title}`;
    else if (prevStatus !== q.status) {
      if (q.status === 'selesai') logText = `✅ Quest selesai: ${q.title}`;
      else if (q.status === 'gagal') logText = `❌ Quest gagal: ${q.title}`;
      else logText = `📜 Quest diperbarui: ${q.title}`;
    }
    if (logText) {
      const logEntry = { id: genId('log'), from: 'Cerita', text: logText, type: 'quest', ts: Date.now(), secret: false };
      session.log.push(logEntry);
      if (session.log.length > 300) session.log.shift();
      io.to('room-' + code).emit('chat:new', logEntry);
    }
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    cb && cb({ ok: true, id });
  });

  socket.on('dm:quest-delete', ({ code, questId }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    ensureSessionDefaults(session);
    if (!session.story.quests[questId]) return;
    delete session.story.quests[questId];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
  });

  // === Player: ambil quest (biar quest gak cuma tampil doang, player bisa "commit" ngerjain) ===
  socket.on('player:quest-accept', ({ code, questId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const quest = session.story.quests[questId];
    if (!quest) return cb && cb({ ok: false, error: 'Quest tidak ditemukan.' });
    const player = session.players[socket.data.playerId];
    if (!player) return cb && cb({ ok: false, error: 'Player tidak ditemukan.' });
    if (!quest.acceptedBy) quest.acceptedBy = {};
    if (quest.acceptedBy[player.id]) return cb && cb({ ok: true }); // udah diambil sebelumnya
    quest.acceptedBy[player.id] = { name: player.name, acceptedAt: Date.now(), completed: false, completedAt: null };
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    const logEntry = { id: genId('log'), from: 'Quest', text: `📜 ${player.name} mengambil quest: ${quest.title}`, type: 'quest', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === Player: tandai quest yang diambil sebagai selesai di sisi dia (menunggu DM ubah status resmi) ===
  socket.on('player:quest-complete', ({ code, questId }, cb) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'player' || socket.data.code !== code) return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    const quest = session.story.quests[questId];
    if (!quest || !quest.acceptedBy || !quest.acceptedBy[socket.data.playerId]) {
      return cb && cb({ ok: false, error: 'Kamu belum ambil quest ini.' });
    }
    const player = session.players[socket.data.playerId];
    quest.acceptedBy[socket.data.playerId].completed = true;
    quest.acceptedBy[socket.data.playerId].completedAt = Date.now();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('quests-updated', session.story.quests);
    const logEntry = { id: genId('log'), from: 'Quest', text: `✅ ${player.name} menyelesaikan bagiannya di quest: ${quest.title} (menunggu konfirmasi DM)`, type: 'quest', ts: Date.now(), secret: false };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    io.to('room-' + code).emit('chat:new', logEntry);
    cb && cb({ ok: true });
  });

  // === Story: Handout (kirim dokumen/gambar/catatan ke satu atau semua player) ===
  socket.on('dm:handout-send', ({ code, playerId, title, imageUrl, text }, cb) => {
    const session = sessions[code];
    if (!session) return cb && cb({ ok: false });
    if (socket.data.role !== 'dm') return cb && cb({ ok: false });
    ensureSessionDefaults(session);
    if (!title || !title.trim()) return cb && cb({ ok: false, error: 'Isi judul dokumen.' });
    const handout = { id: genId('ho'), title: title.trim(), imageUrl: imageUrl || null, text: (text || '').trim(), ts: Date.now() };
    const target = playerId && session.players[playerId] ? session.players[playerId] : null;
    const targetLabel = target ? (target.sheet.nama_karakter || target.name) : 'Semua Pemain';
    const logEntry = {
      id: genId('log'), from: 'DM', text: `🎁 Dokumen untuk ${targetLabel}: ${handout.title}`,
      type: 'handout', ts: Date.now(), secret: false, imageUrl: handout.imageUrl, handoutText: handout.text
    };
    session.log.push(logEntry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:new', logEntry);
    if (target) { if (target.socketId) io.to(target.socketId).emit('story:handout', handout); }
    else { io.to('room-' + code).emit('story:handout', handout); }
    cb && cb({ ok: true });
  });

  // === Story: tandai/lepas entri log jadi "penting" (dipakai panel Recap) ===
  socket.on('dm:log-star', ({ code, id, starred }) => {
    const session = sessions[code];
    if (!session || socket.data.role !== 'dm') return;
    const entry = session.log.find(e => e.id === id);
    if (!entry) return;
    entry.starred = !!starred;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:starred', { id, starred: entry.starred });
  });

  // === Chat & dice log bersama ===
  // Roll dadu DM BISA dipilih rahasia atau engga (checkbox di sisi DM, dikirim
  // lewat `secret`). Roll/chat dari player selalu terlihat semua orang.
  // Status DM diambil dari socket.data.role (bukan dari payload client) biar
  // gak bisa dipalsukan oleh player.
  socket.on('chat:send', ({ code, from, text, type, secret }) => {
    const session = sessions[code];
    if (!session) return;
    const isDM = socket.data.role === 'dm';
    const isSecret = isDM && type === 'roll' && !!secret;
    const entry = { id: genId('log'), from, text, type: type || 'chat', ts: Date.now(), secret: isSecret };
    session.log.push(entry);
    if (session.log.length > 300) session.log.shift();
    saveSessionsDebounced(code);
    if (isSecret) {
      io.to('dm-' + code).emit('chat:new', entry);
    } else {
      io.to('room-' + code).emit('chat:new', entry);
    }
  });

  // === DM: perlihatkan roll rahasia yang sudah dilempar ke semua player ===
  socket.on('dm:reveal-roll', ({ code, id }) => {
    const session = sessions[code];
    if (!session) return;
    if (socket.data.role !== 'dm') return;
    const entry = session.log.find(e => e.id === id);
    if (!entry || !entry.secret) return;
    entry.secret = false;
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:revealed', entry);
  });

  socket.on('chat:clear', ({ code }) => {
    const session = sessions[code];
    if (!session) return;
    if (socket.data.role !== 'dm') return;
    session.log = [];
    saveSessionsDebounced(code);
    io.to('room-' + code).emit('chat:cleared');
  });

  // === Disconnect ===
  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code || !sessions[code]) return;
    const session = sessions[code];
    if (socket.data.role === 'dm' && session.dmSocketId === socket.id) {
      session.dmSocketId = null;
      socket.to('room-' + code).emit('dm:online', false);
    } else if (socket.data.role === 'player' && socket.data.playerId) {
      const p = session.players[socket.data.playerId];
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        io.to('dm-' + code).emit('player-online', { id: p.id, online: false });
      }
    }
    saveSessionsDebounced(code);
  });
});



// ============================= BATTLE FX =================================
// Modul kecil buat efek visual battle: angka damage/heal melayang di atas
// token peta, banner giliran, highlight token yang lagi jalan, & flash
// pulsa di bar HP/MP/SP. Murni kosmetik sisi klien — gak nyentuh data
// battle di server sama sekali, jadi aman dipasang di dm.js & character.js
// tanpa risiko ganggu state game. Include script ini SEBELUM dm.js/character.js.
(function () {
  function findTokenByLabel(mapInnerEl, label) {
    if (!mapInnerEl || !label) return null;
    const tags = mapInnerEl.querySelectorAll('.token-nametag');
    for (const tag of tags) {
      if (tag.textContent === label) return tag.closest('.token');
    }
    return null;
  }

  function escapeForBanner(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // Angka "-12" / "+8" melayang & fade di atas token peta yang namanya cocok.
  function spawnFloatNumber(mapInnerEl, label, amount) {
    const tokenEl = findTokenByLabel(mapInnerEl, label);
    if (!tokenEl || !amount) return;
    const isHeal = amount > 0;
    const el = document.createElement('div');
    el.className = 'dmg-float ' + (isHeal ? 'heal' : 'dmg');
    el.textContent = (isHeal ? '+' : '') + Math.round(amount);
    tokenEl.appendChild(el);
    const circle = tokenEl.querySelector('.token-circle');
    if (circle) {
      const flashCls = isHeal ? 'token-flash-heal' : 'token-flash-dmg';
      circle.classList.add(flashCls);
      setTimeout(() => circle.classList.remove(flashCls), 450);
    }
    setTimeout(() => el.remove(), 1150);
  }

  // Nyalain outline berkedip di token yang lagi giliran; matiin di semua token lain.
  function highlightActiveToken(mapInnerEl, activeLabel) {
    if (!mapInnerEl) return;
    mapInnerEl.querySelectorAll('.token.token-active-turn').forEach(t => t.classList.remove('token-active-turn'));
    const tokenEl = findTokenByLabel(mapInnerEl, activeLabel);
    if (tokenEl) tokenEl.classList.add('token-active-turn');
  }

  let bannerTimer = null;
  function showTurnBanner(name, isMe) {
    let host = document.getElementById('turnBannerHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'turnBannerHost';
      host.className = 'turn-banner-host';
      document.body.appendChild(host);
    }
    clearTimeout(bannerTimer);
    host.innerHTML = `<div class="turn-banner ${isMe ? 'is-me' : ''}">
      <span class="turn-banner-label">${isMe ? '⚡ Giliranmu!' : 'Giliran'}</span>
      <span class="turn-banner-name">${escapeForBanner(name)}</span>
    </div>`;
    // reflow paksa biar re-trigger transition kalau banner sebelumnya belum sempat ilang
    void host.offsetWidth;
    host.classList.add('show');
    bannerTimer = setTimeout(() => { host.classList.remove('show'); }, 1700);
  }

  // Flash pulsa merah/hijau sekilas di sebuah elemen bar-fill (dipanggil manual
  // dari kode yang nyet width bar, biasanya pas kedapetan nilai lama != baru).
  function flashBar(fillEl, isHeal) {
    if (!fillEl) return;
    const cls = isHeal ? 'bar-flash-heal' : 'bar-flash-dmg';
    fillEl.classList.remove('bar-flash-heal', 'bar-flash-dmg');
    void fillEl.offsetWidth; // reflow biar animasi re-trigger walau class sama
    fillEl.classList.add(cls);
    setTimeout(() => fillEl.classList.remove(cls), 500);
  }

  // Entry point utama: dipanggil tiap terima event 'battle-updated', SEBELUM
  // state lama ditimpa. Bandingin hp_current lama vs baru per entry buat
  // munculin damage number, dan bandingin turn.activeId buat banner + highlight.
  //
  // opts:
  //   prevEntries  - snapshot entries battle SEBELUM update (object {id: entry})
  //   battle       - payload battle terbaru dari server
  //   mapInnerEl   - elemen kontainer token di peta (mapInner / pMapInner), boleh null
  //   prevActiveId - turn.activeId SEBELUM update
  //   myEntryId    - (opsional, buat character.js) id entry battle milik player sendiri
  function processBattleUpdate(opts) {
    const { prevEntries, battle, mapInnerEl, prevActiveId, myEntryId } = opts || {};
    const entries = (battle && battle.entries) || {};
    const turn = (battle && battle.turn) || {};

    Object.keys(entries).forEach(id => {
      const now = entries[id];
      const prev = prevEntries && prevEntries[id];
      if (!prev) return;
      const prevHp = parseFloat(prev.hp_current);
      const nowHp = parseFloat(now.hp_current);
      if (!isNaN(prevHp) && !isNaN(nowHp) && prevHp !== nowHp && mapInnerEl) {
        spawnFloatNumber(mapInnerEl, now.name, nowHp - prevHp);
      }
    });

    if (turn.activeId && turn.activeId !== prevActiveId) {
      const activeEntry = entries[turn.activeId];
      if (activeEntry) {
        if (mapInnerEl) highlightActiveToken(mapInnerEl, activeEntry.name);
        showTurnBanner(activeEntry.name, !!myEntryId && turn.activeId === myEntryId);
      }
    }
  }

  window.BattleFX = { processBattleUpdate, flashBar, spawnFloatNumber, highlightActiveToken, showTurnBanner };
})();

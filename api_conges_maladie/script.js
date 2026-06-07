/* =============================================
   SUIVI CONGÉS MALADIE — script.js v7
   
   Architecture frise :
   - Molette  → scroll partout dans frise-scroll-outer
   - Drag     → uniquement sur #frise-drag-zone (moitié basse)
                déplace le bloc glissant
   - Hover    → SVG au z-index 1, bloc à pointer-events:none
                → le hover fonctionne même sous le bloc

   Mode activité  : aucune fenêtre de 365j ne dépasse 180j de congés
   Mode hors-acti : une fenêtre de 365j atteint 180j → hover actif, bloc visible
   ============================================= */

"use strict";

/* ── PAGE DE GARDE ───────────────────────────── */
function enterApp() {
  const landing = document.getElementById('landing');
  const app     = document.getElementById('main-app');
  if (!landing || !app) return;
  landing.classList.add('exit');
  app.style.display = '';
  app.classList.add('entering');
  setTimeout(() => {
    landing.style.display = 'none';
    app.classList.remove('entering');
  }, 700);
}


/* ── STATE ────────────────────────────────────── */
let entries    = [];
let trash      = [];
let friseStart = null;       // ISO date du 1er arrêt
let blocOffset  = 0;          // décalage du bloc glissant en jours
let editingId   = null;        // id de l'arrêt en cours d'édition (null = mode création)

const PX_PER_DAY   = 4;     // pixels par jour sur la frise
const BLOC_DAYS    = 365;   // taille fixe du bloc
const FRISE_HEIGHT = 160;   // hauteur totale de la zone SVG en px (hors labels)

/* ── DATE UTILS ───────────────────────────────── */
const fmtD = s => {
  if (!s) return '—';
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const days = (d1, d2) => Math.round((new Date(d2) - new Date(d1)) / 86400000) + 1;
const addDaysStr = (s, n) => {
  const d = new Date(s); d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── CALCULS MÉTIER ───────────────────────────── */

/** Jours de congé dans [wStart, wEnd], excluant un id optionnel */
function daysInWindow(wStart, wEnd, excludeId = null) {
  let total = 0;
  for (const e of entries) {
    if (excludeId && e.id === excludeId) continue;
    const s  = e.d1 > wStart ? e.d1 : wStart;
    const en = e.d2 < wEnd   ? e.d2 : wEnd;
    if (s <= en) total += days(s, en);
  }
  return total;
}

/**
 * Calcule le cumul maximum sur toutes les fenêtres glissantes de 365 jours.
 * On teste comme point de départ chaque date de début/fin d'arrêt pour
 * ne scanner que les fenêtres "intéressantes" (O(n²) au lieu de O(n×365)).
 * Retourne { maxCumul, windowStart, windowEnd }
 */
function maxCumulGlissant(excludeId = null) {
  if (!entries.length) return { maxCumul: 0, windowStart: null, windowEnd: null };

  // Candidats : toutes les dates de début de chaque arrêt
  const candidats = entries
    .filter(e => !excludeId || e.id !== excludeId)
    .map(e => e.d1);

  let maxCumul = 0, bestStart = null, bestEnd = null;

  for (const wStart of candidats) {
    const wEnd  = addDaysStr(wStart, 364); // fenêtre de 365 jours inclusifs
    const cumul = daysInWindow(wStart, wEnd, excludeId);
    if (cumul > maxCumul) {
      maxCumul   = cumul;
      bestStart  = wStart;
      bestEnd    = wEnd;
    }
  }
  return { maxCumul, windowStart: bestStart, windowEnd: bestEnd };
}

/**
 * Détecte le basculement : existe-t-il une fenêtre de 365 jours avec ≥ 180j ?
 * Pour trouver la date exacte du basculement, on cherche le jour où,
 * dans la fenêtre [d1_arrêt, d1_arrêt + 364j], le cumul atteint 180.
 * Retourne { triggered, triggerDate, triggerDay, windowStart }
 */
function detectBasculement() {
  if (!friseStart || !entries.length)
    return { triggered: false, triggerDate: null, triggerDay: null, windowStart: null };

  const { maxCumul, windowStart } = maxCumulGlissant();
  if (maxCumul < 180)
    return { triggered: false, triggerDate: null, triggerDay: null, windowStart: null };

  // Trouver le jour précis dans la meilleure fenêtre où 180j est atteint
  const wEnd = addDaysStr(windowStart, 364);
  for (let d = 0; d <= 364; d++) {
    const cur   = addDaysStr(windowStart, d);
    const cumul = daysInWindow(windowStart, cur);
    if (cumul >= 180) {
      const triggerDay = Math.round((new Date(cur) - new Date(friseStart)) / 86400000);
      return { triggered: true, triggerDate: cur, triggerDay, windowStart };
    }
  }
  return { triggered: false, triggerDate: null, triggerDay: null, windowStart: null };
}

const getMode = () => detectBasculement().triggered ? 'hors-activite' : 'activite';

/* ── COULEUR selon seuil ─────────────────────── */
// Seuils : vert <90, jaune 90-119, orange 120-179, rouge ≥180
function windowColor(n) {
  if (n < 90)  return 'c-green';
  if (n < 120) return 'c-yellow';
  if (n < 180) return 'c-orange';
  return 'c-red';
}

/* ── FRISE : dimensions ─────────────────────── */
function totalFriseDays() {
  if (!friseStart || !entries.length) return 365;
  const lastEnd = entries.reduce((mx, e) => e.d2 > mx ? e.d2 : mx, entries[0].d2);
  return Math.max(days(friseStart, lastEnd) + 90, 365);
}

const px    = d  => Math.round(d * PX_PER_DAY);
const dayOf = ds => friseStart
  ? Math.round((new Date(ds) - new Date(friseStart)) / 86400000)
  : 0;

/* ── DESSIN SVG ──────────────────────────────── */
/* ── DESSIN SVG ──────────────────────────────── */
function drawFrise() {
  const wrap = document.getElementById('frise-svg-wrap');
  if (!wrap) return;

  const mode      = getMode();
  const today     = new Date().toISOString().split('T')[0];
  const start     = friseStart || today;
  const totalDays = totalFriseDays();

  /*
    Layout vertical :
      TP    = espace minimal en haut (respiration)
      railY = TP → début du rail des blocs de congé
      railH = hauteur cumulée de toutes les lanes
      BP    = espace en bas → labels dates + marqueurs Auj./180j
      svgH  = TP + railH + BP
  */
  const LP = 20, RP = 20, TP = 8, BP = 40;
  const barH = 48, laneGap = 10;
  const trackW = px(totalDays);
  const svgW   = LP + trackW + RP;

  /* Lane packing */
  const sorted = [...entries].sort((a,b) => a.d1 < b.d1 ? -1 : 1);
  const lanes  = [];
  sorted.forEach(e => {
    let placed = false;
    for (let li = 0; li < lanes.length; li++) {
      const last = lanes[li][lanes[li].length - 1];
      if (dayOf(e.d1) > dayOf(last.d2) + 1) { lanes[li].push(e); placed = true; break; }
    }
    if (!placed) lanes.push([e]);
  });

  const nL    = Math.max(1, lanes.length);
  const railH = nL * (barH + laneGap) - laneGap;
  const svgH  = TP + railH + BP;
  const railY = TP;

  /* Y des labels du bas */
  const labelY  = railY + railH + 14;
  const labelY2 = railY + railH + 26;

  function pxD(d) { return LP + px(clamp(d, 0, totalDays)); }

  let s = `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">`;

  /* Rail fond */
  s += `<rect x="${LP}" y="${railY}" width="${trackW}" height="${railH}" rx="6" fill="#eef0f8"/>`;

  /* Grille verticale + labels de dates EN BAS du rail */
  for (let d = 0; d <= totalDays; d += 30) {
    const x        = pxD(d);
    const isMajor  = (d % 90 === 0);
    const dateStr  = addDaysStr(start, d);
    const [y,m,dy] = dateStr.split('-');
    const lbl      = `${dy}/${m}/${y.slice(2)}`;
    const anchor   = d === 0 ? 'start' : (d >= totalDays - 10 ? 'end' : 'middle');

    s += `<line x1="${x}" y1="${railY}" x2="${x}" y2="${railY + railH}"
            stroke="rgba(21,50,114,${isMajor ? '0.12' : '0.05'})"
            stroke-width="${isMajor ? 1 : 0.7}"/>`;

    /* Dates → EN BAS, sous le rail */
    s += `<text x="${x}" y="${labelY}"
            font-size="9" fill="${isMajor ? '#6b7fa8' : '#c0c8dd'}"
            text-anchor="${anchor}"
            font-family="DM Mono,monospace"
            font-weight="${isMajor ? '500' : '400'}">${lbl}</text>`;
  }

  /* Blocs de congés :
     - rect visible (doré) avec pointer-events="none"
     - rect transparent PLEINE HAUTEUR DE LA LANE → zone hover généreuse
     Le bloc glissant a pointer-events:none → hover SVG non bloqué */
  const hoverOn = (mode === 'hors-activite');

  lanes.forEach((lane, li) => {
    const ly = railY + li * (barH + laneGap);

    lane.forEach(e => {
      const es = dayOf(e.d1), ee = dayOf(e.d2);
      if (ee < 0 || es > totalDays) return;
      const ex = pxD(Math.max(0, es));
      const ew = Math.max(6, pxD(Math.min(ee, totalDays)) - pxD(Math.max(0, es)));

      /* Rect visible doré — pointer-events none */
      s += `<rect x="${ex}" y="${ly+2}" width="${ew}" height="${barH-4}" rx="5"
              fill="#e2ac33" opacity="0.88" pointer-events="none"/>`;
      /* Reflet haut */
      s += `<rect x="${ex}" y="${ly+2}" width="${ew}" height="${Math.floor((barH-4)*0.28)}" rx="5"
              fill="rgba(255,255,255,0.22)" pointer-events="none"/>`;
      /* Label texte */
      if (ew > 32) {
        const txtLbl = e.label.length > 18 ? e.label.slice(0,16)+'…' : e.label;
        s += `<text x="${ex+ew/2}" y="${ly + barH/2 + 5}"
                font-size="11.5" fill="#0d1f47" text-anchor="middle"
                font-weight="700" font-family="DM Mono,monospace"
                pointer-events="none">${txtLbl}</text>`;
      }

      /* Rect transparent PLEINE HAUTEUR DE LA LANE → zone hover large */
      if (hoverOn) {
        s += `<rect x="${ex}" y="${ly}" width="${ew}" height="${barH}"
                fill="transparent" pointer-events="all" style="cursor:pointer"
                onmouseenter="showTip(event,${e.id})"
                onmousemove="moveTip(event)"
                onmouseleave="hideTip()"/>`;
      }
    });
  });

  /* ── Aujourd'hui → label + triangle BAS du rail ── */
  const ti = dayOf(today);
  if (ti >= 0 && ti <= totalDays) {
    const tx = pxD(ti);
    s += `<line x1="${tx}" y1="${railY}" x2="${tx}" y2="${railY+railH}"
            stroke="#153272" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.35"/>`;
    s += `<polygon points="${tx-4},${railY+railH+1} ${tx+4},${railY+railH+1} ${tx},${railY+railH+8}"
            fill="#153272" opacity="0.45"/>`;
    s += `<text x="${tx}" y="${labelY2}"
            font-size="9" fill="#153272" font-weight="700"
            text-anchor="middle" font-family="DM Mono,monospace" opacity="0.7">Auj.</text>`;
  }

  /* ── Marqueurs de seuils sur la frise : 60j / 90j / 120j / 180j ── */
  // Pour chaque seuil on cherche la première fenêtre de 365j qui l'atteint
  const thresholds = [
    { val: 60,  color: '#1a7a4a', label: '60j'  },
    { val: 90,  color: '#c47a0a', label: '90j'  },
    { val: 120, color: '#9b3fb5', label: '120j' },
    { val: 180, color: '#c0392b', label: '180j' },
  ];

  // On construit les candidats : tous les débuts d'arrêt
  const candidatDates = entries.map(e => e.d1);

  thresholds.forEach(th => {
    // Trouver la première date où le cumul glissant atteint ce seuil
    let hitDate = null;
    for (const wStart of candidatDates) {
      for (let d = 0; d <= 364; d++) {
        const cur   = addDaysStr(wStart, d);
        const cumul = daysInWindow(wStart, cur);
        if (cumul >= th.val) {
          if (!hitDate || cur < hitDate) hitDate = cur;
          break;
        }
      }
    }
    if (!hitDate) return;

    const hd = Math.round((new Date(hitDate) - new Date(start)) / 86400000);
    if (hd < 0 || hd > totalDays) return;
    const hx = pxD(hd);

    s += `<line x1="${hx}" y1="${railY}" x2="${hx}" y2="${railY+railH}"
            stroke="${th.color}" stroke-width="${th.val === 180 ? 2 : 1.2}"
            stroke-dasharray="${th.val === 180 ? '5,3' : '3,2'}" opacity="0.8"/>`;
    s += `<polygon points="${hx-3},${railY+railH+1} ${hx+3},${railY+railH+1} ${hx},${railY+railH+7}"
            fill="${th.color}" opacity="0.85"/>`;
    s += `<text x="${hx}" y="${th.val === 180 ? labelY : labelY - 1}"
            font-size="9" fill="${th.color}" font-weight="${th.val === 180 ? '800' : '700'}"
            text-anchor="middle" font-family="DM Mono,monospace">${th.label}</text>`;
    if (th.val === 180) {
      s += `<text x="${hx}" y="${labelY2}"
              font-size="9" fill="${th.color}" font-weight="600"
              text-anchor="middle" font-family="DM Mono,monospace">${fmtD(hitDate)}</text>`;
    }
  });

  /* Vide */
  if (!entries.length) {
    s += `<text x="${LP + trackW/2}" y="${railY + railH/2 + 6}"
            font-size="12" fill="#a8b4cc" text-anchor="middle"
            font-family="Mulish,sans-serif">Aucun congé saisi</text>`;
  }

  /* Bord rail */
  s += `<rect x="${LP}" y="${railY}" width="${trackW}" height="${railH}" rx="6"
          fill="none" stroke="rgba(21,50,114,0.08)" stroke-width="1"/>`;
  s += `</svg>`;

  wrap.innerHTML = s;

  /* Largeur frise-inner */
  const inner = document.getElementById('frise-inner');
  if (inner) inner.style.width = svgW + 'px';

  /* Label durée */
  const lbl = document.getElementById('frise-total-label');
  if (lbl) lbl.textContent = `— ${totalDays} j`;

  /* Zone de drag : recouvre uniquement la bande BP du bas (labels/marqueurs)
     Pas de chevauchement avec les blocs congé → hover non affecté */
  const dragZone = document.getElementById('frise-drag-zone');
  if (dragZone) {
    if (mode === 'hors-activite') {
      dragZone.style.display = 'block';
      dragZone.style.top     = (railY + railH) + 'px';
      dragZone.style.height  = BP + 'px';
      dragZone.style.width   = svgW + 'px';
    } else {
      dragZone.style.display = 'none';
    }
  }

  updateBlocGlissant(svgH, svgW, LP, railY, railH, BP);
}

/* ── BLOC GLISSANT ───────────────────────────── */
function updateBlocGlissant(svgH, svgW, LP, railY, railH, BP) {
  const bloc   = document.getElementById('glissant-bloc');
  const legend = document.getElementById('legend-bloc');
  const mode   = getMode();

  if (!bloc) return;

  if (mode !== 'hors-activite') {
    bloc.style.display = 'none';
    if (legend) legend.style.display = 'none';
    return;
  }

  if (legend) legend.style.display = '';
  bloc.style.display = 'flex';

  /* Si paramètres non fournis, lire depuis le SVG */
  if (!svgH || !svgW) {
    const svg = document.querySelector('#frise-svg-wrap svg');
    if (!svg) return;
    svgH  = parseInt(svg.getAttribute('height')) || 120;
    svgW  = parseInt(svg.getAttribute('width'))  || 800;
    LP    = 20;
    railH = svgH - 48; railY = 8; BP = 40;
  }

  const totalDays = totalFriseDays();
  blocOffset = clamp(blocOffset, 0, Math.max(0, totalDays - BLOC_DAYS));

  const bLeft  = LP + px(blocOffset);
  const bWidth = px(BLOC_DAYS);

  /* Le bloc couvre uniquement la zone du rail (pas la zone de labels du bas)
     pour que son texte ne chevauche pas les blocs de congé */
  bloc.style.left   = bLeft + 'px';
  bloc.style.width  = bWidth + 'px';
  bloc.style.top    = (railY || 8) + 'px';
  bloc.style.height = (railH || svgH - 48) + 'px';

  const start    = friseStart || new Date().toISOString().split('T')[0];
  const dateL    = addDaysStr(start, blocOffset);
  const dateR    = addDaysStr(start, blocOffset + BLOC_DAYS - 1);

  document.getElementById('glissant-label-left').textContent  = fmtD(dateL);
  document.getElementById('glissant-label-right').textContent = fmtD(dateR);

  /* Cumul dans la fenêtre */
  const totalInBloc = daysInWindow(dateL, dateR);

  /* Texte central du bloc → dans la moitié basse du bloc,
     loin du haut où passent les congés */
  const gcumul = document.getElementById('glissant-cumul');
  if (gcumul) {
    gcumul.textContent = totalInBloc + ' j dans la fenêtre';
    /* Couleur selon seuil */
    const col = totalInBloc < 90  ? '#4ade80'
              : totalInBloc < 120 ? '#fde047'
              : totalInBloc < 180 ? '#fb923c'
              : '#f87171';
    gcumul.style.color = col;
  }

  /* Colonne 2 sous la frise */
  const col2val = document.getElementById('fm-col2-value');
  const col2lbl = document.getElementById('fm-col2-label');
  const col2sub = document.getElementById('fm-col2-sub');
  if (col2val && col2lbl) {
    col2lbl.textContent = 'Dans la fenêtre';
    col2val.textContent = totalInBloc + ' j';
    const cls = totalInBloc < 90  ? 'ok'
              : totalInBloc < 120 ? ''
              : totalInBloc < 180 ? 'warn'
              : 'danger';
    col2val.className = `fm-value ${cls}`;
    if (col2sub) col2sub.textContent = `${fmtD(dateL)} → ${fmtD(dateR)}`;
  }
}


/* ── DRAG BLOC (uniquement depuis drag-zone) ─── */
(function initBlocDrag() {
  let dragging = false, startClientX = 0, startOffset = 0;

  document.addEventListener('mousedown', e => {
    const zone = document.getElementById('frise-drag-zone');
    if (!zone || e.target !== zone) return;
    dragging     = true;
    startClientX = e.clientX;
    startOffset  = blocOffset;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta     = e.clientX - startClientX;
    const daysDelta = Math.round(delta / PX_PER_DAY);
    blocOffset = clamp(startOffset + daysDelta, 0, Math.max(0, totalFriseDays() - BLOC_DAYS));
    updateBlocGlissant();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
  });

  /* Touch support */
  document.addEventListener('touchstart', e => {
    const zone = document.getElementById('frise-drag-zone');
    if (!zone || e.target !== zone) return;
    dragging     = true;
    startClientX = e.touches[0].clientX;
    startOffset  = blocOffset;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const delta     = e.touches[0].clientX - startClientX;
    const daysDelta = Math.round(delta / PX_PER_DAY);
    blocOffset = clamp(startOffset + daysDelta, 0, Math.max(0, totalFriseDays() - BLOC_DAYS));
    updateBlocGlissant();
  }, { passive: true });

  document.addEventListener('touchend', () => { dragging = false; });
})();

/* ── SCROLL MOLETTE ───────────────────────────── */
(function initScroll() {
  document.addEventListener('wheel', e => {
    const outer = document.getElementById('frise-outer');
    if (!outer || !outer.contains(e.target)) return;
    e.preventDefault();
    outer.scrollLeft += e.deltaY * 2;
  }, { passive: false });
})();

/* ── TOOLTIP ─────────────────────────────────── */
function showTip(evt, entryId) {
  if (getMode() !== 'hors-activite') return;
  const e = entries.find(x => x.id === entryId);
  if (!e) return;

  const start        = friseStart;
  const blocStartDate = addDaysStr(start, blocOffset);
  const blocEndDate   = addDaysStr(start, blocOffset + BLOC_DAYS - 1);

  /* Jours de CE congé dans la fenêtre du bloc */
  const ovStart   = e.d1 > blocStartDate ? e.d1 : blocStartDate;
  const ovEnd     = e.d2 < blocEndDate   ? e.d2 : blocEndDate;
  const daysInBloc = ovStart <= ovEnd ? days(ovStart, ovEnd) : 0;

  /* Total tous congés dans la fenêtre */
  const totalInBloc = daysInWindow(blocStartDate, blocEndDate);

  document.getElementById('tip-label').textContent = e.label;
  document.getElementById('tip-dates').textContent = `${fmtD(e.d1)} → ${fmtD(e.d2)} · ${e.dur} j`;

  const dEl = document.getElementById('tip-days');
  dEl.textContent  = daysInBloc;
  dEl.className    = `tip-days ${windowColor(daysInBloc)}`;

  document.getElementById('tip-info').textContent =
    `Cet arrêt dans la fenêtre : ${daysInBloc} j\nTotal fenêtre : ${totalInBloc} j\n${fmtD(blocStartDate)} → ${fmtD(blocEndDate)}`;

  const tip = document.getElementById('ftip');
  tip.style.display = 'block';
  moveTip(evt);
}

function moveTip(evt) {
  const tip = document.getElementById('ftip');
  if (!tip || tip.style.display === 'none') return;
  let tx = evt.clientX + 16;
  let ty = evt.clientY - 150;
  if (tx + 240 > window.innerWidth)  tx = evt.clientX - 245;
  if (ty < 8)                        ty = evt.clientY + 12;
  if (ty + 180 > window.innerHeight) ty = window.innerHeight - 185;
  tip.style.left = tx + 'px';
  tip.style.top  = ty + 'px';
}

function hideTip() {
  const tip = document.getElementById('ftip');
  if (tip) tip.style.display = 'none';
}

/* ── VALIDATION ──────────────────────────────── */
function showErr(msg) {
  const el = document.getElementById('err-msg');
  el.innerHTML = msg; el.classList.add('show');
  ['entry-d1','entry-d2'].forEach(id => document.getElementById(id)?.classList.add('error'));
}
function clearErr() {
  document.getElementById('err-msg')?.classList.remove('show');
  ['entry-d1','entry-d2'].forEach(id => document.getElementById(id)?.classList.remove('error'));
}

function validateEntry(d1, d2, excludeId = null) {
  if (!d1 || !d2) return 'Veuillez renseigner les deux dates.';
  if (new Date(d2) < new Date(d1)) return 'La date de fin doit être postérieure à la date de début.';
  for (const e of entries) {
    if (excludeId && e.id === excludeId) continue;
    if (!(d2 < e.d1 || d1 > e.d2))
      return `Chevauchement avec un arrêt existant (${fmtD(e.d1)} → ${fmtD(e.d2)}).`;
  }
  return null;
}

/* ── ADD / REMOVE / RESTORE ──────────────────── */
function addEntry() {
  clearErr();
  const d1    = document.getElementById('entry-d1').value;
  const d2    = document.getElementById('entry-d2').value;
  const motif = document.getElementById('entry-motif').value.trim();

  if (editingId !== null) {
    // ── MODE ÉDITION ──
    const err = validateEntry(d1, d2, editingId);
    if (err) { showErr(err); return; }
    const idx = entries.findIndex(e => e.id === editingId);
    if (idx !== -1) {
      const oldLabel = entries[idx].label;
      // Conserver le label original si le motif n'a pas changé
      const newLabel = motif || oldLabel;
      entries[idx] = { ...entries[idx], d1, d2, dur: days(d1, d2), label: newLabel };
    }
    cancelEdit();
  } else {
    // ── MODE CRÉATION ──
    const err = validateEntry(d1, d2);
    if (err) { showErr(err); return; }
    const idx   = entries.length + 1;
    const label = motif || `Arrêt n°${idx}`;
    entries.push({ d1, d2, dur: days(d1, d2), label, id: Date.now() });
    resetForm();
  }

  calcFriseStart();
  drawFrise();
  updateAll();
}

function resetForm() {
  document.getElementById('entry-d1').value    = '';
  document.getElementById('entry-d2').value    = '';
  document.getElementById('entry-motif').value = '';
  clearErr();
}

/** Passer en mode édition pour un arrêt existant */
function startEdit(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingId = id;

  // Remplir le formulaire avec les valeurs existantes
  document.getElementById('entry-d1').value    = e.d1;
  document.getElementById('entry-d2').value    = e.d2;
  document.getElementById('entry-motif').value = e.label;
  clearErr();

  // Changer l'apparence du formulaire
  const btn     = document.getElementById('btn-add');
  const formTtl = document.getElementById('form-title');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (btn)       btn.innerHTML = '<span class="btn-add-dot">✓</span>Enregistrer la modification';
  if (formTtl)   formTtl.textContent = 'Modifier un congé maladie';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  // Scroller vers le formulaire
  document.getElementById('entry-d1')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Annuler l'édition et revenir en mode création */
function cancelEdit() {
  editingId = null;
  resetForm();
  const btn       = document.getElementById('btn-add');
  const formTtl   = document.getElementById('form-title');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (btn)       btn.innerHTML = '<span class="btn-add-dot">+</span>Enregistrer l\'arrêt';
  if (formTtl)   formTtl.textContent = 'Saisir un congé maladie';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function removeEntry(id) {
  const e = entries.find(x => x.id === id);
  if (e) trash.unshift({ ...e, deletedAt: new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
  entries = entries.filter(x => x.id !== id);
  calcFriseStart(); drawFrise(); updateAll();
}

function restoreEntry(id) {
  const e = trash.find(x => x.id === id);
  if (!e) return;
  const err = validateEntry(e.d1, e.d2, e.id);
  if (err) { alert('Impossible de restaurer :\n' + err.replace(/<[^>]+>/g,'')); return; }
  trash = trash.filter(x => x.id !== id);
  entries.push(e);
  calcFriseStart(); drawFrise(); updateAll();
}

function resetAll() {
  if (!entries.length) return;
  if (!confirm('Envoyer TOUS les arrêts dans la corbeille ?')) return;
  const t = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  trash   = [...entries.map(e => ({ ...e, deletedAt: t })), ...trash];
  entries = [];
  calcFriseStart(); drawFrise(); updateAll();
}

function calcFriseStart() {
  friseStart = entries.length
    ? entries.reduce((mn, e) => e.d1 < mn ? e.d1 : mn, entries[0].d1)
    : null;
}

/* ── UPDATE GLOBAL ───────────────────────────── */
function updateAll() {
  updateMode();
  updateFriseMetrics();
  updateDashboard();
}

function updateMode() {
  const mode  = getMode();
  const badge = document.getElementById('mode-badge');
  const label = document.getElementById('mode-label');
  const alert = document.getElementById('basculement-alert');
  const sub   = document.getElementById('bascule-sub');

  if (mode === 'hors-activite') {
    badge?.classList.add('hors-activite');
    if (label) label.textContent = 'Hors activité';
    if (alert) {
      alert.style.display = 'flex';
      const b = detectBasculement();
      if (sub && b.triggered)
        sub.textContent = `180 jours atteints — basculement le ${fmtD(b.triggerDate)}.`;
    }
  } else {
    badge?.classList.remove('hors-activite');
    if (label) label.textContent = 'En activité';
    if (alert) alert.style.display = 'none';
  }

  const legendBloc = document.getElementById('legend-bloc');
  if (legendBloc) legendBloc.style.display = mode === 'hors-activite' ? '' : 'none';
}

function updateFriseMetrics() {
  const mode = getMode();
  const { maxCumul, windowStart, windowEnd } = maxCumulGlissant();

  /* Colonne 1 : max sur 365 j glissants */
  const cEl  = document.getElementById('fm-cumul');
  const cLbl = document.getElementById('fm-cumul-label');
  if (cEl) {
    cEl.textContent = maxCumul + ' j';
    cEl.className   = 'fm-value'
      + (maxCumul >= 180 ? ' danger' : maxCumul >= 120 ? ' warn' : '');
  }
  if (cLbl) cLbl.textContent = 'Max sur 365 j';

  const col2val = document.getElementById('fm-col2-value');
  const col2lbl = document.getElementById('fm-col2-label');
  const col2sub = document.getElementById('fm-col2-sub');

  if (mode === 'activite') {
    /* Compte à rebours : jours avant d'atteindre 180j sur la pire fenêtre */
    const restant  = Math.max(0, 180 - maxCumul);
    const pctUsed  = Math.min((maxCumul / 180) * 100, 100);

    if (col2lbl) col2lbl.textContent = 'Avant basculement';
    if (col2val) {
      col2val.textContent = restant + ' j';
      col2val.className   = 'fm-value'
        + (restant === 0 ? ' danger' : restant <= 30 ? ' warn' : ' ok');
    }
    if (col2sub) {
      col2sub.textContent = maxCumul === 0
        ? 'Aucun arrêt enregistré'
        : `${Math.round(pctUsed)}% — fenêtre ${fmtD(windowStart)} → ${fmtD(windowEnd)}`;
    }

    /* Mini barre de progression */
    let bar = document.getElementById('fm-countdown-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fm-countdown-bar';
      bar.className = 'countdown-bar';
      bar.innerHTML = '<div class="countdown-fill" id="fm-countdown-fill"></div>';
      const col2 = document.getElementById('fm-col2');
      if (col2) col2.appendChild(bar);
    }
    const fill = document.getElementById('fm-countdown-fill');
    if (fill) {
      fill.style.width      = Math.round(pctUsed) + '%';
      fill.style.background = maxCumul >= 120 ? '#c0392b' : maxCumul >= 90 ? '#c47a0a' : '#1a7a4a';
    }
    bar.style.display = '';

  } else {
    /* Mode hors-activité : cumul dans la fenêtre du bloc glissant */
    const start         = friseStart || new Date().toISOString().split('T')[0];
    const blocStartDate = addDaysStr(start, blocOffset);
    const blocEndDate   = addDaysStr(start, blocOffset + BLOC_DAYS - 1);
    const totalInBloc   = daysInWindow(blocStartDate, blocEndDate);

    if (col2lbl) col2lbl.textContent = 'Dans la fenêtre';
    if (col2val) {
      col2val.textContent = totalInBloc + ' j';
      const cls = totalInBloc < 90  ? 'ok'
                : totalInBloc < 120 ? ''
                : totalInBloc < 180 ? 'warn'
                : 'danger';
      col2val.className = `fm-value ${cls}`;
    }
    if (col2sub) col2sub.textContent = `${fmtD(blocStartDate)} → ${fmtD(blocEndDate)}`;

    const bar = document.getElementById('fm-countdown-bar');
    if (bar) bar.style.display = 'none';
  }
}

/* ── DASHBOARD ───────────────────────────────── */
function updateDashboard() {
  const { maxCumul, windowStart, windowEnd } = maxCumulGlissant();
  const r120 = Math.max(0, 120 - maxCumul);
  const r180 = Math.max(0, 180 - maxCumul);

  /* Alertes */
  const a180 = document.getElementById('alert-180');
  const a150 = document.getElementById('alert-150');
  const a120 = document.getElementById('alert-120');
  if (a180) a180.style.display = maxCumul >= 180 ? 'flex' : 'none';
  if (a150) a150.style.display = (maxCumul >= 150 && maxCumul < 180) ? 'flex' : 'none';
  if (a120) a120.style.display = (maxCumul >= 120 && maxCumul < 150) ? 'flex' : 'none';

  /* Metric 1 : max sur 365 j glissants (remplace cumul absolu) */
  const mv1 = document.getElementById('mv1'), ms1 = document.getElementById('ms1');
  const ms1lbl = document.querySelector('#mv1')?.closest('.metric')?.querySelector('.metric-label');
  if (ms1lbl) ms1lbl.textContent = 'Max sur 365 j glissants';
  const ms1sub = document.querySelector('#mv1')?.closest('.metric')?.querySelector('.metric-sub');
  if (ms1sub) ms1sub.textContent = windowStart
    ? `Fenêtre : ${fmtD(windowStart)} → ${fmtD(windowEnd)}`
    : 'Aucun arrêt';
  if (mv1) {
    mv1.textContent = maxCumul + ' j';
    const c = maxCumul >= 180 ? 'red' : maxCumul >= 150 ? 'purple' : maxCumul >= 120 ? 'orange' : '';
    mv1.className = 'metric-value' + (c ? ' '+c : '');
    if (ms1) ms1.className = 'metric-stripe' + (c ? ' '+c : '');
  }

  /* Metric 2 : restant avant 120j */
  const mv2 = document.getElementById('mv2'), ms2 = document.getElementById('ms2');
  if (mv2) {
    mv2.textContent = r120 + ' j';
    const c = r120 === 0 ? 'red' : r120 <= 20 ? 'orange' : 'green';
    mv2.className = 'metric-value '+c;
    if (ms2) ms2.className = 'metric-stripe '+c;
  }

  /* Metric 3 : restant avant 180j */
  const mv3 = document.getElementById('mv3'), ms3 = document.getElementById('ms3');
  if (mv3) {
    mv3.textContent = r180 + ' j';
    const c = r180 === 0 ? 'red' : r180 <= 30 ? 'orange' : 'green';
    mv3.className = 'metric-value '+c;
    if (ms3) ms3.className = 'metric-stripe '+c;
  }

  /* Progress bar */
  const pct = Math.min((maxCumul / 180) * 100, 100);
  const pf  = document.getElementById('prog-fill');
  if (pf) {
    pf.style.width      = Math.round(pct) + '%';
    pf.style.background = maxCumul >= 180 ? '#c0392b' : maxCumul >= 120 ? '#c47a0a' : '#1a7a4a';
  }
  const pl = document.getElementById('prog-l');
  if (pl) pl.textContent = maxCumul + ' j';
  const pn = document.getElementById('prog-note');
  if (pn) pn.textContent = maxCumul === 0
    ? 'Aucun congé maladie enregistré.'
    : `${Math.round(pct)}% du seuil — fenêtre max : ${fmtD(windowStart)} → ${fmtD(windowEnd)}`;

  /* Liste */
  const list = document.getElementById('entry-list');
  if (list) {
    if (!entries.length) {
      list.innerHTML = '<div class="empty-state">Aucun arrêt saisi.</div>';
    } else {
      const sorted = [...entries].sort((a,b) => a.d1 < b.d1 ? -1 : 1);
      list.innerHTML = '<div class="entry-list-wrap">' + sorted.map((e,i) => `
        <div class="entry-item${editingId === e.id ? ' editing' : ''}">
          <div style="min-width:0">
            <div class="entry-num">Arrêt n°${i+1}${editingId === e.id ? ' — <em>en cours de modification</em>' : ''}</div>
            <div class="entry-lbl">${e.label}</div>
            <div class="entry-dates">${fmtD(e.d1)} → ${fmtD(e.d2)}</div>
          </div>
          <div class="entry-actions">
            <span class="entry-badge">${e.dur} j</span>
            <button class="icon-btn-edit" onclick="startEdit(${e.id});switchTab('saisie',document.querySelector('.tab'))" title="Modifier">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="icon-btn" onclick="removeEntry(${e.id})" title="Supprimer">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2 3.5h10M5.5 3.5V2.5h3v1M3 3.5l.8 8h6.4l.8-8"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>`).join('') + '</div>';
    }
  }

  /* Corbeille */
  const tc = document.getElementById('trash-count');
  if (tc) tc.textContent = trash.length;
  const tl = document.getElementById('trash-list');
  if (tl) {
    tl.innerHTML = !trash.length
      ? '<div style="padding:12px;font-size:12px;color:#a8b4cc;text-align:center">Corbeille vide.</div>'
      : trash.map(e => `
          <div class="entry-item" style="opacity:.65;margin:5px 8px;border-left-color:#a8b4cc">
            <div style="min-width:0">
              <div class="entry-lbl" style="font-size:12px">${e.label}</div>
              <div class="entry-dates">${fmtD(e.d1)} → ${fmtD(e.d2)} · ${e.dur} j · ${e.deletedAt}</div>
            </div>
            <button class="restore-btn" onclick="restoreEntry(${e.id})">Restaurer</button>
          </div>`).join('');
  }
}

/* ── TABS ────────────────────────────────────── */
function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  el.classList.add('active');
  if (tab === 'saisie') { drawFrise(); updateAll(); }
  if (tab === 'dashboard') updateAll();
}

function toggleTrash() {
  document.getElementById('trash-list')?.classList.toggle('visible');
}

/* ── INIT ────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  drawFrise();
  updateAll();
});

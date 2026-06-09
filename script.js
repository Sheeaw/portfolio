/* ---------- CURSOR ---------- */
const cursor = document.getElementById('cursor');
const ring   = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  mx = e.clientX; 
  my = e.clientY;
  cursor.style.left = mx + 'px';
  cursor.style.top  = my + 'px';
});

function animateRing() {
  rx += (mx - rx) * 0.12;
  ry += (my - ry) * 0.12;
  ring.style.left = rx + 'px';
  ring.style.top  = ry + 'px';
  requestAnimationFrame(animateRing);
}
animateRing();

document.querySelectorAll('a, button, .depth-content, .depth-link, .depth-project-item').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursor.style.width = '18px';
    cursor.style.height = '18px';
    ring.style.width = '52px';
    ring.style.height = '52px';
    ring.style.borderColor = 'rgba(0,180,216,0.8)';
  });
  el.addEventListener('mouseleave', () => {
    cursor.style.width = '10px';
    cursor.style.height = '10px';
    ring.style.width = '36px';
    ring.style.height = '36px';
    ring.style.borderColor = 'rgba(0,180,216,0.5)';
  });
});

/* ---------- NAV SCROLL ---------- */
const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
});

/* ---------- MOBILE MENU ---------- */
function toggleMenu() {
  document.getElementById('nav-links').classList.toggle('open');
}

document.querySelectorAll('.nav-links a').forEach(l => l.addEventListener('click', () => {
  document.getElementById('nav-links').classList.remove('open');
}));

/* ---------- WAVE CANVAS ---------- */
(() => {
  const canvas = document.getElementById('wave-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, t = 0;

  const waves = [
    { amp: 60, freq: 0.008, speed: 0.012, color: '0,119,182',   alpha: 0.5, y: 0.55 },
    { amp: 45, freq: 0.012, speed: 0.018, color: '0,180,216',   alpha: 0.4, y: 0.62 },
    { amp: 35, freq: 0.018, speed: 0.009, color: '144,224,239', alpha: 0.25, y: 0.70 },
    { amp: 25, freq: 0.025, speed: 0.022, color: '202,240,248', alpha: 0.15, y: 0.78 },
  ];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    waves.forEach(w => {
      ctx.beginPath();
      const baseY = H * w.y;
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= W; x += 3) {
        const y = baseY + Math.sin(x * w.freq + t * w.speed) * w.amp
                         + Math.cos(x * w.freq * 0.5 + t * w.speed * 0.7) * (w.amp * 0.4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.fillStyle = `rgba(${w.color},${w.alpha})`;
      ctx.fill();
    });
    t++;
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize(); 
  draw();
})();

/* ---------- SCROLL REVEAL ---------- */
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(entries => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 80);
    }
  });
}, { threshold: 0.12 });

reveals.forEach(el => observer.observe(el));

/* ---------- SKILL BARS ---------- */
const barObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const fill = e.target.querySelector('.skill-bar-fill');
      if (fill) fill.style.width = fill.dataset.width;
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.skill-card').forEach(c => barObserver.observe(c));

/* ---------- DEPTH GAUGE TIMELINE ---------- */
const depthSteps = document.querySelectorAll('.depth-step');
const depthObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
    }
  });
}, { threshold: 0.2 });

depthSteps.forEach(step => depthObserver.observe(step));
// ============================================
// AURUM — Sales Page Interactions
// ============================================

// Scroll reveal with IntersectionObserver
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.transitionDelay = `${i * 80}ms`;
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('[data-reveal]').forEach((el) => {
  revealObserver.observe(el);
});

// Counter animation
function animateCounters() {
  const counters = document.querySelectorAll('[data-count]');
  counters.forEach((counter) => {
    if (counter.dataset.animated) return;

    const target = parseFloat(counter.dataset.count);
    const duration = 1800;
    const start = performance.now();

    const isDecimal = target % 1 !== 0;

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out quartic
      const eased = 1 - Math.pow(1 - progress, 4);
      const current = target * eased;

      if (isDecimal) {
        counter.textContent = current.toFixed(1);
      } else {
        counter.textContent = Math.floor(current).toLocaleString('es-AR');
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        counter.dataset.animated = 'true';
      }
    }

    requestAnimationFrame(update);
  });
}

// Observe hero stats and savings for counter trigger
const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCounters();
      }
    });
  },
  { threshold: 0.3 }
);

document.querySelectorAll('.hero-stats, .savings-number, .metric-ring-value').forEach((el) => {
  counterObserver.observe(el);
});

// Metric ring animation
const ringObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const rings = entry.target.querySelectorAll('.metric-ring-fill');
        rings.forEach((ring) => {
          const target = parseFloat(ring.dataset.target);
          const offset = parseFloat(ring.dataset.offset);
          ring.style.strokeDashoffset = offset;
        });
        ringObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.3 }
);

document.querySelectorAll('.metrics-grid').forEach((el) => {
  ringObserver.observe(el);
});

// Nav scroll effect
const nav = document.getElementById('nav');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const currentScroll = window.scrollY;
  nav.classList.toggle('scrolled', currentScroll > 60);
  lastScroll = currentScroll;
}, { passive: true });

// Smooth scroll for nav links
document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Parallax on hero mockup
const heroMockup = document.querySelector('.hero-mockup');
if (heroMockup && window.innerWidth > 768) {
  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    const rate = scrolled * 0.15;
    heroMockup.style.transform = `translateY(${rate}px)`;
  }, { passive: true });
}

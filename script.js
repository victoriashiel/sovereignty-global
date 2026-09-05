const nav = document.querySelector('.primary-nav');
let navToggle = document.querySelector('.nav-toggle');
if (nav && !navToggle) {
  navToggle = document.createElement('button');
  navToggle.className = 'nav-toggle';
  navToggle.type = 'button';
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-controls', nav.id || 'primary-nav');
  if (!nav.id) nav.id = 'primary-nav';
  navToggle.innerHTML = '<span></span><span></span><span></span><span class="sr-only">Toggle menu</span>';
  nav.parentNode.insertBefore(navToggle, nav);
}
if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }));
}

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

// Use the SG motif from a root-level asset path so Cloudflare serves it consistently.
const motifSrc = '/favicon.png?v=20260901d';
const footerBrand = document.querySelector('.site-footer .footer-brand');
if (footerBrand) {
  let motifLink = footerBrand.querySelector('.footer-motif');
  const oldBrand = footerBrand.querySelector('.brand');

  if (!motifLink && oldBrand) {
    motifLink = document.createElement('a');
    motifLink.className = 'footer-motif';
    motifLink.href = '/';
    motifLink.setAttribute('aria-label', 'Sovereignty Global home');
    oldBrand.replaceWith(motifLink);
  }

  if (motifLink) {
    let motif = motifLink.querySelector('img');
    if (!motif) {
      motif = document.createElement('img');
      motif.alt = '';
      motifLink.appendChild(motif);
    }
    motif.src = motifSrc;
    motif.width = 88;
    motif.height = 88;
    motif.style.display = 'block';
    motif.style.width = '88px';
    motif.style.height = '88px';
    motif.style.objectFit = 'contain';
  }
}

// Explicit favicon for pages that load the shared script. A root favicon.ico is also committed
// so portal/staff pages and browsers that do not execute this script still get the motif.
let favicon = document.querySelector('link[rel~="icon"]');
if (!favicon) {
  favicon = document.createElement('link');
  favicon.rel = 'icon';
  document.head.appendChild(favicon);
}
favicon.type = 'image/png';
favicon.href = motifSrc;

// Cookie notice. We only set a strictly-necessary session cookie, so this is
// an informational notice (not a consent gate). Dismissal is remembered in
// local storage. Built in JS so it can share one implementation across pages.
(function cookieNotice() {
  try { if (localStorage.getItem('sg-cookie-notice') === 'dismissed') return; } catch (e) {}
  const bar = document.createElement('div');
  bar.className = 'cookie-notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Cookie notice');
  const text = document.createElement('p');
  text.innerHTML = 'We use a single strictly-necessary cookie to keep you signed in to the client portal. We don’t use tracking or advertising cookies. See our <a href="/privacy.html">Privacy &amp; Cookie Policy</a>.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cookie-notice__dismiss';
  button.textContent = 'Got it';
  button.addEventListener('click', () => {
    bar.remove();
    try { localStorage.setItem('sg-cookie-notice', 'dismissed'); } catch (e) {}
  });
  bar.append(text, button);
  document.body.appendChild(bar);
})();

const signupForm = document.querySelector('.signup-form');
if (signupForm) signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = signupForm.querySelector('button');
  const input = signupForm.querySelector('input');
  button.textContent = 'Subscribed'; input.value = '';
  setTimeout(() => { button.textContent = 'Subscribe'; }, 2500);
});

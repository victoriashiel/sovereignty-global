const iconStyles = document.createElement('link');
iconStyles.rel = 'stylesheet';
iconStyles.href = 'icons.css';
document.head.appendChild(iconStyles);

// Load the lightweight homepage hero as a runtime Blob URL.
// This avoids Cloudflare's binary/static asset issues while keeping the image local to the repo.
(async () => {
  try {
    const response = await fetch('assets/hero-banner.b64', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Hero asset request failed: ${response.status}`);

    const encoded = (await response.text()).trim();
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    document.documentElement.style.setProperty('--hero-runtime-image', `url("${objectUrl}")`);
    document.documentElement.classList.add('hero-image-ready');
  } catch (error) {
    console.error('Unable to load homepage hero image.', error);
  }
})();

const heroRuntimeStyles = document.createElement('style');
heroRuntimeStyles.textContent = `
  .hero-image-ready .hero::before {
    background-image:
      linear-gradient(90deg, #17233C 0%, #17233C 30%, rgba(23,35,60,.98) 36%, rgba(23,35,60,.90) 43%, rgba(23,35,60,.68) 50%, rgba(23,35,60,.40) 57%, rgba(23,35,60,.16) 64%, rgba(23,35,60,0) 74%),
      var(--hero-runtime-image) !important;
    background-size: cover !important;
    background-position: center right !important;
    background-repeat: no-repeat !important;
  }
  @media (max-width: 1100px) {
    .hero-image-ready .hero::before {
      background-image:
        linear-gradient(90deg, #17233C 0%, rgba(23,35,60,.98) 34%, rgba(23,35,60,.80) 48%, rgba(23,35,60,.34) 62%, rgba(23,35,60,.04) 78%),
        var(--hero-runtime-image) !important;
    }
  }
  @media (max-width: 820px) {
    .hero-image-ready .hero::before {
      background-image:
        linear-gradient(180deg, rgba(23,35,60,1) 0%, rgba(23,35,60,.98) 34%, rgba(23,35,60,.86) 52%, rgba(23,35,60,.50) 72%, rgba(23,35,60,.20) 100%),
        var(--hero-runtime-image) !important;
      background-position: 64% center !important;
    }
  }
`;
document.head.appendChild(heroRuntimeStyles);

const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.primary-nav');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

const signupForm = document.querySelector('.signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = signupForm.querySelector('button');
    const input = signupForm.querySelector('input');
    button.textContent = 'Subscribed';
    input.value = '';
    setTimeout(() => { button.textContent = 'Subscribe'; }, 2500);
  });
}

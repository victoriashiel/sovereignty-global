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

const signupForm = document.querySelector('.signup-form');
if (signupForm) signupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = signupForm.querySelector('button');
  const input = signupForm.querySelector('input');
  button.textContent = 'Subscribed'; input.value = '';
  setTimeout(() => { button.textContent = 'Subscribe'; }, 2500);
});

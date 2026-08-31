const iconStyles = document.createElement('link');
iconStyles.rel = 'stylesheet';
iconStyles.href = 'icons.css';
document.head.appendChild(iconStyles);

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

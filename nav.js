document.addEventListener('DOMContentLoaded', () => {
  const headerRight = document.querySelector('.header-right');
  const nav = document.querySelector('.app-nav');
  if (!headerRight || !nav) return;

  const btn = document.createElement('button');
  btn.className = 'btn-hamburger';
  btn.setAttribute('aria-label', 'Open menu');
  btn.textContent = '☰';
  headerRight.prepend(btn);

  function openMenu() {
    nav.classList.add('nav-open');
    btn.textContent = '✕';
    btn.setAttribute('aria-label', 'Close menu');
  }

  function closeMenu() {
    nav.classList.remove('nav-open');
    btn.textContent = '☰';
    btn.setAttribute('aria-label', 'Open menu');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    nav.classList.contains('nav-open') ? closeMenu() : openMenu();
  });

  // Close when clicking outside
  document.addEventListener('click', closeMenu);
  nav.addEventListener('click', e => e.stopPropagation());

  // Close on nav link click (handles same-page links)
  nav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
});

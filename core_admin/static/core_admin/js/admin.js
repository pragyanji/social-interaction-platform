/* ═══════════════════════════════════════════
   ChatSphere Admin — JS
   ═══════════════════════════════════════════ */
(() => {
  'use strict';

  const STORAGE_KEY = 'chatsphere_sidebar_collapsed';

  /* ── DOM refs ──────────────────────────── */
  const body          = document.body;
  const sidebar       = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const hamburgerBtn  = document.getElementById('hamburgerBtn');

  /* ── Create mobile overlay ────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  /* ── Sidebar collapse (desktop) ───────── */
  function applySavedState() {
    const collapsed = localStorage.getItem(STORAGE_KEY) === '1';
    body.classList.toggle('sidebar-collapsed', collapsed);
  }
  applySavedState();

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const willCollapse = !body.classList.contains('sidebar-collapsed');
      body.classList.toggle('sidebar-collapsed', willCollapse);
      localStorage.setItem(STORAGE_KEY, willCollapse ? '1' : '0');
    });
  }

  /* ── Mobile hamburger ─────────────────── */
  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('show');
  }
  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('show');
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', () => {
      sidebar.classList.contains('mobile-open')
        ? closeMobileSidebar()
        : openMobileSidebar();
    });
  }
  overlay.addEventListener('click', closeMobileSidebar);

  /* ── Auto-dismiss alerts ──────────────── */
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease, transform .4s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 400);
    }, 5000);
  });

  /* ── Search form: submit on Enter ─────── */
  document.querySelectorAll('.search-box input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.target.closest('form')?.submit();
      }
    });
  });

})();

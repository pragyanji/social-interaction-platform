// Safe helpers
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// 0) Profile dropdown toggle
(function initProfileDropdown() {
  const btn = $("#profileBtn");
  const menu = $("#profileMenu");

  console.log('Initializing profile dropdown:', { hasBtn: !!btn, hasMenu: !!menu });

  if (!btn || !menu) {
    console.error('Profile dropdown elements not found!');
    return;
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    console.log('Profile button clicked, toggling menu');
    menu.classList.toggle("show");
  });

  // Prevent menu from closing when clicking inside it
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove("show");
    }
  });

  // Close on escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("show")) {
      menu.classList.remove("show");
      btn.focus();
    }
  });
})();

// 1) Auto-dismiss Django messages after 5s (click to dismiss sooner)
(function initMessages() {
  const items = $$(".messages .msg");
  if (!items.length) return;
  items.forEach((el) => {
    const dismiss = () => {
      el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      el.style.opacity = "0";
      el.style.transform = "translateX(40px)";
      setTimeout(() => el.remove(), 320);
    };
    el.addEventListener("click", dismiss, { once: true });
    setTimeout(dismiss, 5000);
  });
})();

// 2) Prevent double form submits
(function preventDoubleSubmit() {
  $$("form").forEach((form) => {
    form.addEventListener("submit", () => {
      const btn = $("button[type=submit],input[type=submit]", form);
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = "Please wait…";
        setTimeout(() => { btn.disabled = false; btn.textContent = btn.dataset.originalText || "Submit"; }, 5000);
      }
    });
  });
})();

// 3) CSRF helper for future fetch() calls (if you use AJAX later)
function getCookie(name) {
  const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return m ? m.pop() : "";
}
function csrfHeader() {
  return { "X-CSRFToken": getCookie("csrftoken") };
}

// 4) Optional: password reveal toggles (only if you add data-toggle="password")
(function passwordToggles() {
  $$('input[type="password"][data-toggle="password"]').forEach((inp) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small";
    btn.style.marginTop = "6px";
    btn.textContent = "Show password";
    inp.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.textContent = show ? "Hide password" : "Show password";
      inp.focus();
    });
  });
})();

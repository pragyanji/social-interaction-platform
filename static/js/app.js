// Safe helpers
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

// 0) Profile dropdown toggle
(function initProfileDropdown(){
  const btn = $("#profileBtn");
  const menu = $("#profileMenu");
  if(!btn || !menu) return;
  
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("show");
  });
  
  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if(!menu.contains(e.target) && !btn.contains(e.target)){
      menu.classList.remove("show");
    }
  });
  
  // Close on escape key
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && menu.classList.contains("show")){
      menu.classList.remove("show");
      btn.focus();
    }
  });
})();

// 1) Auto-dismiss Django messages after 5s (click to dismiss sooner)
(function initMessages(){
  const items = $$(".messages .msg");
  items.forEach((el) => {
    const close = () => {
      el.classList.add("fade-out");
      setTimeout(() => el.remove(), 300); // Wait for animation to complete
    };
    el.addEventListener("click", close, { once:true });
    setTimeout(close, 5000); // Auto-dismiss after 5 seconds
  });
})();

// 2) Prevent double form submits
(function preventDoubleSubmit(){
  $$("form").forEach((form) => {
    form.addEventListener("submit", () => {
      const btn = $("button[type=submit],input[type=submit]", form);
      if(btn){
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = "Please wait…";
        setTimeout(() => { btn.disabled = false; btn.textContent = btn.dataset.originalText || "Submit"; }, 5000);
      }
    });
  });
})();

// 3) CSRF helper for future fetch() calls (if you use AJAX later)
function getCookie(name){
  const m = document.cookie.match('(^|;)\\s*'+name+'\\s*=\\s*([^;]+)');
  return m ? m.pop() : "";
}
function csrfHeader(){
  return { "X-CSRFToken": getCookie("csrftoken") };
}

// 4) Optional: password reveal toggles (only if you add data-toggle="password")
(function passwordToggles(){
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

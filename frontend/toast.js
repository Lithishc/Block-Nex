const TOAST_CONTAINER_ID = "app-toast-container";

function ensureToastContainer() {
  let c = document.getElementById(TOAST_CONTAINER_ID);
  if (!c) {
    c = document.createElement("div");
    c.id = TOAST_CONTAINER_ID;
    c.style.cssText = `
      position:fixed;top:18px;right:18px;z-index:4000;
      display:flex;flex-direction:column;gap:10px;`;
    document.body.appendChild(c);
  }
  return c;
}

export function showToast(msg, variant="info", timeout=3500) {
  const container = ensureToastContainer();
  const div = document.createElement("div");
  const colorMap = {
    info: "#1956a3",
    success: "#1b8642",
    warn: "#cc8a00",
    error: "#c62828"
  };
  div.style.cssText = `
    background:#fff;border-left:6px solid ${colorMap[variant] || "#1956a3"};
    box-shadow:0 6px 24px rgba(0,0,0,.14);
    padding:12px 16px 12px 14px;border-radius:14px;
    font:600 14px 'Segoe UI',Arial,sans-serif;min-width:240px;
    color:#1f2937;position:relative;animation:toastIn .3s ease;`;
  div.innerHTML = `<span style="display:block;line-height:1.35">${msg}</span>
    <button style="position:absolute;top:2px;right:6px;border:none;background:transparent;
      font-size:16px;cursor:pointer;color:#5a6b85;">×</button>`;
  div.querySelector("button").onclick = () => container.removeChild(div);
  container.appendChild(div);
  setTimeout(()=>{ if (div.isConnected) container.removeChild(div); }, timeout);
}

if (!document.getElementById("toast-anim-style")) {
  const style = document.createElement("style");
  style.id = "toast-anim-style";
  style.textContent = `
    @keyframes toastIn {from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);} }`;
  document.head.appendChild(style);
}
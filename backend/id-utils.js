export function generateStandardId(type = "GEN") {
  // prefixes: PRC=procurement, ORD=order, OFR=offer
  const map = { procurement: "PRC", order: "ORD", offer: "OFR", userProcurement: "UPR" };
  const prefix = map[type] || map["GEN"] || "GEN";
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const time = `${y}${m}${dd}${hh}${mm}${ss}`;
  // short random 4 chars A-Z0-9
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(n => ("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")[n % 36]).join("");
  return `${prefix}-${time}-${rnd}`;
}
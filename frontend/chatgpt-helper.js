export async function getSeasonalDemand(itemName) {
  try {
    const r = await fetch(
      `http://localhost:3000/api/chatgpt-seasonal-demand?item=${encodeURIComponent(itemName)}`,
      { cache: "no-store" }
    );
    if (!r.ok) return null;
    return await r.json(); // { demand, reason, recommendation }
  } catch {
    return null;
  }
}

export async function getMarketDemand(itemName) {
  try {
    const r = await fetch(
      `http://localhost:3000/api/chatgpt-seasonal-demand?item=${encodeURIComponent(itemName)}&type=market`,
      { cache: "no-store" }
    );
    if (!r.ok) return null;
    return await r.json(); // { demand, reason, recommendation }
  } catch {
    return null;
  }
}
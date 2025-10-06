export async function getSeasonalDemand(itemName) {
  const response = await fetch(`http://localhost:3000/api/chatgpt-seasonal-demand?item=${encodeURIComponent(itemName)}`);
  if (!response.ok) return null;
  return await response.json(); // { demand: true/false, reason: "...", recommendation: "Seasonal ↑" or "Seasonal ↓" }
}
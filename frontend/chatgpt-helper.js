export async function getSeasonalDemand(itemName) {
  const response = await fetch(`https://us-central1-smartsupplychain-86c30.cloudfunctions.net/api/chatgpt-seasonal-demand?item=${encodeURIComponent(itemName)}`);
  if (!response.ok) return null;
  return await response.json(); // { demand: true/false, reason: "...", recommendation: "Seasonal ↑" or "Seasonal ↓" }
}
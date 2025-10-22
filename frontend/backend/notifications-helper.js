import { db } from "../../functions/firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

/**
 * Creates a notification for a target user.
 * payload: { type, title, body, related?: {}, extra?: {} }
 */
export async function createNotification(targetUid, payload) {
  if (!targetUid) return;
  try {
    await addDoc(collection(db, "users", targetUid, "notifications"), {
      ...payload,
      related: payload.related || {},
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("createNotification failed:", e);
  }
}
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { db } from "./firebase-config.js";
import { collection, orderBy, query, onSnapshot, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const auth = getAuth();
const listEl = document.getElementById('notifs-list');

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  const q = query(
    collection(db, "users", user.uid, "notifications"),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snap) => {
    listEl.innerHTML = "";
    if (snap.empty) {
      listEl.innerHTML = "<p>No notifications.</p>";
      return;
    }
    snap.docs.forEach(d => {
      const n = d.data();
      const ts = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : "";
      let idInfo = "";
      if (n.related) {
        switch (n.type) {
          case "procurement_created":
            if (n.related.globalProcurementId)
              idInfo = `<div class="notif-id">Procurement ID: ${n.related.globalProcurementId}</div>`;
            break;
          case "offer_received":
          case "offer_accepted":
          case "offer_rejected":
            if (n.related.offerId)
              idInfo = `<div class="notif-id">Offer ID: ${n.related.offerId}</div>`;
            break;
          case "order_created":
          case "order_status":
            if (n.related.globalOrderId)
              idInfo = `<div class="notif-id">Order ID: ${n.related.globalOrderId}</div>`;
            break;
          default:
            idInfo = "";
        }
      }
      const card = document.createElement("div");
      card.className = "notif-card" + (n.read ? "" : " unread");
      card.innerHTML = `
        <div class="notif-main">
          <div class="notif-title">${n.title || n.type}</div>
          ${idInfo}
          <div class="notif-body">${n.body || ""}</div>
          <div class="notif-meta">${ts}</div>
        </div>
        <div class="notif-actions">
          ${n.read ? "" : `<button class="mark-btn">Mark Read</button>`}
        </div>
      `;
      if (!n.read) {
        card.querySelector(".mark-btn").onclick = async () => {
          await updateDoc(doc(db, "users", user.uid, "notifications", d.id), { read: true });
        };
      }
      listEl.appendChild(card);
    });
  });
});
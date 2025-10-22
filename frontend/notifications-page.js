import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { db } from "./firebase-config.js";
import { collection, orderBy, query, onSnapshot, updateDoc, doc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const auth = getAuth();
const listEl = document.getElementById('notifs-list');

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  // If the static page had a heading, remove it so we won't have duplicates
  const staticHeading = document.querySelector('.container h2');
  if (staticHeading) staticHeading.remove();

  // create header with "Mark all as read" button aligned with list start
  const existingHeader = document.querySelector('.page-header');
  if (!existingHeader) {
    const header = document.createElement('div');
    header.className = 'page-header';
    // heading first (left), button last (right) so CSS justify-content:space-between places them correctly
    header.innerHTML = `<h1>Your Notifications</h1><button class="mark-all-btn" id="mark-all-btn">Mark all as read</button>`;
    // insert header before the notifications list
    listEl.parentNode.insertBefore(header, listEl);
    const markAllBtn = header.querySelector('#mark-all-btn');
    markAllBtn.onclick = async () => {
      markAllBtn.disabled = true;
      markAllBtn.textContent = 'Marking...';
      try {
        const collRef = collection(db, "users", user.uid, "notifications");
        const snap = await getDocs(collRef);
        const batch = writeBatch(db);
        let updated = 0;
        snap.docs.forEach(d => {
          const data = d.data();
          if (!data.read) {
            batch.update(doc(db, "users", user.uid, "notifications", d.id), { read: true });
            updated++;
          }
        });
        if (updated > 0) await batch.commit();
        markAllBtn.textContent = updated > 0 ? `Marked ${updated}` : 'No unread';
      } catch (err) {
        console.error(err);
        markAllBtn.textContent = 'Try again';
      } finally {
        setTimeout(() => {
          markAllBtn.disabled = false;
          markAllBtn.textContent = 'Mark all as read';
        }, 1200);
      }
    };
  }

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
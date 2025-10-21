import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { db } from "../functions/firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const auth = getAuth();

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  // Listen to this user's open procurement requests
  const q = query(
    collection(db, "users", user.uid, "procurementRequests"),
    where("status", "==", "open")
  );
  onSnapshot(q, (snap) => {
    let pendingCount = 0;
    snap.docs.forEach(d => {
      const data = d.data();
      const responses = Array.isArray(data.supplierResponses) ? data.supplierResponses : [];
      // Count offers not yet accepted/rejected (status missing or 'pending')
      responses.forEach(r => {
        const st = (r?.status || "pending").toLowerCase();
        if (st === "pending") pendingCount++;
      });
    });
    const badge = document.getElementById("offers-badge");
    if (!badge) return;
    if (pendingCount > 0) {
      badge.textContent = pendingCount > 99 ? "99+" : String(pendingCount);
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  });
});
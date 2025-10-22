import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { db } from "../../functions/firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  const q = query(
    collection(db, "users", user.uid, "notifications"),
    where("read", "==", false)
  );
  onSnapshot(q, (snap) => {
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    const count = snap.size;
    if (count === 0) {
      badge.style.display = "none";
    } else {
      badge.textContent = count;
      badge.style.display = "inline-block";
    }
  });
});
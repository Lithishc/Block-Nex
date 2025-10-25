import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { app } from "../../functions/firebase-config.js"; 

const auth = getAuth(app);
const db = getFirestore(app);

export function loadNavbar() {
  fetch('../frontend/navbar.html')
    .then(response => response.text())
    .then(data => {
      document.getElementById('navbar-placeholder').innerHTML = data;

      // Highlight active tab
      const path = window.location.pathname.split('/').pop();
      let pageName = "";
      document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href') === path) {
          link.classList.add('active');
          // Get only the text node (not badge)
          pageName = Array.from(link.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
        }
      });
      // Set page name beside hamburger for mobile
      const pageNameSpan = document.querySelector('.navbar-page-name');
      if (pageNameSpan) pageNameSpan.textContent = pageName;

      // Set spinner or blank immediately
      const usernameSpan = document.getElementById('navbar-username');
      if (usernameSpan) {
        usernameSpan.textContent = localStorage.getItem("navbarUsername") || "...";
        usernameSpan.classList.add("loading");
      }

      // Show username and handle logout
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          // Fetch username from Firestore
          const userDoc = await getDoc(doc(db, "users", user.uid));
          let username = localStorage.getItem("navbarUsername") || "";
          if (userDoc.exists()) {
            if (userDoc.data().username) {
              username = userDoc.data().username;
            } else if (userDoc.data().name) {
              username = userDoc.data().name;
            }
          } else if (user.displayName) {
            username = user.displayName;
          } else if (user.email) {
            username = user.email.split('@')[0];
          }
          localStorage.setItem("navbarUsername", username); // Update cache
          if (usernameSpan) {
            usernameSpan.textContent = username;
            usernameSpan.classList.remove("loading");
          }
        }
      });

      // Logout functionality
      const logoutLink = document.getElementById('logout-link');
      if (logoutLink) {
        logoutLink.addEventListener('click', async (e) => {
          e.preventDefault();
          await signOut(auth);
          localStorage.removeItem("navbarUsername"); // Clear cache on logout
          window.location.href = "../frontend/index.html";
        });
      }

      // Hamburger menu toggle
      window.toggleNavbarMenu = function() {
        const links = document.querySelector('.navbar-links');
        if (links) links.classList.toggle('open');
      };
    });
}
// Sh0rtcut for loading the active navbar
/*
<div id="navbar-placeholder"></div>
<script src="navbar.js"></script>
<script>loadNavbar();</script>

or 
<div id="navbar-placeholder"></div>
<script type="module">
  import { loadNavbar } from './navbar.js';
  loadNavbar();
</script>
*/


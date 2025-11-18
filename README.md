# 🚀 Block Nex (In Development)

A modern, web-based **Block Nex (Supply Chain Management System)** designed to automate inventory tracking, procurement, and supplier-retailer interactions — with advanced AI-powered analytics and planned integration of blockchain and digital certificate contracts for transparency, traceability, and trust.

> 🎓 **Final Year B.E. Project (2025)**  
> Developed as part of the Bachelor of Engineering (B.E.) curriculum for academic submission and research.  
> ⚠️ This project is currently under development. Blockchain components are yet to be added.

---

## 🔧 Features

### 👨‍💼 Retailer Module
- Add, edit, and manage inventory items
- Set preset reorder levels per item
- Auto-generate procurement requests when stock falls below thresholds
- **AI-powered inventory trend analysis:**  
  Automatically analyzes inventory history to suggest if an item is high-selling or low-selling, helping retailers adjust procurement quantities.
- View supplier offers and accept/reject them
- Track order status and update inventory on fulfillment

### 🤝 Supplier Module
- View open procurement requests from retailers
- Submit competitive offers with pricing and details
- Receive orders automatically upon offer acceptance

### 📦 Order Management
- Orders auto-generated upon offer acceptance
- Track orders for both retailers and suppliers
- Retailers can mark orders as fulfilled and update stock

### 🔔 Notification System
- Real-time notifications for procurement, offers, and orders
- Notification UI separated for clarity and maintainability

### 🤖 AI & Analytics
- **Inventory trend prediction:**  
  Uses local machine learning logic to analyze inventory history and provide actionable recommendations (e.g., "Trend ↑" for high-selling, "Trend ↓" for low-selling items).
- Seasonal demand forecasting using AI

---

## 🧱 Tech Stack

| Layer       | Technology                                      |
|-------------|-------------------------------------------------|
| Frontend    | HTML, CSS, Vanilla JS                           |
| Backend     | Node.js, Firebase Firestore (NoSQL)             |
| Auth        | Firebase Authentication                         |
| Hosting     | Firebase / GitHub Pages                         |
| AI/ML       | Custom JS logic, Gemini API, OpenAI (planned)   |
| Blockchain  | Smart Contracts, Digital Certificate Contracts (planned) |
| Utilities   | dotenv                                          |

---

## 📁 Project Structure

```
Block Nex/
 frontend/
│   ├── dashboard.html, dashboardstyle.css
│   ├── inventory.html, inventorystyle.css
│   ├── procurement.html, procurementstyle.css
│   ├── MarketPlace.html, MarketPlacestyle.css
│   ├── orders.html, ordersstyle.css
│   ├── offers.html, offers.css
│   ├── notifications.html, notificationsstyle.css
│   ├── profile.html, profile.css
│   ├── registry.html
│   ├── supplier-details.html, supplier-details.css
│   ├── navbar.html, navbar.css
│   ├── loginstyle.css
│   ├── firebase-config.js
│   ├── inventory.js
│   ├── procurement.js
│   ├── MarketPlace.js
│   ├── offers.js
│   ├── order.js
│   ├── notifications-listener.js
│   ├── notifications-helper.js
│   ├── notifications-page.js
│   ├── offers-badge-listener.js
│   ├── navbar.js
│   ├── profile.js
│   ├── loginscript.js
│   ├── registerscript.js
│   ├── supplier-details.js
│   ├── toast.js
│   ├── ml-inventory-trend.js   # <--- AI inventory trend logic
│   └── ...
├── index.html
└── README.md

---

## 📄 Key Modules & Pages

- **Inventory:** `inventory.html`, `inventory.js`
- **Procurement:** `procurement.html`, `procurement.js`
- **Marketplace (Supplier):** `MarketPlace.html`, `MarketPlace.js`
- **Orders:** `orders.html`, `order.js`
- **Offers:** `offers.html`, `offers.js`
- **Notifications:** `notifications.html`, `notifications-listener.js`, `notifications-helper.js`
- **Profile:** `profile.html`, `profile.js`
- **Supplier Details:** `supplier-details.html`, `supplier-details.js`
- **Navigation:** `navbar.html`, `navbar.js`
- **Authentication:** `loginscript.js`, `registerscript.js`
- **UI Styles:** CSS files per module

---

## 🔮 Upcoming Features

- 🔜 Blockchain integration for procurement lifecycle tracking
- 🔜 Smart contract-based offer acceptance
- 🔜 PDF invoices and procurement reports

---

## 📸 Screenshots

Screenshots coming soon!

---
  ```

## 🚀 Getting Started

To run locally:

Prerequisites (Windows)
- Node.js (LTS) — https://nodejs.org/ — verify:
  ```
  node -v
  npm -v
  ```
- Git
- Firebase CLI (for hosting & Firestore rules):
  ```
  npm install -g firebase-tools
  firebase login
  ```

1) Clone repo
```
git clone https://github.com/Lithishc/Block-Nex.git
cd Block-Nex
```

2) Install dependencies
- Backend (functions/):
```
cd .\functions
npm install
# if you don't have a package.json, install required packages:
npm install express cors dotenv ethers hardhat @nomiclabs/hardhat-ethers firebase-admin
```
- Frontend: no build step required (static). If you add local npm packages for frontend tooling, run npm install in frontend/.

3) Environment variables
- Create functions/.env (do NOT commit this). Example keys:
```
# filepath: functions/.env (example)
GEMINI_API_KEY=your_gemini_api_key
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x...
PORT=3000
```
- Add `.env` and `functions/.env` to .gitignore.

4) ABI & artifacts
- The frontend needs the contract ABI. Copy compiled ABI into the frontend functions folder:
```
# from repo root (PowerShell)
cp .\artifacts\contracts\BlockNexSupply.sol\BlockNexSupply.json .\frontend\functions\abi\BlockNexSupply.json
```
- Do NOT commit full artifacts/ or node_modules/. Use .gitignore.

5) Run backend API locally
```
cd .\functions
node .\server.js
# server should respond at http://localhost:3000/
```
- If you see "Cannot use import statement outside a module", ensure package.json has "type":"module" or run with Node settings matching ES module usage.

6) Serve frontend locally
- Option A (Live Server extension in VS Code): open `frontend/index.html` and run Live Server.
- Option B (simple static server):
```
# from repo root
npx http-server frontend -p 5500
# open http://127.0.0.1:5500/index.html
```

7) Blockchain (compile & deploy)
- Compile with Hardhat:
```
cd .\contracts (or repo root where hardhat.config.js lives)
npx hardhat compile
```
- Deploy (example, adjust network and scripts):
```
npx hardhat run scripts/deploy.js --network sepolia
# copy contract address to functions/.env CONTRACT_ADDRESS
```

8) Firebase Hosting (optional)
```
firebase init hosting
# set public directory -> frontend
firebase deploy --only hosting
```
- If hosting frontend on Firebase, update frontend API base (replace localhost) to your deployed backend URL.

9) Troubleshooting
- 404 for frontend imports: browser modules must be under the served frontend directory (e.g. frontend/functions/*). Ensure missing files are present there.
- If accept-offer fails, check backend logs and Firestore update permissions.
- Etherscan: view transaction at https://sepolia.etherscan.io/tx/<TX_HASH>

---

## 📦 Requirements (quick list)
See `requirements.txt` for npm package recommendations.

---

## License

This project is © 2025 Lithish C and team. All rights reserved.

The code is proprietary and not open-source.  
You are **not permitted** to reuse, distribute, or modify this project in any form.  
For licensing inquiries, contact the author directly.

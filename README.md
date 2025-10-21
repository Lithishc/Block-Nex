# 🚀 Block Nex (In Development)

A modern, web-based **Block Nex (Supply Chain Management System)** designed to automate inventory tracking, procurement, and supplier-dealer interactions — with advanced AI-powered analytics and planned integration of blockchain and digital certificate contracts for transparency, traceability, and trust.

> 🎓 **Final Year B.E. Project (2025)**  
> Developed as part of the Bachelor of Engineering (B.E.) curriculum for academic submission and research.  
> ⚠️ This project is currently under development. Blockchain components are yet to be added.

---

## 🔧 Features

### 👨‍💼 Dealer Module
- Add, edit, and manage inventory items
- Set preset reorder levels per item
- Auto-generate procurement requests when stock falls below thresholds
- **AI-powered inventory trend analysis:**  
  Automatically analyzes inventory history to suggest if an item is high-selling or low-selling, helping dealers adjust procurement quantities.
- View supplier offers and accept/reject them
- Track order status and update inventory on fulfillment

### 🤝 Supplier Module
- View open procurement requests from dealers
- Submit competitive offers with pricing and details
- Receive orders automatically upon offer acceptance

### 📦 Order Management
- Orders auto-generated upon offer acceptance
- Track orders for both dealers and suppliers
- Dealers can mark orders as fulfilled and update stock

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
│   └── ...
├── backend/
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

## 🚀 Getting Started

To run locally:

1. Install [Node.js](https://nodejs.org/) (required for backend and AI features).
2. Clone the repository:
  ```bash
  git clone https://github.com/Lithishc/Block-Nex.git
  ```
3. Install dependencies (including dotenv):
  ```bash
  npm install dotenv
  # or if using package.json:
  npm install
  ```
4. Open the project folder in [Visual Studio Code](https://code.visualstudio.com/()).

## License

This project is © 2025 Lithish C and team. All rights reserved.

The code is proprietary and not open-source.  
You are **not permitted** to reuse, distribute, or modify this project in any form.  
For licensing inquiries, contact the author directly.

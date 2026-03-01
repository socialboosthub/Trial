import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, doc, getDoc, setDoc, onSnapshot, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBrvdknWfFKdl9Bn8TJRrpWEc2RQDEHZqE",
    authDomain: "eggshop-702f6.firebaseapp.com",
    projectId: "eggshop-702f6",
    storageBucket: "eggshop-702f6.firebasestorage.app",
    messagingSenderId: "290586261198",
    appId: "1:290586261198:web:61cd80463c8c2c5f06429f",
    measurementId: "G-HVJKWCER6S"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); 
const provider = new GoogleAuthProvider();

let userLocation = null;
let userPhone = null; // Track user phone number
let currentEggPrice = 385; 
let currentStock = 0; 

// WALLET STATE
let userWalletBalance = 0;
window.currentOrderState = null; 

const MOMBASA_AREAS = [
    "Nyali", "Bamburi", "Tudor", "Kizingo", "Mtwapa", "Likoni", 
    "Changamwe", "Mikindani", "Ganjoni", "Mombasa Island", "Shanzu", "Mkomani",
    "Bombolulu", "Kisauni", "Kongowea", "Mbaraki", "Mama Ngina"
];

const translations = {
    en: { heroTitle: "Bulk Fresh Eggs", navShop: "Shop", navSettings: "Settings", myOrders: "My Orders", setTheme: "Dark Mode", setLanguage: "Language", logout: "Logout", statOrders: "My Orders", prodTray: "Tray of 30", recentActivity: "Recent Activity" },
    sw: { heroTitle: "Mayai Kwa Jumla", navShop: "Duka", navSettings: "Mipangilio", myOrders: "Oda Zangu", setTheme: "Giza", setLanguage: "Lugha", logout: "Ondoka", statOrders: "Oda Zangu", prodTray: "Tray ya 30", recentActivity: "Shughuli za Hivi Karibuni" }
};

// --- AUTH HANDLER ---
onAuthStateChanged(auth, async (user) => {
    const overlay = document.getElementById('login-overlay');
    if (user) {
        if(overlay) overlay.style.display = 'none';
        document.body.classList.remove('not-logged-in');
        
        updateUIWithUser(user);
        await loadUserSettings();
        fetchLivePrice(); 
        listenToOrders();
        listenToNotifications(); 
        listenToUserWallet(); 
    } else {
        if(overlay) overlay.style.display = 'flex';
        document.body.classList.add('not-logged-in');
    }
});

function updateUIWithUser(user) {
    if(document.getElementById('usernameDisplay')) 
        document.getElementById('usernameDisplay').innerText = user.displayName || "Wholesaler";
    if(document.getElementById('userPhoto') && user.photoURL) 
        document.getElementById('userPhoto').src = user.photoURL;
}

window.handleLogin = async () => {
    try { await signInWithPopup(auth, provider); } 
    catch (error) { alert("Login Failed: " + error.message); }
};
const loginBtn = document.getElementById('google-login-btn');
if (loginBtn) loginBtn.onclick = window.handleLogin;

// --- WALLET LOGIC ---
function listenToUserWallet() {
    if (!auth.currentUser) return;
    onSnapshot(doc(db, "users", auth.currentUser.uid), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            userWalletBalance = data.walletBalance || 0;
            
            const walletContainer = document.getElementById('walletContainer');
            const walletDisplay = document.getElementById('walletDisplay');
            if(walletContainer && walletDisplay) {
                if (userWalletBalance > 0) {
                    walletContainer.style.display = 'flex';
                    walletDisplay.innerText = "Ksh " + userWalletBalance.toLocaleString();
                } else {
                    walletContainer.style.display = 'none';
                }
            }
        }
    });
}

// --- DYNAMIC PRICE ---
async function fetchLivePrice() {
    try {
        onSnapshot(doc(db, "config", "pricing"), (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                currentEggPrice = data.currentPrice || 385;
                currentStock = data.currentStock || 0; 
            }
            
            const priceDisplay = document.getElementById('dynamicPriceDisplay');
            if(priceDisplay) priceDisplay.innerText = currentEggPrice;

            const stockDisplay = document.getElementById('stockDisplay');
            if(stockDisplay) {
                if(currentStock > 0) {
                    stockDisplay.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i> ${currentStock} Trays Available`;
                    stockDisplay.style.color = "#2E7D32"; 
                } else {
                    stockDisplay.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Out of Stock`;
                    stockDisplay.style.color = "#F44336"; 
                }
            }
        });
    } catch(e) { console.error("Error fetching price/stock", e); }
}

// --- ORDER LOGIC ---
window.updateQty = (change) => {
    const display = document.getElementById('shopQty');
    let current = parseInt(display.innerText);
    let newVal = current + change;
    if(newVal < 30) newVal = 30;
    display.innerText = newVal;
};

// --- Updated Order Initiation ---
window.initiateOrder = () => {
    if (!auth.currentUser) return alert("Please login first.");
    
    if (!userLocation || !userLocation.address) {
        if(confirm("⚠️ Delivery Location Missing!\n\nPlease set your location to continue.")) {
            window.showPage('settings', document.querySelectorAll('.nav-item')[3]);
            setTimeout(() => window.initLocationFlow(), 500);
        }
        return;
    }

    if (!userPhone) {
        let phoneInput = prompt("⚠️ Phone Number Required!\n\nPlease enter your phone number (e.g., 0712345678) so we can contact you for delivery:");
        if (!phoneInput || !/^(07|01)\d{8}$/.test(phoneInput.trim())) {
            return alert("❌ A valid 10-digit phone number starting with 07 or 01 is required.");
        }
        userPhone = phoneInput.trim();
        setDoc(doc(db, "users", auth.currentUser.uid), { phone: userPhone }, { merge: true });
    }
    
    const quantity = parseInt(document.getElementById('shopQty').innerText);
    if (quantity > currentStock) {
        return alert(`⚠️ Not enough stock! Available: ${currentStock}`);
    }

    const cartTotal = quantity * currentEggPrice;
    let walletDeduction = userWalletBalance > 0 ? Math.min(cartTotal, userWalletBalance) : 0;
    let mpesaRequired = cartTotal - walletDeduction;

    window.currentOrderState = { quantity, cartTotal, walletDeduction, mpesaRequired };

    document.getElementById('summaryQty').innerText = quantity;
    document.getElementById('summaryUnitPrice').innerText = currentEggPrice.toLocaleString();
    document.getElementById('summaryTotal').innerText = mpesaRequired.toLocaleString();
    document.getElementById('amountToPayInstruction').innerText = "Ksh " + mpesaRequired.toLocaleString();

    const walletRow = document.getElementById('summaryWalletRow');
    if (walletDeduction > 0) {
        walletRow.style.display = 'flex';
        document.getElementById('summaryWallet').innerText = walletDeduction.toLocaleString();
    } else {
        walletRow.style.display = 'none';
    }

    document.getElementById('mpesaCodeInput').value = "";
    document.getElementById('mpesa-modal').style.display = 'flex';

    const payBtn = document.getElementById('payBtn');
    if (mpesaRequired === 0) {
        payBtn.innerText = "Complete Order (Paid by Wallet)";
        payBtn.onclick = window.processWalletOnlyOrder;
    } else {
        payBtn.innerText = "Verify Payment";
        payBtn.onclick = window.verifyPayment;
    }
};

window.copyToClipboard = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        btn.style.background = "#4CAF50";
        btn.style.color = "white";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.background = "#FFB300";
            btn.style.color = "black";
        }, 2000);
    });
};

function generateOrderCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- NEW TOP-UP MODAL & LOGIC ---
window.openTopUpModal = () => {
    if (!auth.currentUser) return alert("Please login first to top up your wallet.");
    document.getElementById('topupCodeInput').value = "";
    document.getElementById('topup-modal').style.display = 'flex';
};





// --- SECURE TOP UP CALL ---
window.processTopUp = async () => {
    const codeInput = document.getElementById('topupCodeInput').value.toUpperCase().trim();
    const btn = document.getElementById('topupBtn');
    if (codeInput.length < 10) return alert("Please enter a valid 10-character M-Pesa code.");

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Verifying...`;

    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/api/topup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ mpesaCode: codeInput })
        });
        
        const data = await response.json();
        if (data.success) {
            document.getElementById('topup-modal').style.display = 'none';
            alert(data.message);
        } else {
            alert("❌ " + data.error);
        }
    } catch (err) {
        alert("Connection Error. Please check your internet.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Verify & Add Funds";
    }
};

// --- SECURE CHECKOUT CALLS ---
async function sendSecureCheckoutRequest(payload, btnElement, defaultBtnText) {
    btnElement.disabled = true;
    btnElement.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;

    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (data.success) {
            document.getElementById('mpesa-modal').style.display = 'none';
            alert(data.message);
            window.showPage('orders', document.querySelectorAll('.nav-item')[2]);
            generateWhatsAppLink(payload.orderState.quantity, payload.orderState.cartTotal, payload.userLocation.address, data.deliveryCode);
        } else {
            alert("❌ " + data.error);
        }
    } catch (err) {
        alert("Order failed. Please check your connection.");
    } finally {
        btnElement.disabled = false;
        btnElement.innerText = defaultBtnText;
    }
}

window.processWalletOnlyOrder = async () => {
    const btn = document.getElementById('payBtn');
    const payload = { 
        isWalletOnly: true, orderState: window.currentOrderState, 
        userPhone, userLocation 
    };
    await sendSecureCheckoutRequest(payload, btn, "Complete Order (Paid by Wallet)");
};

window.verifyPayment = async () => {
    const codeInput = document.getElementById('mpesaCodeInput').value.toUpperCase().trim();
    if(codeInput.length < 10) return alert("Please enter a valid 10-character M-Pesa code.");
    
    const btn = document.getElementById('payBtn');
    const payload = { 
        isWalletOnly: false, mpesaCode: codeInput, 
        orderState: window.currentOrderState, userPhone, userLocation 
    };
    await sendSecureCheckoutRequest(payload, btn, "Verify Payment");
};







function generateWhatsAppLink(qty, total, loc, code) {
    const btn = document.querySelector('.whatsapp-float');
    const msg = `Hi EggMaster, I ordered ${qty} Trays (Ksh ${total}). Loc: ${loc}. Code: ${code}`;
    if(btn) btn.href = `https://wa.me/254700000000?text=${encodeURIComponent(msg)}`;
}

// --- PROFILE & SETTINGS ---
window.openProfileModal = () => {
    const user = auth.currentUser;
    if(!user) return;
    document.getElementById('editIdInput').value = user.uid;
    document.getElementById('editNameInput').value = user.displayName || "";
    document.getElementById('editPhoneInput').value = userPhone || "";
    document.getElementById('profile-modal').style.display = 'flex';
};

window.closeProfileModal = () => { document.getElementById('profile-modal').style.display = 'none'; };

window.saveProfile = async () => {
    const name = document.getElementById('editNameInput').value;
    const phone = document.getElementById('editPhoneInput').value.trim();
    const saveBtn = document.getElementById('saveProfileBtn');
    
    if(!name) return alert("Name cannot be empty.");

    // Regex Check: Starts with 07 or 01, followed by 8 digits (total 10 digits)
    const phoneRegex = /^(07|01)\d{8}$/;
    if(!phoneRegex.test(phone)) {
        return alert("❌ Invalid format! Phone number must be exactly 10 digits and start with 07 or 01.");
    }

    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    try {
        await updateProfile(auth.currentUser, { displayName: name });
        
        await setDoc(doc(db, "users", auth.currentUser.uid), { 
            name: name, 
            phone: phone, 
            email: auth.currentUser.email 
        }, { merge: true });
        
        userPhone = phone; // update local variable

        document.getElementById('usernameDisplay').innerText = name;
        window.closeProfileModal();
        alert("Profile Updated Successfully!");
    } catch(e) { 
        alert("Error: " + e.message); 
    } finally { 
        saveBtn.innerText = "Save Changes"; 
        saveBtn.disabled = false; 
    }
};

async function loadUserSettings() {
    if (!auth.currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            
            if (data.phone) {
                userPhone = data.phone;
            }

            if (data.theme === 'dark') {
                document.body.setAttribute('data-theme', 'dark');
                if(document.getElementById('themeToggle')) document.getElementById('themeToggle').checked = true;
            }
            if (data.location) {
                userLocation = data.location;
                const locText = document.getElementById('currentCoords');
                if(locText) locText.innerText = data.location.address;
                const locTitle = document.getElementById('locationStatus');
                if(locTitle) locTitle.style.color = "var(--primary-dark)";
            }
        }
    } catch(e) { console.error(e); }
}

window.toggleTheme = async () => {
    const toggle = document.getElementById('themeToggle');
    const theme = toggle.checked ? 'dark' : 'light';
    if (toggle.checked) document.body.setAttribute('data-theme', 'dark');
    else document.body.removeAttribute('data-theme');
    if (auth.currentUser) await setDoc(doc(db, "users", auth.currentUser.uid), { theme }, { merge: true });
};

window.changeLanguage = async (lang) => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang] && translations[lang][key]) el.innerText = translations[lang][key];
    });
    if (auth.currentUser) await setDoc(doc(db, "users", auth.currentUser.uid), { lang }, { merge: true });
};

// --- LOCATION ---
window.initLocationFlow = function() {
    const choice = confirm("Use GPS for exact delivery location?\n\n[OK] = Use GPS (Best for Drivers)\n[Cancel] = Select Area List");
    if (choice) {
        if (!navigator.geolocation) {
            alert("GPS not supported on this device. Opening list...");
            return window.openLocationSearch();
        }
        
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                userLocation = { 
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude, 
                    address: "GPS Location (Exact Pin)", 
                    timestamp: new Date() 
                };
                await saveLoc();
                alert("✅ GPS Location Saved!\nThe driver will see your exact map pin.");
            }, 
            (err) => { 
                console.error("GPS Error:", err);
                alert("⚠️ GPS Failed or Denied.\nPlease select your area manually."); 
                window.openLocationSearch(); 
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else { 
        window.openLocationSearch(); 
    }
};

window.openLocationSearch = () => {
    document.getElementById('location-modal').style.display = 'flex';
    window.renderLocationList(MOMBASA_AREAS);
};

window.renderLocationList = (areas) => {
    const list = document.getElementById('locationList');
    list.innerHTML = '';
    areas.forEach(area => {
        const item = document.createElement('div');
        item.className = 'location-item';
        item.innerHTML = `<i class="fa-solid fa-map-pin"></i> ${area}, Mombasa`;
        item.onclick = () => window.selectLocation(area + ", Mombasa");
        list.appendChild(item);
    });
};

window.filterLocations = () => {
    const queryStr = document.getElementById('locSearch').value.toLowerCase();
    const filtered = MOMBASA_AREAS.filter(a => a.toLowerCase().includes(queryStr));
    window.renderLocationList(filtered);
};

window.selectLocation = (address) => {
    userLocation = { address: address, lat: null, lng: null };
    saveLoc().then(() => {
        document.getElementById('location-modal').style.display = 'none';
        alert(`Location set to: ${address}`);
    });
};

async function saveLoc() {
    if(!userLocation) return;
    const el = document.getElementById('currentCoords');
    if(el) el.innerText = userLocation.address;
    if(auth.currentUser) {
        await setDoc(doc(db, "users", auth.currentUser.uid), { location: userLocation }, { merge: true });
    }
}

// --- NOTIFICATIONS ---
async function createNotification(msg) {
    if(!auth.currentUser) return;
    await addDoc(collection(db, "notifications"), {
        userId: auth.currentUser.uid,
        message: msg, read: false, timestamp: new Date()
    });
}

function listenToNotifications() {
    if(!auth.currentUser) return;
    const q = query(collection(db, "notifications"), where("userId", "==", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('fullNotifList');
        const badge = document.getElementById('notifBadge');
        const docs = snap.docs.map(d => d.data()).sort((a,b) => b.timestamp - a.timestamp);
        if (docs.length > 0) {
            badge.style.display = 'block';
            if(list) {
                list.innerHTML = '';
                docs.forEach(n => {
                    const d = n.timestamp.toDate ? n.timestamp.toDate() : new Date(n.timestamp);
                    list.innerHTML += `<div class="notif-card"><div class="notif-icon"><i class="fa-solid fa-bell"></i></div><div class="notif-content"><div class="msg">${n.message}</div><div class="time">${d.toLocaleString()}</div></div></div>`;
                });
            }
        } else {
            badge.style.display = 'none';
            if(list) list.innerHTML = '<p class="empty-msg">No notifications yet.</p>';
        }
    });
}

function listenToOrders() {
    if(!auth.currentUser) return;
    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    
    onSnapshot(q, (snap) => {
        const countEl = document.getElementById('homeOrderCount');
        if(countEl) countEl.innerText = snap.size;
        
        const list = document.getElementById('ordersList');
        window.ordersDataMap = {};

        if(list) list.innerHTML = snap.empty ? '<p style="text-align:center;color:#888;margin-top:20px;">No orders yet.</p>' : '';
        
        const docs = snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => b.createdAt.seconds - a.createdAt.seconds);
        
        if(docs.length > 0) {
            const last = docs[0];
            if(document.getElementById('recentItemName')) document.getElementById('recentItemName').innerText = `${last.quantity}x ${last.item}`;
            if(document.getElementById('recentStatusText')) document.getElementById('recentStatusText').innerText = "Status: " + last.status;
            if(document.getElementById('recentPrice')) document.getElementById('recentPrice').innerText = "Ksh " + last.totalPrice;
        }

        if(list) {
            list.innerHTML = "";
            docs.forEach(o => {
                window.ordersDataMap[o.id] = o;
                const codeHtml = o.deliveryCode ? `<br><small style="color:#E65100; font-weight:bold;">Delivery Code: ${o.deliveryCode}</small>` : '';
                
                list.innerHTML += `
                <div class="mini-order" style="margin-bottom:10px; display:flex; flex-wrap:wrap;">
                    <div style="display:flex; align-items:center; width:100%;">
                        <div class="icon-box"><i class="fa-solid fa-egg"></i></div>
                        <div class="details" style="flex:1;">
                            <h4>${o.quantity}x ${o.item}</h4>
                            <small>${o.status} • ${o.address}</small>
                            ${codeHtml}
                        </div>
                        <span class="price">Ksh ${o.totalPrice}</span>
                    </div>
                    
                    <div style="width:100%; margin-top:10px; padding-top:10px; border-top:1px dashed #eee; display:flex; justify-content:flex-end;">
                         <button onclick="window.generateReceiptPDF(window.ordersDataMap['${o.id}'])" 
                            style="background:#FFEBEE; color:#D32F2F; border:none; padding:8px 15px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
                            <i class="fa-solid fa-file-pdf"></i> Download Receipt
                         </button>
                    </div>
                </div>`;
            });
        }
    });
}

window.showPage = (id, el) => {
    document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
    const target = document.getElementById(id);
    if(target) { target.style.display = 'block'; setTimeout(() => target.classList.add('active'), 10); }
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if(el) el.classList.add('active');
};

const heroBtn = document.getElementById('heroOrderBtn');
if(heroBtn) heroBtn.onclick = () => window.showPage('shop', document.querySelectorAll('.nav-item')[1]);

window.logoutUser = () => signOut(auth).then(() => location.reload());

// PDF GENERATOR
window.generateReceiptPDF = (orderData) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const primaryColor = [255, 179, 0]; 
    const darkColor = [26, 29, 31];     

    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 40, 'F');

    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("EggMaster Wholesale", 105, 20, { align: "center" });
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Official Payment Receipt", 105, 30, { align: "center" });

    doc.setTextColor(...darkColor);
    doc.setFontSize(10);
    
    const startY = 55;
    const dateStr = orderData.createdAt.toDate ? orderData.createdAt.toDate().toLocaleString() : new Date(orderData.createdAt).toLocaleString();

    doc.setFont("helvetica", "bold");
    doc.text("BILLED TO:", 14, startY);
    doc.setFont("helvetica", "normal");
    doc.text(orderData.userName || "Valued Customer", 14, startY + 6);
    doc.text(orderData.address || "Mombasa, Kenya", 14, startY + 12);
    doc.text(`Tel: ${orderData.customerPhone || orderData.mpesaNumber || "N/A"}`, 14, startY + 18);

    doc.setFont("helvetica", "bold");
    doc.text("RECEIPT DETAILS:", 140, startY);
    doc.setFont("helvetica", "normal");
    doc.text(`Order Ref: #${orderData.deliveryCode || "PENDING"}`, 140, startY + 6);
    doc.text(`Date: ${dateStr}`, 140, startY + 12);
    doc.text(`Status: ${orderData.status}`, 140, startY + 18);

    doc.autoTable({
        startY: startY + 30,
        head: [['Description', 'Quantity', 'Unit Price', 'Total']],
        body: [
            [
                orderData.item, 
                orderData.quantity + " Trays", 
                "Ksh " + orderData.unitPrice, 
                "Ksh " + orderData.totalPrice.toLocaleString()
            ]
        ],
        theme: 'grid',
        headStyles: { fillColor: darkColor, textColor: [255, 255, 255] },
        styles: { fontSize: 11, cellPadding: 5 },
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    
    doc.setFontSize(12);
    doc.text(`Subtotal:`, 140, finalY);
    doc.text(`Ksh ${orderData.totalPrice.toLocaleString()}`, 170, finalY);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`TOTAL PAID:`, 140, finalY + 10);
    doc.setTextColor(46, 125, 50); 
    doc.text(`Ksh ${orderData.totalPrice.toLocaleString()}`, 170, finalY + 10);

    doc.setTextColor(...darkColor);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(14, finalY + 25, 180, 20, 3, 3, 'S');
    doc.text(`Payment Method: M-Pesa / Wallet`, 20, finalY + 33);
    doc.setFont("helvetica", "bold");
    doc.text(`Transaction Code: ${orderData.mpesaCode || "N/A"}`, 20, finalY + 40);

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text("Thank you for your business!", 105, 280, { align: "center" });
    doc.text("For support call: 0700 000 000", 105, 285, { align: "center" });

    doc.save(`Receipt_EggMaster_${orderData.deliveryCode || "Order"}.pdf`);
};

window.ordersDataMap = {};

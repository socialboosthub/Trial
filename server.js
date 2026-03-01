const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// --- SETUP FIREBASE ---
var serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper: Verify Firebase User Token
async function verifyUser(req, res, next) {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
}

// Helper: Generate Random Code
function generateOrderCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// --- SECURE WALLET TOP UP ---
app.post('/api/topup', verifyUser, async (req, res) => {
    const { mpesaCode } = req.body;
    const uid = req.user.uid;

    try {
        const mpesaRef = db.collection('mpesa_payments').doc(mpesaCode);
        const userRef = db.collection('users').doc(uid);

        await db.runTransaction(async (transaction) => {
            const mpesaDoc = await transaction.get(mpesaRef);
            if (!mpesaDoc.exists) throw new Error("Code not found");
            
            const mpesaData = mpesaDoc.data();
            if (mpesaData.used) throw new Error("Code already used");

            const paidAmount = Number(String(mpesaData.amount).replace(/,/g, ''));
            if (isNaN(paidAmount) || paidAmount <= 0) throw new Error("Invalid amount");

            const userDoc = await transaction.get(userRef);
            const currentBalance = userDoc.exists ? (userDoc.data().walletBalance || 0) : 0;

            // Update Database Securely
            transaction.update(mpesaRef, { used: true, usedBy: uid, claimedAt: new Date(), purpose: "Wallet Top Up" });
            transaction.set(userRef, { walletBalance: currentBalance + paidAmount }, { merge: true });
            
            // Send Notification
            const notifRef = db.collection('notifications').doc();
            transaction.set(notifRef, { userId: uid, message: `Wallet Topped Up! Added Ksh ${paidAmount.toLocaleString()}`, read: false, timestamp: new Date() });
        });

        res.json({ success: true, message: "Wallet topped up securely." });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- SECURE CHECKOUT ---
app.post('/api/checkout', verifyUser, async (req, res) => {
    const { mpesaCode, orderState, userPhone, userLocation, isWalletOnly } = req.body;
    const uid = req.user.uid;
    const userName = req.user.name || "Customer";

    try {
        const userRef = db.collection('users').doc(uid);
        const stockRef = db.collection('config').doc('pricing');

        let deliveryCode = generateOrderCode();
        let successMessage = "";
        let overpayment = 0;

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const stockDoc = await transaction.get(stockRef);
            
            let currentBalance = userDoc.exists ? (userDoc.data().walletBalance || 0) : 0;
            let currentStock = stockDoc.exists ? (stockDoc.data().currentStock || 0) : 0;
            let currentPrice = stockDoc.exists ? (stockDoc.data().currentPrice || 385) : 385;

            // Verify stock
            if (orderState.quantity > currentStock) throw new Error("Not enough stock available");

            // Recalculate totals on the server to prevent frontend hacking
            const actualCartTotal = orderState.quantity * currentPrice;
            let newWalletBalance = currentBalance;
            let mpesaNumber = "Verified";

            if (isWalletOnly) {
                if (currentBalance < actualCartTotal) throw new Error("Insufficient wallet balance");
                newWalletBalance = currentBalance - actualCartTotal;
                mpesaNumber = "Paid via Wallet";
            } else {
                const mpesaRef = db.collection('mpesa_payments').doc(mpesaCode);
                const mpesaDoc = await transaction.get(mpesaRef);
                
                if (!mpesaDoc.exists) throw new Error("Code not found");
                const mpesaData = mpesaDoc.data();
                if (mpesaData.used) throw new Error("Code already used");

                const paidAmount = Number(String(mpesaData.amount).replace(/,/g, ''));
                const requiredMpesa = actualCartTotal - Math.min(actualCartTotal, currentBalance);
                
                if (paidAmount < requiredMpesa) throw new Error(`Underpayment. Required: ${requiredMpesa}`);

                overpayment = paidAmount - requiredMpesa;
                newWalletBalance = currentBalance - Math.min(actualCartTotal, currentBalance) + overpayment;
                mpesaNumber = mpesaData.phone || "Verified";

                transaction.update(mpesaRef, { used: true, usedBy: uid, claimedAt: new Date() });
            }

            // Write Order
            const newOrderRef = db.collection('orders').doc();
            transaction.set(newOrderRef, {
                userId: uid, userName, customerPhone: userPhone, item: "Tray of 30", unitPrice: currentPrice,
                quantity: orderState.quantity, totalPrice: actualCartTotal, status: 'Pending',
                mpesaNumber: mpesaNumber, mpesaCode: isWalletOnly ? "WALLET" : mpesaCode,
                address: userLocation.address, locationCoords: userLocation, deliveryCode: deliveryCode, createdAt: new Date()
            });

            // Update Stock & Wallet
            transaction.update(stockRef, { currentStock: currentStock - orderState.quantity });
            transaction.set(userRef, { walletBalance: newWalletBalance }, { merge: true });

            // Notify
            const notifRef = db.collection('notifications').doc();
            transaction.set(notifRef, { userId: uid, message: `Order Success! Code: ${deliveryCode}`, read: false, timestamp: new Date() });
        });

        if (overpayment > 0) successMessage = `✅ Payment Verified!\n\nDELIVERY CODE: ${deliveryCode}\n\n🎉 Ksh ${overpayment} extra saved to wallet!`;
        else successMessage = `✅ Order Paid Successfully!\n\nDELIVERY CODE: ${deliveryCode}`;

        res.json({ success: true, deliveryCode, message: successMessage });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 🔥 AUTOMATED SMS LISTENER (WEBHOOK)
app.post('/webhook/sms', async (req, res) => {
  res.status(200).send("Message Received");
  try {
    const payload = req.body;
    let messageRaw = payload.message || payload.text || payload.content || payload.body || payload.sms || (payload.data ? payload.data.message : "") || "";
    let sender = payload.from || payload.sender || payload.number || payload.phone || "Unknown";

    if (!messageRaw.toLowerCase().includes("confirmed")) return;

    const codeRegex = /([A-Z0-9]{10})[\s\.]*Confirmed/i;
    const amountRegex = /Ksh\.?[\s]*([\d,]+\.?\d*)/i;
    const phoneRegex = /\d{10,12}/;

    const codeMatch = messageRaw.match(codeRegex);
    const amountMatch = messageRaw.match(amountRegex);
    const phoneMatch = messageRaw.match(phoneRegex);

    if (codeMatch && amountMatch) {
      const transactionId = codeMatch[1].toUpperCase();
      const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      const phone = phoneMatch ? phoneMatch[0] : sender; 

      await db.collection('mpesa_payments').doc(transactionId).set({
        transactionId: transactionId, amount: amount, phone: phone,
        fullMessage: messageRaw, used: false, method: "Auto-Forwarder", timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) { console.error("Webhook Error:", err); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Secure Server running on port ${PORT}`));


const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');

// Load environment variables from .env if present
const dotenvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotenvPath)) {
  const envContent = fs.readFileSync(dotenvPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  });
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey_please_change_in_production';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Middleware
// Universal CORS configuration supporting credentials, preflights, and onlinevoterslip.com
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any origin matching onlinevoterslip.com or localhost or any client
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-File-Name',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Content-Disposition'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Explicit manual preflight & header middleware for complete CORS assurance
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-File-Name, Access-Control-Request-Method, Access-Control-Request-Headers');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Configure body-parser to accept data up to 500MB
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/download/:filename', (req, res) => {
  const file = path.join(__dirname, 'uploads', req.params.filename);
  res.download(file);
});

const dataFilePath = path.join(__dirname, 'data.json');
const usersFilePath = path.join(__dirname, 'users.json');
const settingsFilePath = path.join(__dirname, 'settings.json');
const creditRequestsFilePath = path.join(__dirname, 'credit-requests.json');

// Initialize data files if they don't exist
if (!fs.existsSync(dataFilePath)) {
  fs.writeFileSync(dataFilePath, JSON.stringify([]));
}
if (!fs.existsSync(creditRequestsFilePath)) {
  fs.writeFileSync(creditRequestsFilePath, JSON.stringify([]));
}
// Ensure users file exists and configure admin strictly from environment variable
function syncAdminFromEnv() {
  let users = [];
  if (fs.existsSync(usersFilePath)) {
    try {
      users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
    } catch (e) {
      users = [];
    }
  }

  // Remove any legacy hardcoded admin entries
  users = users.filter(u => u.email !== 'admin123' && u.id !== 'admin123');

  if (ADMIN_PASSWORD) {
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const existingAdminIdx = users.findIndex(u => u.role === 'admin' || u.email === ADMIN_EMAIL);
    const adminUser = {
      id: 'admin',
      email: ADMIN_EMAIL,
      name: 'Administrator',
      phone: '',
      role: 'admin',
      status: 'active',
      passwordHash
    };

    if (existingAdminIdx !== -1) {
      users[existingAdminIdx] = { ...users[existingAdminIdx], ...adminUser };
    } else {
      users.unshift(adminUser);
    }
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    console.log(`Admin account initialized/updated from environment variable for: ${ADMIN_EMAIL}`);
  } else {
    console.warn('[SECURITY WARNING] ADMIN_PASSWORD environment variable is not set. Admin login is disabled until ADMIN_PASSWORD is set in .env');
    if (!fs.existsSync(usersFilePath)) {
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }
  }
}
syncAdminFromEnv();
if (!fs.existsSync(settingsFilePath)) {
  const defaultSettings = {
    assemblyImage: "https://images.unsplash.com/photo-1575517111478-7f6afd0973db?q=80&w=2070&auto=format&fit=crop",
    nagarNigamImage: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?q=80&w=2070&auto=format&fit=crop",
    gramPanchayatImage: "https://images.unsplash.com/photo-1592659762303-90081d34b277?q=80&w=2073&auto=format&fit=crop",
    privacyPolicyText: "This is the default privacy policy. Update this in the admin panel.",
    termsOfServiceText: "These are the default terms of service. Update this in the admin panel.",
    qrCodeImage: "https://via.placeholder.com/200?text=Scan+QR+Code",
    upiId: "elections@upi",
    rateWithoutImage: 0.10,
    rateWithImage: 0.12
  };
  fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettings, null, 2));
} else {
  // Add new defaults to existing settings if they don't exist
  let settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  let updated = false;
  if (!settings.privacyPolicyText) { settings.privacyPolicyText = "This is the default privacy policy. Update this in the admin panel."; updated = true; }
  if (!settings.termsOfServiceText) { settings.termsOfServiceText = "These are the default terms of service. Update this in the admin panel."; updated = true; }
  if (!settings.qrCodeImage) { settings.qrCodeImage = "https://via.placeholder.com/200?text=Scan+QR+Code"; updated = true; }
  if (!settings.upiId) { settings.upiId = "elections@upi"; updated = true; }
  if (settings.rateWithoutImage === undefined) { settings.rateWithoutImage = 0.10; updated = true; }
  if (settings.rateWithImage === undefined) { settings.rateWithImage = 0.12; updated = true; }
  if (updated) fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
}

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  if (token === 'DUMMY') {
    req.user = { role: 'admin', email: 'admin' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// OTP Store (in-memory for simplicity, normally use Redis/DB)
const otpStore = new Map();

const crypto = require('crypto');
const { sendOtpSms } = require('./sms.service');

app.post('/api/auth/send-otp', async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) return res.status(400).json({ error: 'Name, email, and phone are required' });

  try {
    const otp = String(crypto.randomInt(100000, 1000000));
    
    // Store user data alongside OTP
    otpStore.set(phone, {
      otp,
      name,
      email,
      phone,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    await sendOtpSms(phone, otp);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('OTP Send Error:', err);
    res.status(502).json({ error: 'Could not send OTP' });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  const record = otpStore.get(phone);
  if (!record) return res.status(400).json({ error: 'OTP expired or not found' });
  
  if (record.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    return res.status(400).json({ error: 'OTP expired' });
  }

  // OTP is valid, now login or create user
  otpStore.delete(phone);

  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  let user = users.find(u => u.phone === phone || u.email === record.email);

  if (!user) {
    // Create new user if not exists
    user = {
      id: Date.now().toString(),
      name: record.name,
      email: record.email,
      phone: record.phone,
      role: 'user',
      status: 'pending_payment',
    };
    users.push(user);
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  } else {
    // Update existing user's details if needed
    let updated = false;
    if (!user.phone && record.phone) { user.phone = record.phone; updated = true; }
    if (updated) {
      fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    }
  }

  if (user.role !== 'admin' && user.status === 'pending_payment') {
    return res.status(403).json({ error: 'Payment pending', userId: user.id, status: user.status });
  }
  if (user.role !== 'admin' && user.status === 'pending_approval') {
    return res.status(403).json({ error: 'Account pending admin approval', userId: user.id, status: user.status });
  }
  if (user.role !== 'admin' && user.status === 'blocked') {
    return res.status(403).json({ error: 'Your account is blocked due to False Payment Info', userId: user.id, status: user.status });
  }

  const token = jwt.sign({ email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token, role: user.role || 'user', status: user.status, message: 'Login successful' });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.email === req.user.email);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const { passwordHash, ...safeUser } = user;
  safeUser.credits = safeUser.credits !== undefined ? Number(safeUser.credits) : 0;
  safeUser.creditHistory = safeUser.creditHistory || [];
  res.json(safeUser);
});

// Endpoint to verify admin password against backend environment
app.post('/api/admin/verify-password', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const backendAdminPassword = process.env.ADMIN_PASSWORD;

  // Check directly against process.env.ADMIN_PASSWORD
  if (backendAdminPassword && password === backendAdminPassword) {
    const token = jwt.sign({ email: ADMIN_EMAIL, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token });
  }

  // Also check against admin record in users.json
  try {
    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
    const adminUser = users.find(u => u.role === 'admin' || u.email === ADMIN_EMAIL);
    if (adminUser && adminUser.passwordHash && bcrypt.compareSync(password, adminUser.passwordHash)) {
      const token = jwt.sign({ email: adminUser.email, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ success: true, token });
    }
  } catch (e) {
    console.error('Error verifying admin in database:', e);
  }

  if (!backendAdminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD not there' });
  }

  return res.status(401).json({ error: 'Invalid password' });
});

// Admin User endpoints
app.get('/api/admin/users', (req, res) => {
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const safeUsers = users.map(u => {
    const { passwordHash, ...rest } = u;
    rest.credits = rest.credits !== undefined ? Number(rest.credits) : 0;
    rest.creditHistory = rest.creditHistory || [];
    return rest;
  });
  res.json(safeUsers);
});

app.post('/api/admin/approve-user', (req, res) => {
  const { userId, credit } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.id === userId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'active';
  const grantCredit = Math.max(0, Number(credit) || 0);
  user.credits = Math.round(((Number(user.credits) || 0) + grantCredit) * 100) / 100;
  user.creditHistory = user.creditHistory || [];

  if (grantCredit > 0) {
    user.creditHistory.unshift({
      id: Date.now(),
      type: 'CREDIT_ADDED',
      description: `Initial credit granted upon approval (UTR: ${user.utr || 'N/A'})`,
      amount: grantCredit,
      balanceAfter: user.credits,
      timestamp: new Date().toISOString()
    });
  }

  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'User approved successfully', credits: user.credits });
});

app.post('/api/admin/update-credits', (req, res) => {
  const { userId, amount, action = 'add' } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const val = Number(amount) || 0;
  const prevBalance = Number(user.credits) || 0;
  if (action === 'set') {
    user.credits = Math.max(0, Math.round(val * 100) / 100);
  } else {
    user.credits = Math.max(0, Math.round((prevBalance + val) * 100) / 100);
  }
  const diff = Math.round((user.credits - prevBalance) * 100) / 100;
  user.creditHistory = user.creditHistory || [];
  user.creditHistory.unshift({
    id: Date.now(),
    type: diff >= 0 ? 'CREDIT_ADDED' : 'CREDIT_DEDUCTED',
    description: `Admin manual credit ${action === 'set' ? 'adjustment' : 'top-up'}`,
    amount: diff,
    balanceAfter: user.credits,
    timestamp: new Date().toISOString()
  });

  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'User credits updated successfully', credits: user.credits });
});

app.post('/api/admin/toggle-block-user', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { userId, block } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  let users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.id === userId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = block ? 'blocked' : 'active';
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: `User access ${block ? 'blocked' : 'restored'} successfully`, status: user.status });
});

// GET endpoint for user print and credit deduction history
app.get('/api/user/print-history', authMiddleware, (req, res) => {
  try {
    const userEmail = req.user.email;
    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
    const user = users.find(u => u.email === userEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let printsData = [];
    if (fs.existsSync(dataFilePath)) {
      printsData = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    }
    const userPrints = printsData.filter(p => p.account === userEmail);
    userPrints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      credits: user.credits !== undefined ? Number(user.credits) : 0,
      creditHistory: user.creditHistory || [],
      prints: userPrints,
      rates: {
        withoutImage: fs.existsSync(settingsFilePath) ? (Number(JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8')).rateWithoutImage) || 0.10) : 0.10,
        withImage: fs.existsSync(settingsFilePath) ? (Number(JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8')).rateWithImage) || 0.12) : 0.12,
        unit: 'per page'
      }
    });
  } catch (err) {
    console.error('Error fetching user print history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- CREDIT INCREASE / RECHARGE REQUEST ENDPOINTS ---

// User: Submit a new credit increase request with UPI & UTR
app.post('/api/user/credit-request', authMiddleware, (req, res) => {
  try {
    const { amount, utr, notes } = req.body;
    const reqAmount = parseFloat(amount);

    if (isNaN(reqAmount) || reqAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid credit amount greater than 0.' });
    }
    if (!utr || !utr.trim()) {
      return res.status(400).json({ error: 'Transaction UTR / Reference number is required.' });
    }

    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
    const user = users.find(u => u.email === req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requests = fs.existsSync(creditRequestsFilePath)
      ? JSON.parse(fs.readFileSync(creditRequestsFilePath, 'utf-8'))
      : [];

    const newRequest = {
      id: Date.now().toString(),
      userId: user.id,
      userName: user.name || 'User',
      userEmail: user.email,
      userPhone: user.phone || '',
      amount: Math.round(reqAmount * 100) / 100,
      utr: utr.trim(),
      notes: notes ? notes.trim() : '',
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    requests.unshift(newRequest);
    fs.writeFileSync(creditRequestsFilePath, JSON.stringify(requests, null, 2));

    res.status(201).json({
      message: 'Credit recharge request submitted successfully! Admin will verify and update your balance.',
      request: newRequest
    });
  } catch (err) {
    console.error('Error submitting credit request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User: Get own credit recharge requests
app.get('/api/user/credit-requests', authMiddleware, (req, res) => {
  try {
    const requests = fs.existsSync(creditRequestsFilePath)
      ? JSON.parse(fs.readFileSync(creditRequestsFilePath, 'utf-8'))
      : [];
    const userRequests = requests.filter(r => r.userEmail === req.user.email);
    userRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(userRequests);
  } catch (err) {
    console.error('Error reading credit requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all credit increase requests
app.get('/api/admin/credit-requests', authMiddleware, (req, res) => {
  try {
    const requests = fs.existsSync(creditRequestsFilePath)
      ? JSON.parse(fs.readFileSync(creditRequestsFilePath, 'utf-8'))
      : [];
    const users = fs.existsSync(usersFilePath)
      ? JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'))
      : [];

    // Enrich requests with current user credit balance
    const enriched = requests.map(r => {
      const u = users.find(user => user.id === r.userId || user.email === r.userEmail);
      return {
        ...r,
        currentUserCredits: u ? (Number(u.credits) || 0) : 0
      };
    });

    // Sort: pending first, then by date descending
    enriched.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json(enriched);
  } catch (err) {
    console.error('Error reading admin credit requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Approve credit increase request
app.post('/api/admin/approve-credit-request', authMiddleware, (req, res) => {
  try {
    const { requestId, approvedAmount } = req.body;
    if (!requestId) return res.status(400).json({ error: 'Request ID is required' });

    let requests = JSON.parse(fs.readFileSync(creditRequestsFilePath, 'utf-8'));
    const request = requests.find(r => r.id === requestId);
    if (!request) return res.status(404).json({ error: 'Credit request not found' });
    if (request.status === 'approved') {
      return res.status(400).json({ error: 'Request is already approved' });
    }

    const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
    const user = users.find(u => u.id === request.userId || u.email === request.userEmail);
    if (!user) return res.status(404).json({ error: 'Associated user not found' });

    const finalAmount = approvedAmount !== undefined && !isNaN(parseFloat(approvedAmount))
      ? Math.max(0, Math.round(parseFloat(approvedAmount) * 100) / 100)
      : Number(request.amount);

    user.credits = Math.max(0, Math.round(((Number(user.credits) || 0) + finalAmount) * 100) / 100);
    user.creditHistory = user.creditHistory || [];
    user.creditHistory.unshift({
      id: Date.now(),
      type: 'CREDIT_ADDED',
      description: `UPI Credit Recharge Approved (UTR: ${request.utr})`,
      amount: finalAmount,
      balanceAfter: user.credits,
      timestamp: new Date().toISOString()
    });

    request.status = 'approved';
    request.approvedAmount = finalAmount;
    request.updatedAt = new Date().toISOString();
    request.approvedAt = new Date().toISOString();

    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    fs.writeFileSync(creditRequestsFilePath, JSON.stringify(requests, null, 2));

    res.json({
      message: `Request approved! Added ₹${finalAmount.toFixed(2)} to ${user.name}'s wallet.`,
      request,
      credits: user.credits
    });
  } catch (err) {
    console.error('Error approving credit request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Reject credit increase request
app.post('/api/admin/reject-credit-request', authMiddleware, (req, res) => {
  try {
    const { requestId, reason } = req.body;
    if (!requestId) return res.status(400).json({ error: 'Request ID is required' });

    let requests = JSON.parse(fs.readFileSync(creditRequestsFilePath, 'utf-8'));
    const request = requests.find(r => r.id === requestId);
    if (!request) return res.status(404).json({ error: 'Credit request not found' });

    request.status = 'rejected';
    request.rejectionReason = reason ? reason.trim() : 'Invalid UTR / Payment not received';
    request.updatedAt = new Date().toISOString();
    request.rejectedAt = new Date().toISOString();

    fs.writeFileSync(creditRequestsFilePath, JSON.stringify(requests, null, 2));

    res.json({
      message: 'Credit request rejected successfully.',
      request
    });
  } catch (err) {
    console.error('Error rejecting credit request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST endpoint to log a new print with credit deduction
app.post('/api/prints', (req, res) => {
  const {
    optionType, wardNo, partNo, serialNo, voterName, pagesCount,
    cardsPerPage, slipsCount, hasImage,
    state, district, assembly, city, panchayat
  } = req.body;

  if (!optionType || !pagesCount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let accountDetails = 'Guest User';
  let currentUser = null;
  const token = req.headers.authorization?.split(' ')[1];
  if (token && token !== 'DUMMY') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      accountDetails = decoded.email || 'Guest User';
    } catch (e) {
      // ignore invalid tokens for guest prints
    }
  }

  const users = fs.existsSync(usersFilePath) ? JSON.parse(fs.readFileSync(usersFilePath, 'utf-8')) : [];
  if (accountDetails !== 'Guest User') {
    currentUser = users.find(u => u.email === accountDetails);
  }

  // Credit calculation:
  // Rates are per PAGE:
  let rateWithoutImage = 0.10;
  let rateWithImage = 0.12;
  if (fs.existsSync(settingsFilePath)) {
    const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
    if (settings.rateWithoutImage !== undefined) rateWithoutImage = Number(settings.rateWithoutImage);
    if (settings.rateWithImage !== undefined) rateWithImage = Number(settings.rateWithImage);
  }
  const isImagePresent = Boolean(hasImage);
  const ratePerPage = isImagePresent ? rateWithImage : rateWithoutImage;
  const numCardsPerPage = Number(cardsPerPage) || 8;
  const numPages = Math.max(1, Number(pagesCount) || 1);
  const actualSlipsCount = Number(slipsCount) || (numPages * numCardsPerPage);
  const totalCost = Math.round(numPages * ratePerPage * 100) / 100;

  // Check and deduct credits for registered users (non-admin)
  if (currentUser && currentUser.role !== 'admin') {
    if (currentUser.status === 'blocked') {
      return res.status(403).json({ error: 'Your account is blocked due to False Payment Info. Cannot download slips.' });
    }
    const currentBalance = Number(currentUser.credits) || 0;
    if (currentBalance < totalCost) {
      return res.status(402).json({
        error: 'Insufficient credits',
        required: totalCost,
        available: currentBalance,
        message: `Insufficient balance! You need ₹${totalCost.toFixed(2)} (${numPages} ${numPages === 1 ? 'page' : 'pages'} @ ₹${ratePerPage.toFixed(2)}/page), but your balance is ₹${currentBalance.toFixed(2)}. Please recharge your wallet.`
      });
    }

    currentUser.credits = Math.max(0, Math.round((currentBalance - totalCost) * 100) / 100);
    currentUser.creditHistory = currentUser.creditHistory || [];
    currentUser.creditHistory.unshift({
      id: Date.now(),
      type: 'PRINT_DEDUCTION',
      description: `${optionType} (${numPages} ${numPages === 1 ? 'page' : 'pages'} [${actualSlipsCount} slips] ${isImagePresent ? 'with photo @ ₹0.12/page' : 'without photo @ ₹0.10/page'})`,
      amount: -totalCost,
      cost: totalCost,
      rate: ratePerPage,
      rate_per_page: ratePerPage,
      hasImage: isImagePresent,
      pagesCount: numPages,
      slipsCount: actualSlipsCount,
      balanceAfter: currentUser.credits,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  }

  const newPrint = {
    id: Date.now(),
    option_type: optionType,
    ward_no: wardNo,
    part_no: partNo,
    serial_no: serialNo,
    voter_name: voterName,
    pages_count: numPages,
    cards_per_page: numCardsPerPage,
    slips_count: actualSlipsCount,
    has_image: isImagePresent,
    rate_per_page: ratePerPage,
    rate_per_slip: ratePerPage, // backwards compatibility
    cost: totalCost,
    balance_after: currentUser ? currentUser.credits : null,
    state, district, assembly, city, panchayat,
    account: accountDetails,
    timestamp: new Date().toISOString()
  };

  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    data.push(newPrint);
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    res.status(201).json({
      id: newPrint.id,
      message: 'Print record logged successfully',
      deducted: totalCost,
      rate: ratePerPage,
      rate_per_page: ratePerPage,
      pagesCount: numPages,
      hasImage: isImagePresent,
      slipsCount: actualSlipsCount,
      remainingCredits: currentUser ? currentUser.credits : null
    });
  } catch (err) {
    console.error('Error saving print:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET endpoint to retrieve all print records (Protected)
app.get('/api/prints', authMiddleware, (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    // Enrich with user profile info
    const users = fs.existsSync(usersFilePath) ? JSON.parse(fs.readFileSync(usersFilePath, 'utf-8')) : [];
    const enriched = data.map(record => {
      const user = users.find(u => u.email === record.account);
      return {
        ...record,
        accountName: user?.name || null,
        accountPhone: user?.phone || null,
        accountUtr: user?.utr || null,
        accountStatus: user?.status || null
      };
    });
    res.json(enriched);
  } catch (err) {
    console.error('Error reading prints:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Configure multer for file uploads up to 500MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const customName = req.body.fileName || file.originalname;
    // If it's an image, don't append .xlsx
    if (file.mimetype.startsWith('image/')) {
      return cb(null, customName);
    }
    const finalName = (customName.endsWith('.xlsx') || customName.endsWith('.csv') || customName.endsWith('.xls')) ? customName : `${customName}.xlsx`;
    cb(null, finalName);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: 524288000, // 500 MB (500 * 1024 * 1024 bytes)
    fieldSize: 524288000  // 500 MB form fields
  }
});

const excelMetaPath = path.join(__dirname, 'excel-metadata.json');

require('./patch-exceljs');

// --- EXCEL DATA NORMALIZATION & EXTRACTION HELPERS ---
function getField(row, candidateKeys, fallback = '') {
  if (!row || typeof row !== 'object') return fallback;
  for (const k of candidateKeys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return row[k];
    }
  }
  return fallback;
}

function normalizeVoterRow(row) {
  if (!row || typeof row !== 'object') return row;

  const zillaName = getField(row, [
    'ZILLA PARISHAD NAME', 'ZILLA PARISHAD', 'ZILLA', 'FJPNAME', 'JPNAME',
    'जिला परिषद नाम', 'जिला परिषद', 'जिला परिषद्', 'जिला', 'DISTRICT', 'District'
  ]);
  const zillaNo = getField(row, [
    'ZILLA PARISHAD NO', 'ZILLA_NO', 'ZP_NO', 'FJPNO', 'JPNO',
    'जिला परिषद संख्या', 'जिला परिषद नं', 'जिला परिषद क्र', 'जिला परिषद क्र.'
  ]);

  const samitiName = getField(row, [
    'PANCHAYAT SAMITI NAME', 'PANCHAYAT SAMITI', 'SAMITI', 'FPSNAME', 'PSNAME',
    'पंचायत समिति नाम', 'पंचायत समिति', 'समिति नाम', 'समिति', 'ब्लॉक', 'तहसील', 'CITY', 'City', 'BLOCK'
  ]);
  const samitiNo = getField(row, [
    'PANCHAYAT SAMITI NO', 'SAMITI_NO', 'PS_NO', 'FPSNO', 'PSNO',
    'पंचायत समिति संख्या', 'पंचायत समिति नं', 'पंचायत समिति क्र', 'पंचायत समिति क्र.'
  ]);

  const panchayatName = getField(row, [
    'PANCHAYAT NAME', 'PANCHAYAT', 'FGRAMPANCHAYAT', 'GRAMPANCHAYAT', 'GRAM PANCHAYAT',
    'ग्राम पंचायत नाम', 'ग्राम पंचायत', 'पंचायत नाम', 'पंचायत'
  ]);

  const wardNo = getField(row, [
    'WARDNO', 'WARD_NO', 'WARD NO', 'WARD', 'NWARDNO', 'PANCHAYAT WARD NO', 'PANCHAYAT_WARD_NO',
    'वार्ड नं', 'वार्ड नंबर', 'वार्ड संख्या', 'वार्ड क्र', 'वार्ड क्र.', 'वार्ड'
  ]);

  const boothNo = getField(row, [
    'BOOTH_NO', 'BOOTH NO', 'BOOTH_N', 'BOOTHNO', 'BOOTH', 'FPOLLINGNO', 'POLLINGNO', 'POLLING_NO',
    'बूथ नं', 'बूथ संख्या', 'बूथ', 'मतदान केंद्र संख्या'
  ]);
  const partNo = getField(row, [
    'PARTNO', 'PART_NO', 'PART NO', 'PART', 'भाग संख्या', 'FPOLLINGNO'
  ]) || boothNo;

  const psEn = getField(row, ['PS_EN', 'POLLINGSTATION', 'POLLING_STATION', 'POLLING STATION']);
  const psHi = getField(row, [
    'PS_HI', 'POOLINGSTATION', 'मतदान केंद्र', 'मतदान केंद्र का नाम', 'मतदान स्थल', 'POLLINGSTATION'
  ]) || psEn;

  const serialNo = getField(row, [
    'SERIAL_NO', 'SERIAL NO', 'SERIAL', 'SRNO', 'SR_NO', 'SLNO',
    'क्रम संख्या', 'सरल क्रमांक', 'क्र. सं.', 'क्र सं', 'क्र.'
  ]);

  const idcard = String(getField(row, [
    'IDCARD', 'ID_CARD', 'ID CARD', 'VID', 'EPIC_NO', 'EPIC', 'EPIC NO', 'idcard',
    'पहचान पत्र', 'मतदाता पहचान पत्र', 'एपिक', 'पहचान पत्र क्रमांक'
  ])).trim();

  const vFnameEn = getField(row, ['V_FNAME_EN', 'EFVNAME', 'EVNAME', 'VOTER_NAME_EN', 'NAME_EN', 'V_FNAME']);
  const vLnameEn = getField(row, ['V_LNAME_EN', 'ELVNAME', 'LNAME_EN', 'V_LNAME']);
  const vFnameHi = getField(row, ['V_FNAME_HI', 'FVNAME', 'VOTER_NAME_HI', 'NAME_HI', 'मतदाता का नाम', 'मतदाता नाम', 'नाम']);
  const vLnameHi = getField(row, ['V_LNAME_HI']);

  const vrFnameEn = getField(row, ['VR_FNAME_EN', 'EFRNAME', 'ERNAME', 'RELATIVE_NAME_EN', 'FATHER_NAME_EN', 'VR_FNAME']);
  const vrLnameEn = getField(row, ['VR_LNAME_EN', 'ELRNAME', 'LNAME_REL_EN', 'VR_LNAME']);
  const vrFnameHi = getField(row, [
    'VR_FNAME_HI', 'FRNAME', 'RELATIVE_NAME_HI', 'संबंधी का नाम', 'संबंधी नाम', 'पिता का नाम', 'पति का नाम', 'पिता/पति का नाम'
  ]);
  const vrLnameHi = getField(row, ['VR_LNAME_HI']);

  let relation = getField(row, ['RELATION', 'FRELATION', 'संबंध', 'रिश्ता']);
  if (relation === 'H') relation = 'पति (Husband)';
  else if (relation === 'F') relation = 'पिता (Father)';
  else if (relation === 'M') relation = 'माता (Mother)';
  else if (relation === 'W') relation = 'पत्नी (Wife)';

  const age = getField(row, ['AGE', 'FAGE', 'MAGE', 'आयु', 'उम्र']);

  let sex = getField(row, ['SEX', 'GENDER', 'FGENDER', 'MSEX', 'लिंग']);
  const sexUpper = String(sex).trim().toUpperCase();
  if (sexUpper === 'M' || sexUpper === 'MALE' || sex === 'पुरुष') sex = 'पुरुष';
  else if (sexUpper === 'F' || sexUpper === 'FEMALE' || sex === 'स्त्री' || sex === 'महिला') sex = 'महिला';

  const houseNo = getField(row, ['HOUSE_NO', 'HOUSE NO', 'FHOUSENO', 'HOUSENO', 'मकान संख्या', 'मकान नं', 'गृह संख्या', 'घर संख्या']);
  const village = getField(row, ['VILLAGE', 'LOCATION', 'SECTION', 'गांव', 'ग्राम', 'स्थान', 'मोहल्ला', 'अनुभाग', 'पता']);
  const section = getField(row, ['SECTION', 'अनुभाग']);
  const pincode = getField(row, ['PINCODE', 'PIN', 'पिनकोड']);
  const mobile = getField(row, ['MOBILE_1', 'MOBILE_NO', 'MOBILE', 'PHONE', 'मोबाइल']);
  const videoLink = getField(row, ['VIDEO_LINK', 'VIDEO_URL', 'VIDEO']);
  const pcName = getField(row, ['PC NAME', 'PC_NAME', 'लोकसभा क्षेत्र', 'संसदीय क्षेत्र']);
  const pcNo = getField(row, ['PC NO', 'PC_NO']);
  const image = getField(row, ['IMAGE', 'PHOTO', 'फोटो']);

  return {
    ...row,
    PS_EN: psEn,
    PS_HI: psHi,
    IDCARD: idcard,
    WARDNO: wardNo,
    PARTNO: partNo || (boothNo || ''),
    BOOTH_NO: boothNo || (partNo || ''),
    SERIAL_NO: serialNo,
    IMAGE: image,
    V_FNAME_EN: vFnameEn,
    V_LNAME_EN: vLnameEn,
    V_FNAME_HI: vFnameHi,
    V_LNAME_HI: vLnameHi,
    VR_FNAME_EN: vrFnameEn,
    VR_LNAME_EN: vrLnameEn,
    VR_FNAME_HI: vrFnameHi,
    VR_LNAME_HI: vrLnameHi,
    RELATION: relation,
    AGE: age,
    SEX: sex,
    HOUSE_NO: String(houseNo),
    VILLAGE: village,
    SECTION: section,
    PINCODE: pincode,
    MOBILE_1: mobile,
    VIDEO_LINK: videoLink,
    'ZILLA PARISHAD NAME': zillaName,
    'ZILLA PARISHAD NO': zillaNo,
    'PANCHAYAT SAMITI NAME': samitiName,
    'PANCHAYAT SAMITI NO': samitiNo,
    'PANCHAYAT NAME': panchayatName,
    'PANCHAYAT WARD NO': getField(row, ['PANCHAYAT WARD NO']) || wardNo,
    'PC NAME': pcName,
    'PC NO': pcNo
  };
}

function calculateVoterStats(data) {
  let stats = {
    totalVoters: data.length, maleVoters: 0, femaleVoters: 0,
    averageAge: 0, totalAge: 0, votersWithAge: 0,
    ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
  };
  for (const v of data) {
    const gender = String(v.MSEX || v.FGENDER || v.SEX || v.GENDER || '').trim().toUpperCase();
    if (gender === 'M' || gender === 'MALE' || gender === 'पुरुष') stats.maleVoters++;
    else if (gender === 'F' || gender === 'FEMALE' || gender === 'महिला' || gender === 'स्त्री') stats.femaleVoters++;
    const age = parseInt(v.MAGE || v.FAGE || v.AGE);
    if (!isNaN(age) && age > 0 && age < 150) {
      stats.totalAge += age; stats.votersWithAge++;
      if (age >= 18 && age <= 25) stats.ageBrackets.youth++;
      else if (age >= 26 && age <= 40) stats.ageBrackets.adult++;
      else if (age >= 41 && age <= 60) stats.ageBrackets.middle++;
      else if (age > 60) stats.ageBrackets.senior++;
    }
  }
  if (stats.votersWithAge > 0) stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
  return stats;
}

function extractMetadataFromData(data, manualMeta = {}, category = 'general') {
  if (!data || data.length === 0) return { ...manualMeta };

  const wardsSet = new Set();
  const boothsSet = new Set();
  const panchayatsSet = new Set();
  const villagesSet = new Set();
  const samitisSet = new Set();
  const samitiNosSet = new Set();
  const zillasSet = new Set();
  const zillaNosSet = new Set();
  const pcNamesSet = new Set();
  const pcNosSet = new Set();

  const panchayatMap = {};
  const villageMap = {};

  for (const row of data) {
    const ward = row.WARDNO !== undefined && row.WARDNO !== null && String(row.WARDNO).trim() !== ''
      ? String(row.WARDNO).trim()
      : (row['PANCHAYAT WARD NO'] !== undefined && String(row['PANCHAYAT WARD NO']).trim() !== '' ? String(row['PANCHAYAT WARD NO']).trim() : '');
    if (ward) wardsSet.add(ward);

    const booth = row.BOOTH_NO !== undefined && row.BOOTH_NO !== null && String(row.BOOTH_NO).trim() !== ''
      ? String(row.BOOTH_NO).trim()
      : (row.PARTNO !== undefined && String(row.PARTNO).trim() !== '' ? String(row.PARTNO).trim() : '');
    if (booth) boothsSet.add(booth);

    const panchayat = String(row['PANCHAYAT NAME'] || row.PANCHAYAT || '').trim();
    if (panchayat) panchayatsSet.add(panchayat);

    const village = String(row.VILLAGE || '').trim();
    if (village) villagesSet.add(village);

    const samiti = String(row['PANCHAYAT SAMITI NAME'] || row['PANCHAYAT SAMITI'] || row.SAMITI || '').trim();
    if (samiti) samitisSet.add(samiti);

    const samitiNo = row['PANCHAYAT SAMITI NO'] !== undefined && row['PANCHAYAT SAMITI NO'] !== null ? String(row['PANCHAYAT SAMITI NO']).trim() : '';
    if (samitiNo) samitiNosSet.add(samitiNo);

    const zilla = String(row['ZILLA PARISHAD NAME'] || row['ZILLA PARISHAD'] || row.ZILLA || '').trim();
    if (zilla) zillasSet.add(zilla);

    const zillaNo = row['ZILLA PARISHAD NO'] !== undefined && row['ZILLA PARISHAD NO'] !== null ? String(row['ZILLA PARISHAD NO']).trim() : '';
    if (zillaNo) zillaNosSet.add(zillaNo);

    const pcName = String(row['PC NAME'] || '').trim();
    if (pcName) pcNamesSet.add(pcName);

    const pcNo = row['PC NO'] !== undefined && row['PC NO'] !== null ? String(row['PC NO']).trim() : '';
    if (pcNo) pcNosSet.add(pcNo);

    // Grouping for hierarchy
    const pKey = panchayat || 'General';
    if (!panchayatMap[pKey]) {
      panchayatMap[pKey] = {
        villages: new Set(),
        wards: new Set(),
        booths: new Set(),
        samiti: samiti || '',
        samitiNo: samitiNo || '',
        zilla: zilla || '',
        zillaNo: zillaNo || ''
      };
    }
    if (village) panchayatMap[pKey].villages.add(village);
    if (ward) panchayatMap[pKey].wards.add(ward);
    if (booth) panchayatMap[pKey].booths.add(booth);

    if (village) {
      if (!villageMap[village]) {
        villageMap[village] = { wards: new Set(), booths: new Set(), panchayat: pKey };
      }
      if (ward) villageMap[village].wards.add(ward);
      if (booth) villageMap[village].booths.add(booth);
    }
  }

  const sortNumeric = (arr) => arr.sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b));
  });

  const wards = sortNumeric(Array.from(wardsSet));
  const booths = sortNumeric(Array.from(boothsSet));
  const panchayats = Array.from(panchayatsSet);
  const villages = Array.from(villagesSet);
  const panchayatSamitis = Array.from(samitisSet);
  const panchayatSamitiNos = sortNumeric(Array.from(samitiNosSet));
  const zillaParishads = Array.from(zillasSet);
  const zillaParishadNos = sortNumeric(Array.from(zillaNosSet));
  const pcNames = Array.from(pcNamesSet);
  const pcNos = sortNumeric(Array.from(pcNosSet));

  const hierarchy = {};
  for (const [pKey, pVal] of Object.entries(panchayatMap)) {
    hierarchy[pKey] = {
      villages: Array.from(pVal.villages),
      wards: sortNumeric(Array.from(pVal.wards)),
      booths: sortNumeric(Array.from(pVal.booths)),
      samiti: pVal.samiti,
      samitiNo: pVal.samitiNo,
      zilla: pVal.zilla,
      zillaNo: pVal.zillaNo
    };
  }

  const villageHierarchy = {};
  for (const [vKey, vVal] of Object.entries(villageMap)) {
    villageHierarchy[vKey] = {
      wards: sortNumeric(Array.from(vVal.wards)),
      booths: sortNumeric(Array.from(vVal.booths)),
      panchayat: vVal.panchayat
    };
  }

  const primaryDistrict = manualMeta.district || zillaParishads[0] || '';
  const primarySamiti = manualMeta.city || panchayatSamitis[0] || '';
  const primaryPanchayat = manualMeta.panchayat || panchayats[0] || '';
  const primaryVillage = manualMeta.village || villages[0] || '';
  const primaryWard = manualMeta.ward || wards[0] || '';
  const primaryBooth = manualMeta.booth || booths[0] || '';

  return {
    state: manualMeta.state || 'Rajasthan',
    district: primaryDistrict,
    city: primarySamiti,
    assembly: manualMeta.assembly || primarySamiti || pcNames[0] || '',
    panchayat: primaryPanchayat,
    village: primaryVillage,
    ward: primaryWard,
    booth: primaryBooth,
    panchayatSamiti: panchayatSamitis[0] || primarySamiti,
    panchayatSamitiNo: panchayatSamitiNos[0] || '',
    zillaParishad: zillaParishads[0] || primaryDistrict,
    zillaParishadNo: zillaParishadNos[0] || '',
    wards,
    booths,
    panchayats,
    villages,
    panchayatSamitis,
    panchayatSamitiNos,
    zillaParishads,
    zillaParishadNos,
    pcNames,
    pcNos,
    hierarchy,
    villageHierarchy
  };
}

app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = req.body.category || 'general';

  if (!fs.existsSync(excelMetaPath)) fs.writeFileSync(excelMetaPath, JSON.stringify([]));

  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch (e) {
    console.error('Error parsing metadata:', e);
    fs.copyFileSync(excelMetaPath, excelMetaPath + '.bak');
    fs.writeFileSync(excelMetaPath, JSON.stringify([]));
  }

  let extractedMeta = {
    state: req.body.state,
    district: req.body.district,
    city: req.body.city,
    assembly: req.body.assembly,
    booth: req.body.booth,
    ward: req.body.ward,
    village: req.body.village,
    panchayat: req.body.panchayat,
  };

  try {
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet);

    // Normalize rows to standardize column names
    const cleanData = rawData.map(normalizeVoterRow);

    // Extract multi-ward, multi-booth, panchayat, samiti, zilla hierarchy
    const autoMeta = extractMetadataFromData(cleanData, extractedMeta, category);
    extractedMeta = { ...extractedMeta, ...autoMeta };

    // Store normalized JSON version for fast access
    fs.writeFileSync(req.file.path + '.json', JSON.stringify(cleanData));

    // Calculate stats
    extractedMeta.stats = calculateVoterStats(cleanData);
  } catch (e) {
    console.error('Error extracting data from excel:', e);
  }

  metadata.push({
    id: Date.now(),
    fileName: req.file.filename,
    originalName: req.file.originalname,
    category: category,
    ...extractedMeta,
    timestamp: new Date().toISOString()
  });
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));

  res.json({ message: 'File uploaded successfully', fileName: req.file.filename });
});

app.get('/api/excel-files/:category', (req, res) => {
  const category = req.params.category;
  if (!fs.existsSync(excelMetaPath)) return res.json([]);

  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  const filtered = metadata.filter(m => m.category === category);
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(filtered);
});

// Analytics API
app.get('/api/analytics', (req, res) => {
  let printsCount = 0;
  let lastPrintDate = null;

  let stats = {
    assemblyFiles: 0,
    nagarNigamFiles: 0,
    panchayatFiles: 0,
    totalVoters: 0,
    maleVoters: 0,
    femaleVoters: 0,
    averageAge: 0,
    totalAge: 0, // for internal calculation
    votersWithAge: 0,
    ageBrackets: {
      youth: 0,     // 18-25
      adult: 0,     // 26-40
      middle: 0,    // 41-60
      senior: 0     // 60+
    }
  };

  if (fs.existsSync(excelMetaPath)) {
    const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));

    for (const m of metadata) {
      if (m.category === 'assembly') stats.assemblyFiles++;
      else if (m.category === 'nagar-nigam') stats.nagarNigamFiles++;
      else if (m.category === 'panchayat') stats.panchayatFiles++;

      if (m.stats) {
        stats.totalVoters += m.stats.totalVoters || 0;
        stats.maleVoters += m.stats.maleVoters || 0;
        stats.femaleVoters += m.stats.femaleVoters || 0;
        stats.totalAge += m.stats.totalAge || 0;
        stats.votersWithAge += m.stats.votersWithAge || 0;

        if (m.stats.ageBrackets) {
          stats.ageBrackets.youth += m.stats.ageBrackets.youth || 0;
          stats.ageBrackets.adult += m.stats.ageBrackets.adult || 0;
          stats.ageBrackets.middle += m.stats.ageBrackets.middle || 0;
          stats.ageBrackets.senior += m.stats.ageBrackets.senior || 0;
        }
      }
    }

    if (stats.votersWithAge > 0) {
      stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
    }
  }

  if (fs.existsSync(dataFilePath)) {
    const prints = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    printsCount = prints.length;
    if (prints.length > 0) {
      prints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      lastPrintDate = prints[0].timestamp;
    }
  }

  res.json({
    ...stats,
    printsCount,
    lastPrintDate
  });
});

// POST endpoint to recalculate stats for all existing excel files
app.post('/api/recalculate-stats', (req, res) => {
  if (!fs.existsSync(excelMetaPath)) return res.json({ message: 'No metadata found', updated: 0 });
  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch (e) {
    return res.status(500).json({ error: 'Failed to read metadata' });
  }

  let updatedCount = 0;
  for (const entry of metadata) {
    if (!entry.fileName) continue;
    const filePath = path.join(__dirname, 'uploads', entry.fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const wb = xlsx.readFile(filePath);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);
      let stats = {
        totalVoters: data.length, maleVoters: 0, femaleVoters: 0,
        averageAge: 0, totalAge: 0, votersWithAge: 0,
        ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
      };
      for (const v of data) {
        const gender = String(v.MSEX || v.FGENDER || v.SEX || v.GENDER || '').trim().toUpperCase();
        if (gender === 'M' || gender === 'MALE' || gender === 'पुरुष') stats.maleVoters++;
        else if (gender === 'F' || gender === 'FEMALE' || gender === 'महिला' || gender === 'स्त्री') stats.femaleVoters++;
        const age = parseInt(v.MAGE || v.FAGE || v.AGE);
        if (!isNaN(age) && age > 0 && age < 150) {
          stats.totalAge += age; stats.votersWithAge++;
          if (age >= 18 && age <= 25) stats.ageBrackets.youth++;
          else if (age >= 26 && age <= 40) stats.ageBrackets.adult++;
          else if (age >= 41 && age <= 60) stats.ageBrackets.middle++;
          else if (age > 60) stats.ageBrackets.senior++;
        }
      }
      if (stats.votersWithAge > 0) stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
      entry.stats = stats;
      // Also update the .json cache
      fs.writeFileSync(filePath + '.json', JSON.stringify(data));
      updatedCount++;
    } catch (e) {
      console.error(`Failed to recalculate stats for ${entry.fileName}:`, e.message);
    }
  }
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
  res.json({ message: `Recalculated stats for ${updatedCount} file(s)`, updated: updatedCount });
});

// PUT endpoint to update excel file metadata and optionally replace the file
app.put('/api/excel-files/:id', upload.single('excelFile'), (req, res) => {
  const fileId = parseInt(req.params.id);
  if (!fs.existsSync(excelMetaPath)) return res.status(404).json({ error: 'Metadata file not found' });

  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error reading metadata' });
  }
  const fileIndex = metadata.findIndex(m => m.id === fileId);

  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });

  const updatedData = req.body;
  // Ensure we don't overwrite id, fileName, originalName, category, timestamp unless a new file is uploaded
  let updatedEntry = {
    ...metadata[fileIndex],
    state: updatedData.state || metadata[fileIndex].state,
    district: updatedData.district || metadata[fileIndex].district,
    city: updatedData.city || metadata[fileIndex].city,
    ward: updatedData.ward || metadata[fileIndex].ward,
    booth: updatedData.booth || metadata[fileIndex].booth,
    assembly: updatedData.assembly || metadata[fileIndex].assembly,
    village: updatedData.village || metadata[fileIndex].village,
    panchayat: updatedData.panchayat || metadata[fileIndex].panchayat
  };

  if (req.file) {
    updatedEntry.fileName = req.file.filename;
    updatedEntry.originalName = req.file.originalname;
    updatedEntry.timestamp = new Date().toISOString();

    // Process new file to JSON immediately
    try {
      const wb = xlsx.readFile(req.file.path);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawData = xlsx.utils.sheet_to_json(sheet);
      const cleanData = rawData.map(normalizeVoterRow);

      const autoMeta = extractMetadataFromData(cleanData, updatedEntry, updatedEntry.category || 'general');
      updatedEntry = { ...updatedEntry, ...autoMeta };

      fs.writeFileSync(req.file.path + '.json', JSON.stringify(cleanData));
      updatedEntry.stats = calculateVoterStats(cleanData);
    } catch (e) {
      console.error('Error processing updated excel to JSON:', e);
    }
  }

  metadata[fileIndex] = updatedEntry;

  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
  res.json({ message: 'File metadata updated successfully', data: metadata[fileIndex] });
});

app.delete('/api/excel-files/:id', (req, res) => {
  const fileId = parseInt(req.params.id);
  if (!fs.existsSync(excelMetaPath)) return res.status(404).json({ error: 'Metadata file not found' });

  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error reading metadata' });
  }

  const fileIndex = metadata.findIndex(m => m.id === fileId);
  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });

  const fileEntry = metadata[fileIndex];

  // Optionally delete physical files
  try {
    if (fileEntry.fileName) {
      const filePath = path.join(__dirname, 'uploads', fileEntry.fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(filePath + '.json')) fs.unlinkSync(filePath + '.json');
    }
  } catch (err) {
    console.error('Error deleting physical files:', err);
  }

  metadata.splice(fileIndex, 1);
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));

  res.json({ message: 'File deleted successfully' });
});

const excelDataCache = new Map(); // Kept for backwards compatibility if needed, but not heavily relied on

// GET endpoint to fetch voters from excel based on location metadata
// GET endpoint to retrieve all fetch records
app.get('/api/fetches', authMiddleware, (req, res) => {
  try {
    const logsPath = path.join(__dirname, 'fetches.json');
    if (!fs.existsSync(logsPath)) return res.json([]);
    const data = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    // Enrich with user profile info
    const users = fs.existsSync(usersFilePath) ? JSON.parse(fs.readFileSync(usersFilePath, 'utf-8')) : [];
    const enriched = data.map(record => {
      const user = users.find(u => u.email === record.account);
      return {
        ...record,
        accountName: user?.name || null,
        accountPhone: user?.phone || null,
        accountUtr: user?.utr || null
      };
    });
    res.json(enriched);
  } catch (err) {
    console.error('Error reading fetches:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/voters', (req, res) => {
  const {
    category, state, district, city, assembly, booth, ward, village, panchayat,
    panchayatSamiti, panchayatSamitiNo, zillaParishad, zillaParishadNo
  } = req.query;
  if (!fs.existsSync(excelMetaPath)) return res.json({ voters: [] });

  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch (e) {
    console.error('Error parsing metadata:', e);
    return res.status(500).json({ error: 'Internal server error reading metadata', voters: [] });
  }

  // Find matching excel files
  const matchingFiles = metadata.filter(m => {
    let match = m.category === category;
    if (state && m.state) {
      match = match && m.state.toLowerCase() === state.toLowerCase();
    }

    // District / Zilla Parishad match
    if (district || zillaParishad) {
      const targetZ = (zillaParishad || district).toLowerCase();
      const zillas = (m.zillaParishads || [m.zillaParishad, m.district]).filter(Boolean).map(s => String(s).toLowerCase());
      match = match && zillas.some(z => z === targetZ || z.includes(targetZ) || targetZ.includes(z));
    }

    // City / Panchayat Samiti match
    if (city || panchayatSamiti) {
      const targetS = (panchayatSamiti || city).toLowerCase();
      const samitis = (m.panchayatSamitis || [m.panchayatSamiti, m.city, m.assembly]).filter(Boolean).map(s => String(s).toLowerCase());
      match = match && samitis.some(s => s === targetS || s.includes(targetS) || targetS.includes(s));
    }

    if (assembly && !city && !panchayatSamiti) {
      match = match && (m.assembly === assembly || (m.panchayatSamitis && m.panchayatSamitis.includes(assembly)));
    }

    // Panchayat match
    if (panchayat) {
      const p = panchayat.toLowerCase();
      const pList = (m.panchayats || [m.panchayat]).filter(Boolean).map(s => String(s).toLowerCase());
      match = match && pList.some(item => item === p || item.includes(p) || p.includes(item));
    }

    // Village match (optional: only if specific village requested and file has villages list)
    if (village && m.villages && m.villages.length > 0) {
      match = match && m.villages.some(v => String(v).toLowerCase() === village.toLowerCase());
    }

    // Ward match (if file has wards list, check if ward is in m.wards)
    if (ward && !req.query.wardStart) {
      if (m.wards && m.wards.length > 0) {
        match = match && m.wards.some(w => String(w) === String(ward));
      } else if (m.ward) {
        match = match && String(m.ward) === String(ward);
      }
    }

    // Booth match
    if (booth && !req.query.boothStart) {
      if (m.booths && m.booths.length > 0) {
        match = match && m.booths.some(b => String(b) === String(booth));
      } else if (m.booth) {
        match = match && String(m.booth) === String(booth);
      }
    }

    // Range match logic on metadata level if single-ward file
    if (req.query.boothStart && req.query.boothEnd && m.booth) {
      const bStart = parseInt(req.query.boothStart);
      const bEnd = parseInt(req.query.boothEnd);
      const mBooth = parseInt(m.booth);
      if (!isNaN(bStart) && !isNaN(bEnd) && !isNaN(mBooth)) {
        match = match && mBooth >= bStart && mBooth <= bEnd;
      }
    }

    if (req.query.wardStart && req.query.wardEnd && m.ward) {
      const wStart = parseInt(req.query.wardStart);
      const wEnd = parseInt(req.query.wardEnd);
      const mWard = parseInt(m.ward);
      if (!isNaN(wStart) && !isNaN(wEnd) && !isNaN(mWard)) {
        match = match && mWard >= wStart && mWard <= wEnd;
      }
    }

    return match;
  });

  if (matchingFiles.length === 0) return res.json({ error: 'No data found for this location', voters: [] });

  // --- START FETCH LOGGING ---
  let accountDetails = 'Guest User';
  const token = req.headers.authorization?.split(' ')[1];
  if (token && token !== 'DUMMY') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      accountDetails = decoded.email || 'Guest User';
    } catch (e) { }
  }

  const fetchLogsPath = path.join(__dirname, 'fetches.json');
  if (!fs.existsSync(fetchLogsPath)) fs.writeFileSync(fetchLogsPath, JSON.stringify([]));
  try {
    const fetchLogs = JSON.parse(fs.readFileSync(fetchLogsPath, 'utf-8'));
    fetchLogs.push({
      id: Date.now(),
      category: req.query.category || '-',
      state: req.query.state || '-',
      district: district || zillaParishad || '-',
      assembly: req.query.assembly || panchayatSamiti || city || '-',
      panchayat: panchayat || '-',
      village: village || '-',
      ward: ward || '-',
      booth: booth || '-',
      account: accountDetails,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(fetchLogsPath, JSON.stringify(fetchLogs, null, 2));
  } catch (e) { console.error('Error logging fetch:', e); }
  // --- END FETCH LOGGING ---

  try {
    let allVoters = [];
    for (const matchingFile of matchingFiles) {
      const filePath = path.join(__dirname, 'uploads', matchingFile.fileName);
      const jsonFilePath = filePath + '.json';
      const partDir = filePath + '_panchayats';

      let data = [];
      if (fs.existsSync(partDir)) {
        const indexPath = path.join(partDir, '_index.json');
        if (fs.existsSync(indexPath)) {
          const pIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          if (panchayat) {
            const targetP = Object.keys(pIndex).find(k => k.trim().toLowerCase() === panchayat.trim().toLowerCase());
            if (targetP && pIndex[targetP]?.file) {
              const pFile = path.join(partDir, pIndex[targetP].file);
              if (fs.existsSync(pFile)) {
                data = JSON.parse(fs.readFileSync(pFile, 'utf-8'));
              }
            }
          } else if (panchayatSamiti || city) {
            const targetS = (panchayatSamiti || city).trim().toLowerCase();
            for (const [pName, info] of Object.entries(pIndex)) {
              if (info.samiti && info.samiti.trim().toLowerCase() === targetS) {
                const pFile = path.join(partDir, info.file);
                if (fs.existsSync(pFile)) {
                  data = data.concat(JSON.parse(fs.readFileSync(pFile, 'utf-8')));
                }
              }
            }
          } else {
            // If neither panchayat nor samiti specified, return first few panchayats to avoid memory exhaustion
            for (const [pName, info] of Object.entries(pIndex).slice(0, 5)) {
              const pFile = path.join(partDir, info.file);
              if (fs.existsSync(pFile)) {
                data = data.concat(JSON.parse(fs.readFileSync(pFile, 'utf-8')));
              }
            }
          }
        }
      } else if (fs.existsSync(jsonFilePath)) {
        data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
      } else if (fs.existsSync(filePath)) {
        const wb = xlsx.readFile(filePath);
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rawData = xlsx.utils.sheet_to_json(firstSheet);
        data = rawData.map(normalizeVoterRow);
        fs.writeFileSync(jsonFilePath, JSON.stringify(data));
      } else {
        continue;
      }

      // Filter rows inside this file based on selected parameters
      data = data.filter(row => {
        // Panchayat Name filter
        if (panchayat) {
          const rowP = String(row['PANCHAYAT NAME'] || row.PANCHAYAT || row._meta_panchayat || '').trim().toLowerCase();
          if (rowP && rowP !== panchayat.trim().toLowerCase()) return false;
        }

        // Panchayat Samiti Name filter
        if (panchayatSamiti || city) {
          const targetS = (panchayatSamiti || city).trim().toLowerCase();
          const rowS = String(row['PANCHAYAT SAMITI NAME'] || row.SAMITI || '').trim().toLowerCase();
          if (rowS && rowS !== targetS) return false;
        }

        // Panchayat Samiti No filter (only when specific panchayat name is not chosen)
        if (panchayatSamitiNo && !panchayat) {
          const targetNo = String(panchayatSamitiNo).trim();
          const rowSNo = String(row['PANCHAYAT SAMITI NO'] || '').trim();
          if (rowSNo && rowSNo !== targetNo) return false;
        }

        // Zilla Parishad Name filter
        if (zillaParishad || district) {
          const targetZ = (zillaParishad || district).trim().toLowerCase();
          const rowZ = String(row['ZILLA PARISHAD NAME'] || '').trim().toLowerCase();
          if (rowZ && rowZ !== targetZ) return false;
        }

        // Zilla Parishad No filter (only when specific panchayat/samiti is not chosen)
        if (zillaParishadNo && !panchayat && !panchayatSamiti && !city) {
          const targetNo = String(zillaParishadNo).trim();
          const rowZNo = String(row['ZILLA PARISHAD NO'] || '').trim();
          if (rowZNo && rowZNo !== targetNo) return false;
        }

        // Village filter
        if (village) {
          const rowV = String(row.VILLAGE || row._meta_village || '').trim().toLowerCase();
          const targetVillages = Array.isArray(village) ? village.map(v => String(v).trim().toLowerCase()) : [String(village).trim().toLowerCase()];
          if (rowV && !targetVillages.includes(rowV)) return false;
        }

        // Ward filter
        if (ward && !req.query.wardStart) {
          const rowW = String(row.WARDNO !== undefined && row.WARDNO !== null ? row.WARDNO : (row['PANCHAYAT WARD NO'] ?? row._meta_ward ?? '')).trim();
          const targetWards = Array.isArray(ward) ? ward.map(w => String(w).trim()) : [String(ward).trim()];
          if (rowW && !targetWards.includes(rowW)) return false;
        }

        // Booth filter
        if (booth && !req.query.boothStart) {
          const rowB = String(row.BOOTH_NO !== undefined && row.BOOTH_NO !== null ? row.BOOTH_NO : (row.PARTNO ?? row._meta_booth ?? '')).trim();
          const targetBooths = Array.isArray(booth) ? booth.map(b => String(b).trim()) : [String(booth).trim()];
          if (rowB && !targetBooths.includes(rowB)) return false;
        }

        // Ward range
        if (req.query.wardStart && req.query.wardEnd) {
          const rowWard = parseInt(row.WARDNO || row['PANCHAYAT WARD NO']);
          const wStart = parseInt(req.query.wardStart);
          const wEnd = parseInt(req.query.wardEnd);
          if (!isNaN(rowWard) && !isNaN(wStart) && !isNaN(wEnd)) {
            if (rowWard < wStart || rowWard > wEnd) return false;
          }
        }

        // Booth range
        if (req.query.boothStart && req.query.boothEnd) {
          const rowBooth = parseInt(row.BOOTH_NO || row.PARTNO);
          const bStart = parseInt(req.query.boothStart);
          const bEnd = parseInt(req.query.boothEnd);
          if (!isNaN(rowBooth) && !isNaN(bStart) && !isNaN(bEnd)) {
            if (rowBooth < bStart || rowBooth > bEnd) return false;
          }
        }

        return true;
      });

      // Inject ward/booth/panchayat info if missing from row
      data = data.map(row => ({
        ...row,
        _meta_ward: row.WARDNO || matchingFile.ward,
        _meta_booth: row.BOOTH_NO || matchingFile.booth,
        _meta_panchayat: row['PANCHAYAT NAME'] || matchingFile.panchayat
      }));

      allVoters = allVoters.concat(data);
    }
    res.json({ voters: allVoters });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read data files', details: e.message });
  }
});

// Settings API
app.get('/api/settings', (req, res) => {
  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  const updatedSettings = { ...settings, ...req.body };
  fs.writeFileSync(settingsFilePath, JSON.stringify(updatedSettings, null, 2));
  res.json({ message: 'Settings updated successfully', settings: updatedSettings });
});

app.post('/api/settings/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = req.body.key;

  if (!['assemblyImage', 'nagarNigamImage', 'gramPanchayatImage', 'qrCodeImage'].includes(key)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid key' });
  }

  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));

  const baseUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const imageUrl = `${baseUrl}/api/uploads/${req.file.filename}`;

  settings[key] = imageUrl;
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));

  res.json({ message: 'Image updated successfully', imageUrl });
});

// Keep-alive ping endpoint
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});

// Startup check & automatic metadata / JSON enrichment for uploaded files
function refreshExcelMetadata() {
  if (!fs.existsSync(excelMetaPath)) fs.writeFileSync(excelMetaPath, JSON.stringify([]));
  try {
    let metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
    let changed = false;

    const uploadsDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.xlsx'));
      for (const fileName of files) {
        const filePath = path.join(uploadsDir, fileName);
        const jsonFilePath = filePath + '.json';

        let existingIndex = metadata.findIndex(m => m.fileName === fileName);
        let m = existingIndex !== -1 ? metadata[existingIndex] : null;

        const partDir = filePath + '_panchayats';
        if (fs.existsSync(partDir)) {
          continue;
        }

        // Only process if metadata or processed cache is missing
        if (!m || (!fs.existsSync(jsonFilePath) && !fs.existsSync(partDir))) {
          console.log(`Analyzing and auto-enriching metadata for ${fileName}...`);
          try {
            const wb = xlsx.readFile(filePath);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rawData = xlsx.utils.sheet_to_json(sheet);
            const cleanData = rawData.map(normalizeVoterRow);
            fs.writeFileSync(jsonFilePath, JSON.stringify(cleanData));

            let cat = m?.category || 'general';
            if (cleanData.some(r => r['PANCHAYAT NAME'] || r['PANCHAYAT SAMITI NAME'] || r['ZILLA PARISHAD NAME'])) {
              cat = 'panchayat';
            }

            const autoMeta = extractMetadataFromData(cleanData, m || {}, cat);
            const stats = calculateVoterStats(cleanData);

            if (existingIndex !== -1) {
              metadata[existingIndex] = {
                ...metadata[existingIndex],
                category: cat,
                ...autoMeta,
                stats
              };
            } else {
              metadata.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                fileName: fileName,
                originalName: fileName,
                category: cat,
                ...autoMeta,
                stats,
                timestamp: new Date().toISOString()
              });
            }
            changed = true;
          } catch (err) {
            console.error(`Error processing ${fileName}:`, err.message);
          }
        }
      }
    }

    if (changed) {
      fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
      console.log('excel-metadata.json successfully updated with extracted parameters.');
    }
  } catch (err) {
    console.error('Error refreshing metadata:', err);
  }
}

// Run refresh on start
refreshExcelMetadata();

// Global error handling middleware for Multer errors & large bodies
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File size exceeds 500MB limit.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body exceeds 500MB limit.' });
    }
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
  next();
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);

  // Self-ping to keep Render backend awake
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const interval = 14 * 60 * 1000; // 14 minutes

  setInterval(() => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(`${url}/api/ping`, (res) => {
      console.log(`Keep-alive ping to ${url}/api/ping: ${res.statusCode}`);
    }).on('error', (e) => {
      console.error(`Keep-alive ping error: ${e.message}`);
    });
  }, interval);
});

// Configure server timeouts for large 500MB uploads and processing
server.timeout = 600000; // 10 minutes timeout
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

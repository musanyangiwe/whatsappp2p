const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: Generate transaction ID
function generateTxnId() {
  return 'TXN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Helper: Log action
async function logAction(action, userPhone, details) {
  await supabase.from('logs').insert({
    action,
    user_phone: userPhone,
    details
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'API is running' });
});

// 1. Initiate Transfer
app.post('/initiate-transfer', async (req, res) => {
  try {
    const { sender_phone, receiver_phone, amount } = req.body;

    if (!sender_phone || !receiver_phone || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: 'Amount must be between R1 and R10,000' });
    }

    const txn_id = generateTxnId();
    const otp_code = generateOTP();

    // Create transaction
    await supabase.from('transactions').insert({
      txn_id,
      sender_phone,
      receiver_phone,
      amount,
      method: 'atm_withdrawal',
      status: 'otp_sent'
    });

    // Store OTP
    await supabase.from('otps').insert({
      txn_id,
      code: otp_code,
      expiry: new Date(Date.now() + 2 * 60 * 60 * 1000)
    });

    // Log
    await logAction('initiated_transfer', sender_phone, {
      txn_id,
      receiver_phone,
      amount
    });

    // Also log the OTP (for debugging)
    await logAction('generated_otp', sender_phone, {
      txn_id,
      code: otp_code
    });

    res.json({
      success: true,
      txn_id,
      otp_code,
      message: `Transfer initiated. OTP sent to receiver. R${amount} ready for ATM withdrawal.`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Validate OTP
app.post('/validate-otp', async (req, res) => {
  try {
    const { txn_id, otp_code, receiver_phone } = req.body;

    if (!txn_id || !otp_code || !receiver_phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get transaction
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (txnError || !txn) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Get OTP
    const { data: otp, error: otpError } = await supabase
      .from('otps')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (otpError || !otp) {
      return res.status(404).json({ error: 'OTP not found' });
    }

    if (otp.used) {
      return res.status(400).json({ error: 'OTP already used' });
    }

    if (new Date() > new Date(otp.expiry)) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    if (otp.code !== otp_code) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark OTP as used
    await supabase
      .from('otps')
      .update({ used: true, used_at: new Date() })
      .eq('id', otp.id);

    // Mark transaction ready for withdrawal
    await supabase
      .from('transactions')
      .update({ status: 'ready_for_withdrawal' })
      .eq('txn_id', txn_id);

    await logAction('validated_otp', receiver_phone, { txn_id });

    res.json({
      success: true,
      txn_id,
      status: 'ready_for_withdrawal',
      amount: txn.amount,
      message: `✅ OTP validated! R${txn.amount} ready at ATM`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 3. ATM Withdraw
app.post('/atm-withdraw', async (req, res) => {
  try {
    const { txn_id, receiver_phone, otp_code, atm_location } = req.body;

    if (!txn_id || !receiver_phone || !otp_code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get transaction
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (txnError || !txn) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (txn.status !== 'ready_for_withdrawal') {
      return res.status(400).json({ error: 'Transaction not ready for withdrawal' });
    }

    // Get & verify OTP
    const { data: otp } = await supabase
      .from('otps')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (!otp || otp.code
git add app.js
git commit -m "Add OTP logging and return"
git push origin main
grep "otp_code" app.js
[200~grep "otp_code" app.js~
E0F

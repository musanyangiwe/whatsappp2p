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

    // Validate inputs
    if (!sender_phone || !receiver_phone || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: 'Amount must be between R1 and R10,000' });
    }

    // Generate transaction ID
    const txn_id = generateTxnId();

    // Create transaction record
    const { data, error } = await supabase.from('transactions').insert({
      txn_id,
      sender_phone,
      receiver_phone,
      amount,
      method: 'account_deposit',
      status: 'initiated'
    });

    if (error) throw error;

    // Log the action
    await logAction('initiated_transfer', sender_phone, {
      txn_id,
      receiver_phone,
      amount
    });

    res.json({
      success: true,
      txn_id,
      message: 'Transfer initiated. Generating OTP...'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Generate OTP
app.post('/generate-otp', async (req, res) => {
  try {
    const { txn_id } = req.body;

    if (!txn_id) {
      return res.status(400).json({ error: 'txn_id required' });
    }

    // Check if transaction exists
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (txnError || !txn) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Generate OTP (6 digits)
    const code = generateOTP();
    const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Store OTP
    const { error: otpError } = await supabase.from('otps').insert({
      txn_id,
      code,
      expiry
    });

    if (otpError) throw otpError;

    // Log action
    await logAction('generated_otp', txn.sender_phone, { txn_id, code });

    // In real world, send via Twilio SMS/WhatsApp
    // For now, return code (demo purposes)
    res.json({
      success: true,
      txn_id,
      otp_code: code,
      message: 'OTP generated. Send via WhatsApp to receiver.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Validate OTP
app.post('/validate-otp', async (req, res) => {
  try {
    const { txn_id, otp_code, receiver_phone } = req.body;

    if (!txn_id || !otp_code || !receiver_phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get OTP record
    const { data: otp, error: otpError } = await supabase
      .from('otps')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (otpError || !otp) {
      return res.status(404).json({ error: 'OTP not found' });
    }

    // Check if already used
    if (otp.used) {
      return res.status(400).json({ error: 'OTP already used' });
    }

    // Check if expired
    if (new Date() > new Date(otp.expiry)) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    // Check if code matches
    if (otp.code !== otp_code) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark OTP as used
    await supabase
      .from('otps')
      .update({ used: true, used_at: new Date() })
      .eq('id', otp.id);

    // Update transaction to completed
    const { data: txn } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    await supabase
      .from('transactions')
      .update({
        status: 'completed',
        completed_at: new Date()
      })
      .eq('txn_id', txn_id);

    // Log action
    await logAction('validated_otp', receiver_phone, { txn_id });

    res.json({
      success: true,
      txn_id,
      status: 'completed',
      message: 'Transfer completed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Get Transaction Status
app.get('/transaction-status/:txn_id', async (req, res) => {
  try {
    const { txn_id } = req.params;

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('txn_id', txn_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({
      txn_id: data.txn_id,
      status: data.status,
      sender_phone: data.sender_phone,
      receiver_phone: data.receiver_phone,
      amount: data.amount,
      created_at: data.created_at,
      completed_at: data.completed_at
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Admin Logs
app.get('/admin-logs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    res.json({
      total: data.length,
      logs: data
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

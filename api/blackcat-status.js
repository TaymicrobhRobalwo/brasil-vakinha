export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.BLACKCAT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'Missing BLACKCAT_API_KEY env var' });
    }

    const transactionId = String(req.query.transaction_id || '').trim();
    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'transaction_id is required' });
    }

    const url = `https://api.blackcatpagamentos.online/api/sales/${encodeURIComponent(transactionId)}/status`;

    const upstream = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error', error: String(err) });
  }
}
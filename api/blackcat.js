export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const apiKey = process.env.BLACKCAT_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: 'Missing BLACKCAT_API_KEY env var' });
        }

        const upstream = await fetch('https://api.blackcatpagamentos.online/api/sales/create-sale', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify(req.body),
        });

        const text = await upstream.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        return res.status(upstream.status).json(data);
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Server error', error: String(err) });
    }
}


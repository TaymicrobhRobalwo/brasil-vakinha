export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

    try {
        const token = process.env.UTMIFY_API_TOKEN;
        if (!token) return res.status(500).json({ error: "UTMIFY_API_TOKEN não configurado" });

        const { clickId, utms, transactionId, amountCents } = req.body || {};

        const payload = {
            event: "PIX_PAGO",
            status: "PAID",
            external_id: String(transactionId || ""),
            click_id: String(clickId || ""),
            amount: Number(amountCents || 0),
            currency: "BRL",
            utm: utms || {}
        };

        const r = await fetch("https://api.utmify.com.br/api-credentials/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-token": token
            },
            body: JSON.stringify(payload)
        });

        const data = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(400).json({ error: "UTMify retornou erro", details: data });

        return res.status(200).json({ ok: true, utmify: data });
    } catch (err) {
        return res.status(500).json({ error: "Erro interno", details: String(err?.message || err) });
    }
}
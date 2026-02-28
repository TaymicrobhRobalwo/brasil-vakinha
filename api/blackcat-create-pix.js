// api/blackcat-create-pix.js
// Vercel Serverless Function (Node / CommonJS)

async function readJsonBody(req) {
    return await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error("JSON inválido no body")); }
        });
        req.on("error", reject);
    });
}

function onlyDigits(v) {
    return String(v || "").replace(/\D+/g, "");
}

function safeTrim(v) {
    return String(v || "").trim();
}

async function sendToUtmify(orderPayload) {
    const token = process.env.UTMIFY_API_TOKEN;
    if (!token) return { skipped: true, reason: "UTMIFY_API_TOKEN ausente" };

    const resp = await fetch("https://api.utmify.com.br/api-credentials/orders", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-token": token
        },
        body: JSON.stringify(orderPayload)
    });

    const raw = await resp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!resp.ok) {
        return { ok: false, status: resp.status, data };
    }
    return { ok: true, data };
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

    try {
        const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
        const API_KEY = process.env.BLACKCAT_API_KEY;

        if (!API_KEY) {
            return res.status(500).json({ error: "BLACKCAT_API_KEY não configurada na Vercel." });
        }

        const body = await readJsonBody(req);

        // UTMs (vindas do front)
        const utmify = body.utmify || {};
        const utm_source = safeTrim(utmify.utm_source);
        const utm_medium = safeTrim(utmify.utm_medium);
        const utm_campaign = safeTrim(utmify.utm_campaign);
        const utm_content = safeTrim(utmify.utm_content);
        const utm_term = safeTrim(utmify.utm_term);

        const amount = Number(body.amount_cents || body.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: "amount (centavos) inválido." });
        }

        const payer = body.payer || {};
        const name = safeTrim(payer.name);
        const email = safeTrim(payer.email);
        const phone = onlyDigits(payer.phone);
        const cpf = onlyDigits(payer.cpf);

        if (!name || !email || !phone || cpf.length !== 11) {
            return res.status(400).json({
                error: "Dados do cliente incompletos/invalidos (name/email/phone/cpf).",
                received: { name: !!name, email: !!email, phone_len: phone.length, cpf_len: cpf.length }
            });
        }

        const externalRef = `vakinha_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        // ✅ payload 1:1 com a doc Blackcat
        const payload = {
            amount,
            currency: "BRL",
            paymentMethod: "pix",
            items: [
                {
                    title: "Doação - SOS Juiz de Fora",
                    unitPrice: amount,
                    quantity: 1,
                    tangible: false
                }
            ],
            customer: {
                name,
                email,
                phone,
                document: {
                    number: cpf,
                    type: "cpf"
                }
            },
            pix: {
                expiresInDays: 1
            },
            // metadata livre (string)
            metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,

            // postback
            postbackUrl: process.env.BLACKCAT_POSTBACK_URL || undefined,

            // referencia
            externalRef,

            // ✅ UTMs (a doc da Blackcat mostra esses campos como opcionais)
            utm_source: utm_source || undefined,
            utm_medium: utm_medium || undefined,
            utm_campaign: utm_campaign || undefined,
            utm_content: utm_content || undefined,
            utm_term: utm_term || undefined
        };

        Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

        const url = `${BASE_URL}/sales/create-sale`;

        const bcResp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": API_KEY
            },
            body: JSON.stringify(payload)
        });

        const raw = await bcResp.text();
        let data;
        try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (!bcResp.ok) {
            return res.status(400).json({
                error: "Blackcat retornou erro ao criar venda.",
                status: bcResp.status,
                response: data,
                sent_payload: payload
            });
        }

        const d = data?.data || data;

        const transaction_id = d?.transactionId || null;
        const status = String(d?.status || "PENDING").toUpperCase();

        const pix_payload =
            d?.paymentData?.copyPaste ||
            d?.paymentData?.qrCode ||
            d?.paymentData?.emv ||
            "";

        const qr_code_base64 = d?.paymentData?.qrCodeBase64 || null;
        const expires_at_iso = d?.paymentData?.expiresAt || null;
        const invoice_url = d?.invoiceUrl || null;

        // ✅ Envia pedido pra UTMIFY (evento de "order created")
        // (Se você preferir enviar só quando PAID, a gente muda pro webhook/polling depois)
        const utmifyOrderPayload = {
            // tente manter um identificador único
            orderId: transaction_id || externalRef,
            externalRef,
            status,                 // PENDING
            amount,                 // centavos
            currency: "BRL",

            customer: { name, email, phone, cpf },

            // UTMs
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,

            // contexto
            createdAt: new Date().toISOString(),
            invoiceUrl: invoice_url || undefined
        };

        const utmifyResult = await sendToUtmify(utmifyOrderPayload);

        return res.status(200).json({
            transaction_id,
            amount_cents: amount,
            status,
            pix_payload,
            qr_code_base64,
            expires_at_iso,
            invoice_url,
            utmify: utmifyResult,
            original: data
        });

    } catch (err) {
        return res.status(500).json({
            error: "Erro interno no backend",
            details: String(err?.message || err)
        });
    }
};
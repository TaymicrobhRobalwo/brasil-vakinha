// /api/blackcat-webhook.js
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    // (Recomendado) token anti-spam
    const expectedToken = process.env.BLACKCAT_WEBHOOK_TOKEN;
    if (expectedToken) {
        const token = String(req.query.token || "");
        if (token !== expectedToken) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
    }

    try {
        const body = req.body || {};
        // Blackcat pode mandar algo como { data: {...} } ou direto {...}
        const tx = body.data || body;

        const statusRaw = String(tx.status || "").toLowerCase(); // "paid", "pending", "cancelled"...
        const transactionId = tx.transactionId || tx.id || tx.referenceId || null;
        const externalRef = tx.externalRef || tx.metadata?.orderId || null;

        // Escolha um orderId consistente pra Utmify:
        // - prioriza externalRef (que você setou como pedidoId)
        // - cai pra transactionId se não existir
        const orderId = externalRef || transactionId;
        if (!orderId) {
            return res.status(400).json({ success: false, message: "Missing orderId/externalRef/transactionId" });
        }

        // Mapeamento status Blackcat -> Utmify
        // Ajuste se na sua Blackcat vier com outros nomes
        let utmifyStatus = "waiting_payment";
        if (["paid", "approved", "completed", "succeeded"].includes(statusRaw)) utmifyStatus = "paid";
        else if (["cancelled", "canceled", "refused", "expired"].includes(statusRaw)) utmifyStatus = "cancelled";
        else if (["refunded"].includes(statusRaw)) utmifyStatus = "refunded";

        // Datas: tenta usar timestamps do tx; senão usa agora em UTC no formato do seu checkout
        const now = new Date();
        const formatUtc = (date) => {
            const pad = (n) => String(n).padStart(2, "0");
            return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
                `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
        };

        const createdAt = tx.createdAt ? formatUtc(new Date(tx.createdAt)) : formatUtc(now);
        const approvedDate = (utmifyStatus === "paid")
            ? (tx.paidAt ? formatUtc(new Date(tx.paidAt)) : formatUtc(now))
            : null;

        // Tracking: pega do próprio tx (porque você vai enviar UTM no create-sale)
        const trackingParameters = {
            src: tx.src || null,
            sck: tx.sck || null,
            utm_source: tx.utm_source || null,
            utm_medium: tx.utm_medium || null,
            utm_campaign: tx.utm_campaign || null,
            utm_content: tx.utm_content || null,
            utm_term: tx.utm_term || null,
        };

        // Valor em centavos (a doc diz centavos)
        const amount = Number(tx.amount || 0);

        // Monte payload no MESMO formato do seu utmifySendPix()
        const utmifyPayload = {
            orderId,
            platform: "BlackCat",
            paymentMethod: "pix",
            status: utmifyStatus,
            createdAt,
            approvedDate,
            refundedAt: utmifyStatus === "refunded" ? formatUtc(now) : null,
            customer: {
                name: tx.customer?.name || "Cliente",
                email: tx.customer?.email || "",
                phone: (tx.customer?.phone || "").replace(/\D/g, "") || null,
                document: tx.customer?.document?.number || null,
                country: "BR",
            },
            products: [{
                id: "combo-black-friday",
                name: "Colar Pérola Negra - 7mm",
                planId: null,
                planName: null,
                quantity: 1,
                priceInCents: amount || 0
            }],
            trackingParameters,
            commission: {
                totalPriceInCents: amount || 0,
                gatewayFeeInCents: Number(tx.fees || 0) || 0,
                userCommissionInCents: amount || 0,
                currency: "BRL",
            }
        };

        // Envia pro seu /api/utmify (que já encaminha para UTMify com token)
        // IMPORTANTE: use URL absoluta em produção pra evitar problemas.
        const baseUrl =
            process.env.PUBLIC_BASE_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

        const url = `${baseUrl}/api/utmify`;

        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(utmifyPayload),
        });

        const result = await resp.json().catch(() => ({}));

        // Responda 200 pra Blackcat não ficar reenviando
        return res.status(200).json({ success: true, forwarded: true, utmify: result });
    } catch (err) {
        console.error("BLACKCAT WEBHOOK ERROR:", err);
        // Responder 200 mesmo em erro (pra evitar retry infinito),
        // mas logar e investigar. Se preferir retry, devolva 500.
        return res.status(200).json({ success: false, message: "Webhook error", error: String(err) });
    }
}
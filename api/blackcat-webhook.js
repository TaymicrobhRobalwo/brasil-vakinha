// api/blackcat-webhook.js

export default async function handler(req, res) {
    // (Opcional) CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

    try {
        const BASE_URL =
            process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
        const BLACKCAT_KEY = process.env.BLACKCAT_API_KEY;
        const UTMIFY_TOKEN = process.env.UTMIFY_API_TOKEN;

        if (!BLACKCAT_KEY) {
            // webhook: melhor responder 200 pra evitar retry infinito do gateway
            return res.status(200).json({ ok: false, error: "BLACKCAT_API_KEY não configurada." });
        }
        if (!UTMIFY_TOKEN) {
            return res.status(200).json({ ok: false, error: "UTMIFY_API_TOKEN não configurada." });
        }

        const body = req.body || {};

        // Tenta achar transactionId em vários formatos comuns
        const transactionId =
            body?.transactionId ||
            body?.data?.transactionId ||
            body?.sale?.transactionId ||
            body?.id ||
            body?.data?.id ||
            null;

        if (!transactionId) {
            return res.status(200).json({
                ok: true,
                ignored: true,
                reason: "Webhook sem transactionId",
                received: body
            });
        }

        // 1) Confirma status direto na Blackcat (fonte da verdade)
        const statusUrl = `${BASE_URL}/sales/${encodeURIComponent(transactionId)}/status`;

        const stResp = await fetch(statusUrl, {
            method: "GET",
            headers: { "X-API-Key": BLACKCAT_KEY }
        });

        const stRaw = await stResp.text();
        let stJson;
        try {
            stJson = JSON.parse(stRaw);
        } catch {
            stJson = { raw: stRaw };
        }

        if (!stResp.ok) {
            return res.status(200).json({
                ok: false,
                step: "blackcat_status_failed",
                transactionId,
                blackcat: { httpStatus: stResp.status, response: stJson }
            });
        }

        const d = stJson?.data || stJson;
        const status = String(d?.status || "").toUpperCase(); // PENDING / PAID / CANCELLED / REFUNDED
        const paymentMethod = String(d?.paymentMethod || "PIX").toUpperCase();
        const amount = Number(d?.amount || 0); // centavos
        const paidAt = d?.paidAt || null;
        const endToEndId = d?.endToEndId || null;

        // 2) Só manda pra Utmify quando estiver PAID
        if (status !== "PAID") {
            return res.status(200).json({
                ok: true,
                transactionId,
                status,
                note: "Ainda não PAID, não enviei para Utmify."
            });
        }

        // 3) Monta payload para Utmify (UPSERT no endpoint /orders)
        // (Como seu utmify.js só repassa payload, aqui a gente manda um objeto completo.)
        const utmifyPayload = {
            orderId: transactionId,          // identificador principal
            transactionId,                   // redundância útil
            status: "PAID",
            paymentMethod,
            amount,                          // centavos
            currency: "BRL",
            paidAt: paidAt || new Date().toISOString(),
            endToEndId: endToEndId || undefined,

            // você pode incluir mais campos se tiver salvo UTMs/cliente no momento do create-sale
            // ex: utm_source, utm_campaign, customer, items...
        };

        // limpa undefined
        Object.keys(utmifyPayload).forEach((k) => utmifyPayload[k] === undefined && delete utmifyPayload[k]);

        // 4) Envia para Utmify no MESMO padrão do seu utmify.js (x-api-token)
        const utResp = await fetch("https://api.utmify.com.br/api-credentials/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-token": UTMIFY_TOKEN
            },
            body: JSON.stringify(utmifyPayload)
        });

        const utRaw = await utResp.text();
        let utJson;
        try {
            utJson = JSON.parse(utRaw);
        } catch {
            utJson = { raw: utRaw };
        }

        return res.status(200).json({
            ok: true,
            transactionId,
            status: "PAID",
            utmify: {
                httpStatus: utResp.status,
                response: utJson
            }
        });

    } catch (error) {
        // webhook: responder 200 evita retry agressivo do provedor
        return res.status(200).json({
            ok: false,
            error: "Erro no webhook",
            details: String(error?.message || error)
        });
    }
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const body = req.body || {};
        const status = String(body.status || "").toUpperCase();

        // Sempre responder 200 rápido pra Blackcat não ficar reenviando
        // Mas antes, executamos nossa lógica.
        if (status === "PAID") {
            // Pega utms do metadata
            let metadata = {};
            try {
                metadata = typeof body.metadata === "string" ? JSON.parse(body.metadata) : (body.metadata || {});
            } catch (e) { }

            // Chama seu endpoint utmify (PIX_PAGO)
            await fetch(`${process.env.APP_URL}/api/utmify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    event: "pix_pago",
                    transactionId: body.transactionId,
                    amount: body.amount, // centavos
                    metadata
                }),
            });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        // Mesmo com erro, devolve 200 pra Blackcat não floodar
        return res.status(200).json({ ok: true });
    }
}
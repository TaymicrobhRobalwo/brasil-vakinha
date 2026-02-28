// Vercel Serverless Function (Node / CommonJS)

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("JSON inválido no body"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  // CORS (opcional, mas ajuda se você abrir a página de outro domínio)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  try {
    const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
    const API_KEY = process.env.BLACKCAT_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: "BLACKCAT_API_KEY não configurada na Vercel.",
        hint: "Vercel > Settings > Environment Variables > BLACKCAT_API_KEY"
      });
    }

    const body = await readJsonBody(req);

    // front manda amount_cents e payer.*
    const amount = Number(body.amount_cents || body.amount || 0); // em centavos

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount (centavos) inválido.", received: body.amount_cents || body.amount });
    }

    const payer = body.payer || {};
    const name = String(payer.name || "").trim();
    const email = String(payer.email || "").trim();
    const phone = String(payer.phone || "").trim();
    const cpf = String(payer.cpf || "").trim();

    if (!name || !email || !phone || !cpf) {
      return res.status(400).json({
        error: "Dados do cliente incompletos (name/email/phone/cpf).",
        received: { name: !!name, email: !!email, phone: !!phone, cpf: !!cpf }
      });
    }

    const externalRef = `vakinha_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // Doc: POST /sales/create-sale
    const payload = {
      amount,
      currency: "BRL",
      paymentMethod: "PIX",
      items: [
        { name: "Doação - SOS Juiz de Fora", quantity: 1, unitPrice: amount }
      ],
      customer: { name, email, phone, cpf },
      externalRef,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
      postbackUrl: process.env.BLACKCAT_POSTBACK_URL || undefined
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

    // Doc padrão: { success: true, data: { transactionId, status, pix: { ... } } }
    const d = data?.data || data;

    const transaction_id = d?.transactionId || d?.id || d?.saleId || null;
    const status = String(d?.status || "PENDING").toUpperCase();

    const pix_payload =
      d?.pix?.copyPaste ||
      d?.pix?.code ||
      d?.pix?.payload ||
      d?.pix?.emv ||
      "";

    const expires_at_iso =
      d?.pix?.expiresAt ||
      d?.pix?.expires_at ||
      null;

    return res.status(200).json({
      transaction_id,
      amount_cents: amount,
      status,
      pix_payload,
      expires_at_iso,
      original: data
    });

  } catch (err) {
    return res.status(500).json({
      error: "Erro interno no backend",
      details: String(err?.message || err)
    });
  }
};
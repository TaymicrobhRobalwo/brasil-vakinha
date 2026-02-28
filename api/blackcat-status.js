// api/blackcat-status.js
// Consulta status na Blackcat: GET /sales/{transactionId}/status

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  try {
    const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
    const API_KEY = process.env.BLACKCAT_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "BLACKCAT_API_KEY não configurada." });
    }

    // aceita ?id=TXN... ou ?transactionId=TXN...
    const urlObj = new URL(req.url, `https://${req.headers.host}`);
    const transactionId = urlObj.searchParams.get("id") || urlObj.searchParams.get("transactionId");

    if (!transactionId) {
      return res.status(400).json({ error: "transactionId é obrigatório. Use ?id=TXN..." });
    }

    const bcUrl = `${BASE_URL}/sales/${encodeURIComponent(transactionId)}/status`;

    const bcResp = await fetch(bcUrl, {
      method: "GET",
      headers: { "X-API-Key": API_KEY }
    });

    const raw = await bcResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!bcResp.ok) {
      return res.status(400).json({
        error: "Blackcat retornou erro ao consultar status.",
        status: bcResp.status,
        response: data
      });
    }

    // Doc: { success:true, data:{ status:'PAID' ... } }
    const d = data?.data || data;
    const status = String(d?.status || "").toUpperCase();

    return res.status(200).json({
      success: true,
      transactionId,
      status,
      original: data
    });

  } catch (err) {
    return res.status(500).json({
      error: "Erro interno no backend",
      details: String(err?.message || err)
    });
  }
};
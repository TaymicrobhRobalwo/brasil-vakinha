// Vercel Serverless Function (Node / CommonJS)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  try {
    const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
    const API_KEY = process.env.BLACKCAT_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "BLACKCAT_API_KEY não configurada na Vercel." });
    }

    const id = String(req.query?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Parâmetro id é obrigatório." });

    // Doc: GET /sales/{transactionId}/status
    const url = `${BASE_URL}/sales/${encodeURIComponent(id)}/status`;

    const bcResp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
      }
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

    const d = data?.data || data;
    const status = String(d?.status || "PENDING").toUpperCase();

    return res.status(200).json({ status, original: data });

  } catch (err) {
    return res.status(500).json({ error: "Erro interno", details: String(err?.message || err) });
  }
};
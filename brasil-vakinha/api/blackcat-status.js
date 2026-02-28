export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
    const TOKEN = process.env.BLACKCAT_API_TOKEN;

    // Ajuste se sua rota de status for diferente:
    // ex: /pix/status?id=...  OU /pix/<id>  OU /transactions/<id>
    const STATUS_PATH_TEMPLATE = process.env.BLACKCAT_PIX_STATUS_PATH_TEMPLATE || "/pix/{id}";

    if (!TOKEN) {
      return res.status(500).json({ error: "BLACKCAT_API_TOKEN não configurado na Vercel." });
    }

    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "Parâmetro id é obrigatório." });

    const path = STATUS_PATH_TEMPLATE.replace("{id}", encodeURIComponent(id));
    const url = `${BASE_URL}${path}`;

    const bcResp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`,
        "x-api-token": TOKEN
      }
    });

    const raw = await bcResp.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!bcResp.ok) {
      return res.status(400).json({
        error: "Erro na Blackcat ao consultar status.",
        details: data
      });
    }

    // Normaliza status
    const status =
      data?.status ||
      data?.data?.status ||
      data?.charge?.status ||
      data?.pix?.status ||
      "unknown";

    return res.status(200).json({ status, original: data });

  } catch (err) {
    return res.status(500).json({ error: "Erro interno", details: String(err?.message || err) });
  }
}
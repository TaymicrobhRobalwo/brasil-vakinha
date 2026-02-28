// api/utmify.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const utmifyToken = process.env.UTMIFY_API_TOKEN;

    if (!utmifyToken) {
      return res.status(500).json({ error: 'Token da Utmify não configurado' });
    }

    const payload = req.body;

    const response = await fetch('https://api.utmify.com.br/api-credentials/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': utmifyToken
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    return res.status(response.status).json(result);

  } catch (error) {
    console.error('ERRO UTMIFY:', error);
    return res.status(500).json({
      error: 'Erro ao enviar pedido para Utmify',
      details: String(error)
    });
  }
}
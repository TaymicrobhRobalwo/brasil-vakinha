export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const BASE_URL = process.env.BLACKCAT_API_BASE_URL || "https://api.blackcatpagamentos.online/api";
        const TOKEN = process.env.BLACKCAT_API_TOKEN; // sua key/token
        const CREATE_PATH = process.env.BLACKCAT_PIX_CREATE_PATH || "/pix"; // ajuste se sua rota for diferente

        if (!TOKEN) {
            return res.status(500).json({ error: "BLACKCAT_API_TOKEN não configurado na Vercel." });
        }

        const body = req.body || {};
        const amount_cents = Number(body.amount_cents || 0);

        if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
            return res.status(400).json({ error: "amount_cents inválido." });
        }

        const payer = body.payer || {};
        const name = String(payer.name || "").trim();
        const email = String(payer.email || "").trim();
        const phone = String(payer.phone || "").trim();
        const cpf = String(payer.cpf || "").trim();

        if (!name || !email || !phone || !cpf) {
            return res.status(400).json({ error: "Dados do pagador incompletos." });
        }

        // ID externo (você pode trocar por algo do seu sistema)
        const external_id = `vakinha_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        /**
         * ========= IMPORTANTE =========
         * A Blackcat pode ter variações de endpoint/payload dependendo da versão.
         * Aqui vai um payload "bem padrão" de geração de PIX.
         *
         * Se a SUA Blackcat exigir nomes diferentes:
         * - troque os campos aqui
         * - e ajuste a normalização do retorno mais abaixo.
         */
        const payload = {
            external_id,
            amount: amount_cents, // muitas APIs PIX usam "amount" em centavos
            currency: "BRL",
            payer: {
                name,
                email,
                phone,
                document: cpf, // algumas chamam de document/cpf
                document_type: "CPF"
            },
            // Se existir parâmetro "tangible" na sua versão:
            tangible: false,
            // metadata opcional:
            metadata: body.metadata || {}
        };

        const url = `${BASE_URL}${CREATE_PATH}`;

        const bcResp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Ajuste o header conforme sua Blackcat:
                // Alguns usam Authorization: Bearer <token>
                // Outros usam x-api-key / x-api-token
                "Authorization": `Bearer ${TOKEN}`,
                "x-api-token": TOKEN
            },
            body: JSON.stringify(payload)
        });

        const raw = await bcResp.text();
        let data = null;
        try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (!bcResp.ok) {
            return res.status(400).json({
                error: "Erro na Blackcat ao criar PIX.",
                details: data
            });
        }

        /**
         * ========= NORMALIZAÇÃO =========
         * A ideia é SEMPRE retornar pro front nesse formato:
         * {
         *   transaction_id,
         *   amount_cents,
         *   status,
         *   pix_payload,      // copia e cola
         *   expires_at_iso
         * }
         *
         * Ajuste os caminhos abaixo conforme a resposta real da SUA Blackcat.
         */
        const transaction_id =
            data?.transaction_id ||
            data?.id ||
            data?.data?.id ||
            data?.data?.transaction_id ||
            data?.charge?.id ||
            null;

        const status =
            data?.status ||
            data?.data?.status ||
            data?.charge?.status ||
            "pending";

        // Copia e cola (payload EMV)
        const pix_payload =
            data?.pix_payload ||
            data?.copy_paste ||
            data?.pix?.payload ||
            data?.pix?.emv ||
            data?.data?.pix_payload ||
            data?.data?.pix?.payload ||
            data?.data?.pix?.emv ||
            data?.charge?.pix?.payload ||
            data?.charge?.pix?.emv ||
            "";

        const expires_at_iso =
            data?.expires_at ||
            data?.expires_at_iso ||
            data?.data?.expires_at ||
            data?.data?.expires_at_iso ||
            data?.pix?.expires_at ||
            data?.data?.pix?.expires_at ||
            null;

        if (!pix_payload) {
            // Se sua API retorna QRCode base64 ao invés de payload, você ainda pode gerar QR no front
            // mas o ideal é ter "copia e cola". Ajuste aqui conforme retorno real.
            // Vamos retornar mesmo assim com aviso.
            return res.status(200).json({
                transaction_id,
                amount_cents,
                status,
                pix_payload: "",
                expires_at_iso,
                warning: "PIX criado mas não encontramos pix_payload na resposta. Ajuste a normalização conforme retorno da Blackcat.",
                original: data
            });
        }

        return res.status(200).json({
            transaction_id,
            amount_cents,
            status,
            pix_payload,
            expires_at_iso
        });

    } catch (err) {
        return res.status(500).json({ error: "Erro interno", details: String(err?.message || err) });
    }
}
module.exports = async (req, res) => {
    res.status(200).json({
        ok: true,
        method: req.method,
        hasKey: !!process.env.BLACKCAT_API_KEY,
        baseUrl: process.env.BLACKCAT_API_BASE_URL || null
    });
};
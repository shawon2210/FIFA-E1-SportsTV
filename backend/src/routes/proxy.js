// ============================================================
// A1TV v2 — Stream Proxy Service
// Handles CORS, Referer, and User-Agent blocked streams.
// Optional: only used when direct playback fails.
// ============================================================

const express = require('express');
const axios = require('axios');
const db = require('../config/database');

const router = express.Router();

/**
 * GET /api/v1/proxy/stream?url=...
 * Proxies a stream URL, adding proper headers to bypass restrictions.
 */
router.get('/stream', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'url required' });

    try {
        const response = await axios.get(url, {
            timeout: 15000,
            responseType: 'stream',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                'Referer': req.headers.referer || new URL(url).origin,
                'Accept': '*/*',
            },
            maxContentLength: Infinity,
        });

        // Set CORS headers
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Content-Type': response.headers['content-type'] || 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache',
        });

        response.data.pipe(res);

        req.on('close', () => {
            response.data.destroy();
        });
    } catch (err) {
        console.error('[Proxy] Error:', err.message);
        res.status(502).json({ success: false, error: 'Proxy failed' });
    }
});

/**
 * POST /api/v1/proxy/register
 * Register a proxy URL for a stream (admin).
 */
router.post('/register', async (req, res) => {
    const { stream_id, proxy_url, proxy_type, reason } = req.body;
    if (!stream_id || !proxy_url) {
        return res.status(400).json({ success: false, error: 'stream_id and proxy_url required' });
    }

    await db('stream_proxies').insert({
        stream_id, proxy_url, proxy_type: proxy_type || 'reverse',
    });

    await db('streams').where('id', stream_id).update({
        needs_proxy: true,
        proxy_reason: reason || 'manual',
    });

    res.json({ success: true });
});

module.exports = router;

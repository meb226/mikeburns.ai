// Google Cloud Text-to-Speech proxy for Hansi's voice.
// Activates when GOOGLE_TTS_API_KEY is set; the client falls back to the
// browser voice when this returns 501.
const DAILY_LIMIT = 200;
const usage = new Map(); // ip -> { day, count }

function checkRateLimit(ip) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = usage.get(ip);
    if (!entry || entry.day !== today) {
        usage.set(ip, { day: today, count: 1 });
        return true;
    }
    if (entry.count >= DAILY_LIMIT) return false;
    entry.count++;
    return true;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const key = process.env.GOOGLE_TTS_API_KEY;
    if (!key) {
        return res.status(501).json({ error: 'TTS not configured' });
    }

    try {
        const { text } = req.body;
        if (typeof text !== 'string' || !text.trim() || text.length > 600) {
            return res.status(400).json({ error: 'Invalid text' });
        }

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
            req.socket?.remoteAddress || 'unknown';
        if (!checkRateLimit(ip)) {
            return res.status(429).json({ error: 'Daily limit reached' });
        }

        const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + key, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text },
                voice: { languageCode: 'de-DE', name: 'de-DE-Neural2-D' },
                audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9 }
            })
        });

        if (!r.ok) {
            const detail = await r.text().catch(() => '');
            console.error('Google TTS error:', r.status, detail.slice(0, 300));
            return res.status(502).json({ error: 'TTS failed' });
        }

        const data = await r.json();
        return res.status(200).json({ audio: data.audioContent });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'TTS failed' });
    }
};

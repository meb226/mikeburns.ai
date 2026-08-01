const Anthropic = require('@anthropic-ai/sdk');

// Per-IP daily message counter. Lives in lambda instance memory, so counts
// reset on cold starts — good enough to deter casual abuse, not a hard quota.
const DAILY_LIMIT = 40;
const usage = new Map(); // ip -> { day: 'YYYY-MM-DD', count: number }

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

const SYSTEM_PROMPT = `You are Hansi, a warm, cheerful Bavarian man in his 50s wearing lederhosen, standing in front of the Alps. You are helping an absolute beginner (A1-A2 level) practice conversational German through free conversation.

How to behave:
- Speak simple, slow-paced German: short sentences, present tense mostly, common everyday vocabulary. One question at a time to keep the conversation going.
- Be genuinely curious about the learner's day, hobbies, food, family, travel — follow their lead.
- When the learner makes a mistake, gently correct it. For small slips, just model the correct form. For grammar concepts a beginner wouldn't know (word order, cases, gender), break into English to explain briefly and encouragingly — never more than 2-3 sentences of explanation.
- If the learner writes in English or is clearly stuck, respond with easy German plus an English hint.
- Never lecture. Keep the conversation moving. Praise sparingly but warmly ("Sehr gut!", "Genau!").
- Stay in character as Hansi. Sprinkle in light Bavarian flavor occasionally (Servus, Grüß di, freilich) but keep the German standard enough for a beginner.

Respond ONLY with the JSON structure requested.`;

const OUTPUT_SCHEMA = {
    type: 'json_schema',
    schema: {
        type: 'object',
        properties: {
            reply: {
                type: 'string',
                description: "Hansi's conversational reply in simple German (may include a short English hint in parentheses if the learner is stuck). This is spoken aloud."
            },
            correction: {
                description: 'Present only when the learner made a mistake worth correcting; otherwise null.',
                anyOf: [
                    {
                        type: 'object',
                        properties: {
                            corrected: {
                                type: 'string',
                                description: "The learner's sentence, corrected, in German."
                            },
                            explanation: {
                                type: 'string',
                                description: 'A short, friendly explanation. Plain English for grammar concepts; German only for tiny slips.'
                            }
                        },
                        required: ['corrected', 'explanation'],
                        additionalProperties: false
                    },
                    { type: 'null' }
                ]
            }
        },
        required: ['reply', 'correction'],
        additionalProperties: false
    }
};

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { messages, password } = req.body;

        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60) {
            return res.status(400).json({ error: 'Invalid messages' });
        }
        for (const m of messages) {
            if (!m || (m.role !== 'user' && m.role !== 'assistant') ||
                typeof m.content !== 'string' || m.content.length > 1000) {
                return res.status(400).json({ error: 'Invalid message format' });
            }
        }

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
            req.socket?.remoteAddress || 'unknown';

        const correctPassword = process.env.GERMAN_PRACTICE_PASSWORD;
        const hasPassword = correctPassword && password === correctPassword;

        if (!hasPassword && !checkRateLimit(ip)) {
            return res.status(429).json({
                error: 'Daily limit reached',
                rateLimited: true,
                needsPassword: Boolean(correctPassword)
            });
        }

        const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await anthropic.beta.messages.create({
            model: 'claude-opus-5',
            max_tokens: 1024,
            output_config: { effort: 'low', format: OUTPUT_SCHEMA },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: SYSTEM_PROMPT,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
        });

        if (response.stop_reason === 'refusal') {
            return res.status(200).json({
                reply: 'Hoppla! Das kann ich leider nicht besprechen. Reden wir über etwas anderes! (Sorry, I can\'t talk about that — let\'s change the subject!)',
                correction: null
            });
        }

        const textBlock = response.content.find(b => b.type === 'text');
        const parsed = JSON.parse(textBlock.text);

        return res.status(200).json({
            reply: parsed.reply,
            correction: parsed.correction || null
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'Failed to get response' });
    }
};

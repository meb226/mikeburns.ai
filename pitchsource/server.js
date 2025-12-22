/**
 * Pitch Craft - Server (Streaming Version)
 * 
 * AI-powered pitch memo generator for lobbying firms
 * Reuses LobbyMatch firm data, generates strategic pitch memos
 * 
 * STREAMING: Uses SSE to stream memo as it's generated
 * MODEL: Set to Haiku for testing, change to Opus for production
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
// const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis (for usage logging) - DISABLED FOR LOCAL TESTING
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const app = express();
app.use(express.json());

// Enable CORS for mikeburns.ai and other origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(__dirname));

// Load firm data (20 curated firms with Tier 1 enhancements)
let firmData = { firms: [] };
try {
  firmData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'firm-profiles-final.json'), 'utf-8'));
  console.log(`Loaded ${firmData.firms.length} firms (Tier 1 enhanced: ${firmData.metadata?.tier1Enhanced || false})`);
} catch (err) {
  console.error('Error loading firm data:', err.message);
}

// Load 50 principles
let principles = '';
try {
  principles = fs.readFileSync(path.join(__dirname, 'data', 'pitch_craft_50_principles.md'), 'utf-8');
  console.log('Loaded 50 principles knowledge layer');
} catch (err) {
  console.error('Error loading principles:', err.message);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// === MODEL CONFIGURATION ===
// Switch between models for testing vs production
const MODEL_CONFIG = {
  testing: 'claude-3-5-haiku-20241022',  // ~$0.02 per memo
  production: 'claude-opus-4-20250514'    // ~$0.40 per memo
};

// SET THIS TO 'testing' OR 'production'
const CURRENT_MODE = 'testing';
const ACTIVE_MODEL = MODEL_CONFIG[CURRENT_MODE];

// === DEMO RATE LIMITING ===
let memoCount = 0;
const MEMO_LIMIT = 20;

// === ISSUE CODES ===
const ISSUE_CODES = {
  'AGR': 'Agriculture', 'BAN': 'Banking', 'BUD': 'Budget/Appropriations',
  'CAW': 'Clean Air & Water', 'COM': 'Communications/Broadcasting',
  'CPI': 'Computer Industry', 'CSP': 'Consumer Issues', 'DEF': 'Defense',
  'EDU': 'Education', 'ENG': 'Energy/Nuclear', 'ENV': 'Environment',
  'FIN': 'Financial Services', 'FOR': 'Foreign Relations', 'FUE': 'Fuel/Gas/Oil',
  'GOV': 'Government Issues', 'HCR': 'Health Issues', 'HOM': 'Homeland Security',
  'HOU': 'Housing', 'IMM': 'Immigration', 'INS': 'Insurance', 'LBR': 'Labor Issues',
  'LAW': 'Law Enforcement', 'MED': 'Medical Research', 'MMM': 'Medicare/Medicaid',
  'NAT': 'Natural Resources', 'PHA': 'Pharmacy', 'RES': 'Real Estate',
  'SCI': 'Science/Technology', 'SMB': 'Small Business', 'TAX': 'Taxation',
  'TEC': 'Telecommunications', 'TRD': 'Trade', 'TRA': 'Transportation',
  'UTI': 'Utilities', 'VET': 'Veterans'
};

// === API ROUTES ===

// Get list of firms for dropdown
app.get('/api/firms', (req, res) => {
  const firmList = firmData.firms.map(f => ({
    name: f.name,
    registrantId: f.registrantId,
    coveredOfficialCount: f.coveredOfficialCount || 0,
    seniorLobbyistCount: f.seniorLobbyistCount || 0,
    totalClients: f.totalClients || 0,
    topIssues: (f.topIssues || []).slice(0, 3).map(i => i.label || i.code || i)
  }));
  
  // Sort alphabetically for dropdown
  firmList.sort((a, b) => a.name.localeCompare(b.name));
  
  res.json({ firms: firmList });
});

// Get single firm details
app.get('/api/firms/:id', (req, res) => {
  const firm = firmData.firms.find(f => 
    f.registrantId === req.params.id || f.name === req.params.id
  );
  
  if (!firm) {
    return res.status(404).json({ error: 'Firm not found' });
  }
  
  res.json(firm);
});

// Get issue codes for dropdown
app.get('/api/issues', (req, res) => {
  res.json({ issues: ISSUE_CODES });
});

// Get usage logs (protected with simple key)
app.get('/api/usage-logs', async (req, res) => {
  const authKey = req.query.key;
  if (authKey !== process.env.USAGE_LOG_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const logs = await redis.lrange('pitchsource:usage', 0, 99); // Last 100 entries
    const parsed = logs.map(log => {
      try {
        return JSON.parse(log);
      } catch {
        return log;
      }
    });
    res.json({ 
      count: parsed.length,
      logs: parsed 
    });
  } catch (err) {
    console.error('Failed to fetch logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Generate pitch memo - STREAMING VERSION
app.post('/api/generate-memo', async (req, res) => {
  // Demo rate limiting
  if (memoCount >= MEMO_LIMIT) {
    return res.status(429).json({ 
      error: `Demo limit reached (${MEMO_LIMIT} memos). Contact Mike for additional access.`,
      memosUsed: memoCount,
      limit: MEMO_LIMIT
    });
  }
  
  const {
    firmName,
    prospectName,
    prospectIndustry,
    prospectIssues,
    advocacyGoal,
    goalType,
    venue,
    timeline,
    budgetRange,
    currentRepresentation,
    additionalContext
  } = req.body;
  
  // Validate required fields
  if (!firmName || !prospectName || !prospectIssues || !advocacyGoal) {
    return res.status(400).json({ 
      error: 'Missing required fields: firmName, prospectName, prospectIssues, advocacyGoal' 
    });
  }
  
  // Get firm data
  const firm = firmData.firms.find(f => f.name === firmName);
  if (!firm) {
    return res.status(404).json({ error: 'Firm not found' });
  }
  
  // Build firm profile for prompt
  const firmProfile = buildFirmProfile(firm);
  
  // Build prospect profile
  const prospectProfile = {
    name: prospectName,
    industry: prospectIndustry || 'Not specified',
    issues: prospectIssues,
    goal: advocacyGoal,
    goalType: goalType || 'Not specified',
    venue: venue || 'Not specified',
    timeline: timeline || 'Not specified',
    budget: budgetRange || 'Not specified',
    currentRep: currentRepresentation || 'None',
    context: additionalContext || ''
  };
  
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial metadata
  res.write(`data: ${JSON.stringify({ 
    type: 'meta', 
    firm: { name: firmProfile.name },
    prospect: { name: prospectProfile.name },
    model: ACTIVE_MODEL
  })}\n\n`);
  
  try {
    const systemPromptText = buildSystemPrompt();
    const userPrompt = buildUserPrompt(firmProfile, prospectProfile);
    
    console.log(`[${CURRENT_MODE.toUpperCase()}] Streaming memo with ${ACTIVE_MODEL}`);
    
    // Use streaming API
    const stream = await anthropic.messages.stream({
      model: ACTIVE_MODEL,
      max_tokens: 4000,
      system: [
        {
          type: 'text',
          text: systemPromptText,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: userPrompt }]
    });
    
    // Stream each chunk to client
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
      }
    }
    
    // Increment count and log after successful generation
    memoCount++;
    console.log(`Memo ${memoCount}/${MEMO_LIMIT} generated for ${firmName} → ${prospectName}`);
    
    // Log usage to Upstash Redis
    if(redis) {
    try {
      await redis.lpush('pitchsource:usage', JSON.stringify({
        timestamp: new Date().toISOString(),
        firm: firmName,
        prospect: prospectName,
        industry: prospectIndustry || 'Not specified',
        issues: prospectIssues,
        memoNumber: memoCount,
        model: ACTIVE_MODEL
      }));
    } catch (logErr) {
      console.error('Failed to log usage:', logErr.message);
    }
  }
    
    // Send completion signal
    res.write(`data: ${JSON.stringify({ 
      type: 'done', 
      memosRemaining: MEMO_LIMIT - memoCount 
    })}\n\n`);
    res.end();
    
  } catch (err) {
    console.error('Error generating memo:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// === HELPER FUNCTIONS ===

function buildFirmProfile(firm) {
  // Helper to check if covered position is meaningful (not "(none)" or empty)
  const hasMeaningfulPosition = (l) => l.coveredPosition && l.coveredPosition !== '(none)';
  const hasClientExperience = (l) => l.clientExperience && l.clientExperience.length > 0;
  
  // Include lobbyists with EITHER meaningful covered positions OR client experience
  // No prioritization by seniority or type - let AI decide based on prospect relevance
  const allLobbyists = (firm.verifiedLobbyists || []).filter(l => 
    hasMeaningfulPosition(l) || hasClientExperience(l)
  );
  
  // Include all relevant lobbyists (max 25)
  const prioritizedLobbyists = allLobbyists.slice(0, 25);

  return {
    name: firm.name,
    topIssues: (firm.topIssues || []).map(i => ({
      code: i.code,
      label: i.label || ISSUE_CODES[i.code] || i.code
    })),
    totalClients: firm.totalClients || 0,
    recentClients: (firm.recentClients || []).slice(0, 10),
    billingRange: firm.billingRange || 'Not available',
    billing: firm.billing,
    coveredOfficialCount: firm.coveredOfficialCount || 0,
    
    // Tier 1 enhanced lobbyist data
    verifiedLobbyists: prioritizedLobbyists,
    seniorLobbyistCount: firm.seniorLobbyistCount || 0,
    
    // Tier 1 firm-level aggregates
    stats: firm.stats || null,
    aggregateEntities: firm.aggregateEntities || null,
    
    committeeRelationships: firm.committeeRelationships || { committees: [] },
    
    // Voice profile for authentic firm tone
    voiceProfile: firm.voiceProfile || null,
    
    // Pre-crafted firm introduction paragraph
    firmIntro: firm.firmIntro || null
  };
}

function buildSystemPrompt() {
  return `You are an expert at writing business development pitch memos for lobbying firms. Your task is to generate a strategic, compelling pitch memo that demonstrates why a specific firm is well-positioned to win a prospect's business.

## KNOWLEDGE LAYER - 50 PRINCIPLES FOR SOPHISTICATED ADVOCACY

The following principles are for YOUR INTERNAL ANALYSIS ONLY. Use them to inform your strategic thinking, but NEVER cite them, reference them by number, quote their sources, or mention "research shows" in your output. The prospect should read your memo and think "this firm really understands Washington": not "this firm read some textbooks."

${principles}

## MEMO STRUCTURE

Generate a pitch memo with these sections:

### 1. EXECUTIVE SUMMARY (Always include)
2-3 sentences on why this firm is positioned to win this prospect. Lead with the strongest differentiator. CRITICAL: Only mention committees, agencies, or government experience that are DIRECTLY relevant to the prospect's stated issue areas. Do not list unrelated committees just because the firm has relationships there: it looks unfocused and undermines credibility.

**DO NOT include a formal memo header.** No "MEMORANDUM", no "To:", "From:", "Date:", "Re:" lines. Just start directly with the Executive Summary section header.

### 2. INTRODUCING [FIRM NAME] (Always include)
A paragraph that establishes who this firm is and what makes them distinctive. You will receive a FIRM INTRO in the user prompt containing pre-crafted language about the firm. **Use this FIRM INTRO verbatim as the first paragraph of this section.** Do not modify, paraphrase, or rewrite it. After the firm intro paragraph, you may add 1-2 additional sentences connecting the firm's positioning to the prospect's specific situation if needed.

If no firm intro is provided, write a brief paragraph (3-4 sentences) based on the voice profile tone, positioning, and differentiators. Keep it factual and grounded in the data provided.

### 3. ISSUE ALIGNMENT ANALYSIS (Always include)
Show how the firm's practice areas map to the prospect's needs. CRITICAL: Do NOT mention "LDA filings," "disclosure data," "public filings," or any reference to where this information comes from. No respectable firm would pitch a client by saying "our disclosures show...": it sounds amateurish. Instead, write as if the firm naturally knows its own expertise: "Our practice has deep roots in energy policy" not "Our LDA filings show concentration in energy."

When making claims about the firm's capabilities, provide enough context that the reader understands WHY the experience is relevant, not just THAT it exists. For example, instead of "Our work with Citizens for Responsible Energy Solutions demonstrates capability in building coalitions around emerging technology frameworks" (which leaves the reader asking "how?"), write something like "Our work with Citizens for Responsible Energy Solutions involved uniting traditionally opposed stakeholders around clean energy innovation, experience directly applicable to building the cross-partisan coalition your AI preemption effort will require."

IMPORTANT: Only make substantive claims you can ground in the provided data (client names, issue areas, lobbyist credentials). If you cannot substantiate a claim with specific details from the data, keep it general rather than fabricating specifics.

### 4. RELEVANT CLIENT EXPERIENCE (Always include)
Highlight similar organizations in the firm's portfolio. Write 2-3 sentences per client showing issue overlap and organizational fit. Each bullet should be substantive (not just a client name and tagline) and end with proper punctuation. Explain WHY this client experience matters for the prospect's specific situation.

### 5. TEAM HIGHLIGHTS (Include if firm has relevant team members)
This section showcases the firm's team. Lobbyists bring value through TWO equally important types of experience:

**A. GOVERNMENT EXPERIENCE (covered positions):**
Prior service in Congress, executive agencies, or the White House. The "entitySummary" field provides pre-extracted committees and agencies. This experience provides institutional knowledge of how policy is made.

**B. SECTOR EXPERIENCE (clientExperience field):**
Direct lobbying experience in the prospect's industry or issue areas. This demonstrates hands-on understanding of the regulatory landscape, key stakeholders, and effective strategies for similar organizations. Note: LDA disclosure only requires reporting "covered positions" (prior government service), so lobbyists without covered positions may have extensive and highly relevant sector expertise that simply falls outside reporting requirements.

**SELECTION CRITERIA:** Choose the 3-4 team members MOST RELEVANT to this specific prospect. Relevance is determined by:
1. Government experience in committees/agencies with jurisdiction over the prospect's issues, OR
2. Client experience representing similar organizations or working on the same issue areas

Both types of experience are equally valuable. A lobbyist who has represented multiple crypto clients is just as relevant to a crypto prospect as one who served on the Senate Banking Committee. Often, sector experience is MORE directly applicable.

Example: For a crypto/fintech prospect, a lobbyist who represented "Satoshi Action Fund" and "Cryptex Finance" on banking and financial services issues brings directly transferable expertise, regardless of whether they have a covered position.

**FORMAT:** Start with an introductory paragraph (2-3 sentences) that frames the team's collective strengths for this prospect. Then provide up to 4 bullet points highlighting specific team members. Each bullet should:
- Start with the lobbyist's name in bold (use **Name**)
- Follow with 1-2 sentences explaining their relevant background and why it matters for this prospect
- End with proper punctuation

Example format:
"The team brings exceptional depth in [relevant area]. [Additional framing sentence about collective experience.]

- **Jane Smith** served as Staff Director of the Senate Finance Committee during the 2017 tax reform negotiations, giving her firsthand knowledge of how major legislation moves through the committee process.
- **John Doe** has represented leading fintech innovators including [Client X] and [Client Y] on regulatory compliance matters, bringing direct experience navigating the exact issues your company faces."

**TERMINOLOGY:** When referring to team members who previously served in government, use phrases like "team members with prior government service" or "former officials on the team." Do NOT use "alumni network": it's unclear and sounds like a university reference.

**WRITING GUIDELINES:**
- Select team members based on RELEVANCE TO THIS PROSPECT, not seniority or title
- Government experience and sector experience are equally valuable; choose based on fit
- Use the "entitySummary" field when available for cleaner committee/agency references
- Use the "branch" field to match prospect's venue: LEGISLATIVE experience for Hill work, EXECUTIVE for regulatory
- Frame government experience in terms of institutional knowledge, NOT access
- Frame sector experience in terms of understanding the prospect's industry, stakeholders, and regulatory landscape
- Use libel-safe language: "established relationships" not "connections to"
- Weave committee relationships INTO this section and the Strategic Approach: do NOT create a separate "Committee Relationships" header

### 6. STRATEGIC APPROACH (Always include)
- Apply relevant insights from the knowledge layer: but DO NOT name or number them
- Tailor recommendations to prospect's specific situation (offensive vs defensive, legislative vs regulatory, timeline)
- Show strategic sophistication through the substance of recommendations, not by citing sources
- Write as an experienced strategist sharing hard-won wisdom, not as someone summarizing research
- This section should be substantive (3-4 paragraphs minimum), showing the prospect you've thought deeply about their specific situation

### 7. FEE CONTEXT (Include if budget information provided)
- Reference firm's typical billing range
- Position relative to prospect's budget
- Frame value proposition

### 8. CONCLUSION (Always include)
A closing paragraph (3-5 sentences) that:
- Reinforces the firm's unique fit for this specific prospect and situation
- Summarizes the key strengths highlighted in the memo (team, experience, strategic approach)
- Ends with a forward-looking statement that invites continued conversation
- Should feel confident but not pushy; leave the prospect wanting to learn more

Do NOT use generic closings like "We look forward to hearing from you." Make it specific to what you've presented in the memo.

## LENGTH GUIDANCE

The memo should be comprehensive and substantive. Aim for approximately 1,200-1,500 words total. Each section should be developed enough that the reader feels the firm has genuinely analyzed their situation, not just filled in a template. Err on the side of more detail rather than less, but ensure every sentence adds value.

## LIBEL-SAFE LANGUAGE RULES

SAFE phrases:
- "Established relationships with committee members"
- "Institutional knowledge from government service"
- "Experience working with [Agency/Committee]"
- "Track record on [Issue]"

UNSAFE phrases (NEVER use):
- "Access to" or "connections to" specific officials
- Any mention of campaign contributions
- "Guaranteed" outcomes
- Specific dollar amounts for contributions
- Quid pro quo implications

## TONE

Professional, confident, strategic. Write as if you're the firm's senior partner crafting a pitch to a sophisticated prospect who understands how Washington works. Avoid generic claims; be specific and evidence-based.

## CRITICAL FORMATTING RULES

**ABSOLUTELY NO EM-DASHES (—)**: Do NOT use em-dashes anywhere in your output. This is a hard rule with zero exceptions. Em-dashes are a strong indicator of AI-generated text. Instead use:
- Colons for explanations
- Semicolons for related clauses  
- Commas for lighter pauses
- Periods and separate sentences for stronger breaks

If you find yourself wanting to write "X — Y", rewrite as "X: Y" or "X. Y" or "X; Y" instead.

CRITICAL: Do NOT reference the principles by number, name, or source in your output. Do NOT cite academic sources like "According to Baumgartner..." or "Research shows..." The principles are for YOUR analysis only: the output should sound like seasoned practitioner wisdom, not academic citations. Apply the strategic insights naturally without revealing you're drawing from a framework.

## VOICE PROFILE GUIDANCE

Each firm has a distinct marketing voice and positioning. You will receive a VOICE PROFILE in the user prompt containing:

- **Tone:** Adjectives describing how this firm presents itself (e.g., "innovative, integrated, modern" vs. "authoritative, established, bipartisan")
- **Key Phrases:** Actual language from the firm's marketing that you should echo naturally throughout the memo. Weave these phrases in organically; do not list them or use them awkwardly.
- **Positioning:** The firm's core differentiator and how they stand out from competitors
- **Differentiators:** Specific claims or credentials the firm emphasizes
- **Avoid:** Words or tones that clash with this firm's brand

THIS IS CRITICAL: The voice profile should permeate the entire memo, not just one section. A memo for an "innovative, modern" boutique should feel fundamentally different from one for an "authoritative, established" white-shoe firm. The key phrases should appear naturally throughout, especially in the Executive Summary and Strategic Approach sections.

If a firm positions itself as having a "new playbook" or being "different from traditional lobbying," the memo must reflect that ethos in its recommendations and framing. Do not write a conventional memo for an unconventional firm.`;
}

function buildUserPrompt(firmProfile, prospectProfile) {
  // Format lobbyists with Tier 1 enhanced data + client experience
  const lobbyistSection = firmProfile.verifiedLobbyists.length > 0
    ? firmProfile.verifiedLobbyists.map(l => {
        const seniorTag = l.isSenior ? '[SENIOR]' : '';
        const branchTag = l.branch ? `[${l.branch}]` : '';
        const entities = l.entitySummary || 'No government entities';
        const seniorTitles = l.seniorTitles?.length > 0 
          ? `Senior titles: ${l.seniorTitles.join(', ')}` 
          : '';
        
        // Format client experience (top 5 most recent)
        const clientExp = l.clientExperience?.length > 0
          ? `Client experience: ${l.clientExperience.slice(0, 5).map(c => 
              `${c.client} (${c.issues?.map(i => ISSUE_CODES[i] || i).join(', ') || 'issues N/A'})`
            ).join('; ')}`
          : '';
        
        // Format issue experience
        const issueExp = l.issueExperience?.length > 0
          ? `Issue areas lobbied: ${l.issueExperience.slice(0, 8).map(i => ISSUE_CODES[i] || i).join(', ')}`
          : '';
        
        // Position line - neutral framing for those without covered positions
        const hasMeaningfulPosition = l.coveredPosition && l.coveredPosition !== '(none)';
        const positionLine = hasMeaningfulPosition
          ? `Government service: ${l.coveredPosition}`
          : '(No covered position on file)';
        
        return `- ${l.name} ${seniorTag} ${branchTag}
    Entities: ${entities}
    ${seniorTitles}
    ${clientExp}
    ${issueExp}
    ${positionLine}`;
      }).join('\n')
    : 'No covered officials on file';
  
  // Format aggregate entities (Tier 1)
  const aggregateSection = firmProfile.aggregateEntities
    ? `**Aggregate Committee Coverage:** ${firmProfile.aggregateEntities.committees?.slice(0, 15).join(', ') || 'None'}
**Aggregate Agency Coverage:** ${firmProfile.aggregateEntities.agencies?.slice(0, 10).join(', ') || 'None'}`
    : 'Aggregate entity data not available';
  
  // Format team stats (Tier 1)
  const statsSection = firmProfile.stats
    ? `**Team Composition:** ${firmProfile.stats.total} verified lobbyists (${firmProfile.stats.seniorCount} senior, ${firmProfile.stats.legislativeCount} legislative branch, ${firmProfile.stats.executiveCount} executive branch, ${firmProfile.stats.bothBranchCount} both branches)`
    : '';
  
  // Format committee relationships
  const committeeSection = firmProfile.committeeRelationships.committees?.length > 0
    ? firmProfile.committeeRelationships.committees.map(c =>
        `- ${c.committee} (Signal strength: ${c.signalStrength})`
      ).join('\n')
    : 'Committee relationship data not available';
  
  // Format recent clients
  const clientSection = firmProfile.recentClients.length > 0
    ? firmProfile.recentClients.map(c =>
        `- ${c.name}${c.description ? ': ' + c.description : ''}`
      ).join('\n')
    : 'Client data not available';
  
  // Format top issues
  const issueSection = firmProfile.topIssues.map(i =>
    `- ${i.code}: ${i.label}`
  ).join('\n');

  // Format voice profile instructions
  const voiceSection = firmProfile.voiceProfile
    ? `**VOICE PROFILE (Apply throughout entire memo):**
Tone: ${firmProfile.voiceProfile.tone?.join(', ') || 'Professional, strategic'}
Key Phrases to Echo: ${firmProfile.voiceProfile.keyPhrases?.join('; ') || 'None specified'}
Positioning: ${firmProfile.voiceProfile.positioning || 'Not specified'}
Differentiators: ${firmProfile.voiceProfile.differentiators?.join('; ') || 'None specified'}
Avoid: ${firmProfile.voiceProfile.avoid?.join(', ') || 'None specified'}`
    : '';

  // Format firm intro (pre-crafted paragraph for "Introducing [Firm]" section)
  const firmIntroSection = firmProfile.firmIntro
    ? `**FIRM INTRO (Use as foundation for "Introducing [Firm]" section):**
${firmProfile.firmIntro}`
    : '';

  return `Generate a pitch memo for the following:

## FIRM PROFILE: ${firmProfile.name}

${voiceSection}

${firmIntroSection}

**Top Issue Areas (by LDA filing frequency):**
${issueSection}

**Client Portfolio (${firmProfile.totalClients} total clients):**
${clientSection}

**Billing Range:** ${firmProfile.billingRange}

${statsSection}

**Team Members with Covered Positions (${firmProfile.coveredOfficialCount} total, ${firmProfile.seniorLobbyistCount} senior):**
${lobbyistSection}

${aggregateSection}

**Committee Relationships:**
${committeeSection}

---

## PROSPECT PROFILE: ${prospectProfile.name}

**Industry:** ${prospectProfile.industry}

**Primary Issue Areas:** ${prospectProfile.issues.join(', ')}

**Advocacy Goal:** ${prospectProfile.goal}

**Goal Type:** ${prospectProfile.goalType} (offensive = seeking policy change, defensive = protecting status quo)

**Primary Venue:** ${prospectProfile.venue}

**Timeline:** ${prospectProfile.timeline}

**Budget Range:** ${prospectProfile.budget}

**Current Representation:** ${prospectProfile.currentRep}

**Additional Context:** ${prospectProfile.context || 'None provided'}

---

Generate the pitch memo now. Apply strategic insights based on the prospect's specific situation. Be specific and strategic, not generic. Do not reference principles, academic sources, or research: just deliver the strategic wisdom naturally.

REMINDER: Select team members for Team Highlights based on RELEVANCE to this prospect, not seniority. Government experience and sector/client experience are equally valuable. A lobbyist with direct client experience in the prospect's industry may be MORE relevant than one with a senior government title in an unrelated area. Use the "Entities" field for cleaner committee/agency references. Only mention committees relevant to this prospect's issues.

VOICE REMINDER: Embody the firm's voice profile throughout. Echo the key phrases naturally (especially in Executive Summary and Strategic Approach). Match the tone adjectives. If this firm positions itself as innovative or unconventional, the memo must feel that way, not like a traditional pitch.`;
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Pitch Craft server running on port ${PORT}`);
  console.log(`Model: ${ACTIVE_MODEL} (${CURRENT_MODE} mode)`);
  console.log(`Demo mode: ${MEMO_LIMIT} memo limit`);
});

module.exports = app;

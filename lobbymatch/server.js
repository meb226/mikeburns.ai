require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load firm data and committee mapping
let firmProfiles = { firms: [] };
let issueCommitteeMap = {};
let committeeRoster = {};

try {
  firmProfiles = require('./data/firm-profiles.json');
  issueCommitteeMap = require('./data/issue-committee-map.json');
  committeeRoster = require('./data/committee-roster.json');
} catch (e) {
  console.log('Data files not fully loaded:', e.message);
}

// Pre-filter firms to reduce token count before API call
function preFilterFirms(firms, { issueArea, additionalIssues, budget }) {
  const allIssues = [issueArea, ...(additionalIssues || [])].filter(Boolean);
  
  // Score each firm
  const scored = firms.map(firm => {
    let score = 0;
    
    // Issue match scoring
    const firmIssues = (firm.issueAreas || []).map(i => i.code || i);
    allIssues.forEach((issue, idx) => {
      if (firmIssues.includes(issue)) {
        score += idx === 0 ? 10 : 5; // Primary issue worth more
      }
    });
    
    // Committee relationships bonus
    if (firm.committeeRelationships?.topCommittees?.length > 0) {
      score += 10;
    }
    
    // Covered officials bonus (revolving door value)
    const coveredCount = (firm.verifiedLobbyists || [])
      .filter(l => l.coveredPosition && l.coveredPosition !== 'None listed').length;
    score += Math.min(coveredCount * 5, 20);
    
    // Budget alignment
    if (budget && firm.billingRange) {
      const budgetNum = parseBudgetToMonthly(budget);
      const firmMin = firm.billingRange.minMonthly || 0;
      const firmMax = firm.billingRange.maxMonthly || Infinity;
      if (budgetNum >= firmMin && budgetNum <= firmMax) {
        score += 10;
      } else if (budgetNum >= firmMin * 0.5 && budgetNum <= firmMax * 1.5) {
        score += 5;
      }
    }
    
    return { firm, score };
  });
  
  // Sort by score and return top 30
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(s => s.firm);
}

// Parse budget string to monthly number
function parseBudgetToMonthly(budget) {
  if (!budget) return 10000;
  if (budget.includes('2,500-5,000')) return 3750;
  if (budget.includes('5,000-15,000')) return 10000;
  if (budget.includes('15,000-30,000')) return 22500;
  if (budget.includes('30,000+')) return 50000;
  return 10000;
}

// Slim down firm data to reduce tokens
function slimFirmData(firm) {
  return {
    name: firm.name,
    registrantId: firm.registrantId,
    website: firm.website,
    issueAreas: (firm.issueAreas || []).slice(0, 6),
    verifiedLobbyists: (firm.verifiedLobbyists || []).slice(0, 6).map(l => ({
      name: l.name,
      coveredPosition: l.coveredPosition
    })),
    recentClients: (firm.recentClients || []).slice(0, 10).map(c => 
      typeof c === 'string' ? c : { name: c.name, description: (c.description || '').slice(0, 80) }
    ),
    billingRange: firm.billingRange ? {
      minMonthly: firm.billingRange.minMonthly,
      maxMonthly: firm.billingRange.maxMonthly,
      avgQuarterly: firm.billingRange.avgQuarterly
    } : null,
    committeeRelationships: firm.committeeRelationships ? {
      topCommittees: (firm.committeeRelationships.topCommittees || []).slice(0, 6).map(c => ({
        committee: c.committee,
        chamber: c.chamber
      }))
    } : null
  };
}

// API Routes

// Get issue codes for dropdown
app.get('/api/issues', (req, res) => {
  const issueCodes = require('./data/issue-codes.json');
  res.json(issueCodes);
});

// Get example scenarios
app.get('/api/scenarios', (req, res) => {
  const scenarios = require('./data/example-scenarios.json');
  res.json(scenarios);
});

// Main matching endpoint
app.post('/api/match', async (req, res) => {
  try {
    const {
      organizationType,
      issueArea,
      additionalIssues,
      budget,
      priorities,
      orgDescription,
      policyGoals,
      timeline
    } = req.body;

    // Validate inputs
    if (!organizationType || !issueArea || !orgDescription) {
      return res.status(400).json({ 
        error: 'Missing required fields: organizationType, issueArea, orgDescription' 
      });
    }

    // Pre-filter firms to top 30 candidates before sending to Claude
    const allFirms = firmProfiles.firms || firmProfiles;
    const filteredFirms = preFilterFirms(allFirms, {
      issueArea,
      additionalIssues,
      budget
    });
    
    // Slim down the data to reduce tokens
    const slimmedFirms = filteredFirms.map(slimFirmData);
    
    console.log(`Pre-filtered to ${slimmedFirms.length} firms from ${allFirms.length}`);

    // Build the matching prompt with filtered firms
    const matchingPrompt = buildMatchingPrompt({
      organizationType,
      issueArea,
      additionalIssues,
      budget,
      priorities,
      orgDescription,
      policyGoals,
      timeline,
      firmProfiles: { firms: slimmedFirms }
    });

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6144,
      messages: [
        { role: 'user', content: matchingPrompt }
      ],
      system: `You are a seasoned Washington, DC political insider with deep expertise in federal lobbying. You understand how congressional and executive branch advocacy works, and you can translate between an ordinary citizen's needs and the specialized knowledge of a federal lobbyist.

Your role is to analyze lobbying disclosure data and recommend the best-fit lobbying firms for potential clients. You provide clear, actionable recommendations backed by specific data from LDA filings.

Always be:
- Professional and trustworthy
- Transparent about your reasoning
- Specific with data citations
- Balanced in your assessments

Important disclaimers to include:
- This analysis is based on public LDA filings and is for informational purposes only
- It does not constitute legal, business, or professional advice
- Past performance does not guarantee future results
- Users should conduct their own due diligence before engaging any firm`
    });

    // Parse and return the response
    const analysisText = message.content[0].text;
    
    // Try to parse as JSON
    let analysisData;
    try {
      // Clean up any markdown code fences if present
      const cleanedText = analysisText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      analysisData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Fall back to raw text if JSON parsing fails
      analysisData = { raw: analysisText };
    }
    
    res.json({
      success: true,
      analysis: analysisData,
      metadata: {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    console.error('Match error:', error);
    res.status(500).json({ 
      error: 'Failed to generate matches',
      details: error.message 
    });
  }
});

// Helper: Build the matching prompt
function buildMatchingPrompt({ organizationType, issueArea, additionalIssues, budget, priorities, orgDescription, policyGoals, timeline, firmProfiles }) {
  // Use firms array from the object structure
  const firms = firmProfiles.firms || firmProfiles;
  const firmData = JSON.stringify(firms, null, 2);
  
  // Get relevant committees for the user's issue area
  const allIssues = [issueArea, ...(additionalIssues || [])].filter(Boolean);
  let relevantCommittees = [];
  allIssues.forEach(issue => {
    const mapping = issueCommitteeMap.mappings?.[issue];
    if (mapping && mapping.committees) {
      relevantCommittees.push(...mapping.committees.map(c => `${c.chamber} ${c.committee}`));
    }
  });
  relevantCommittees = [...new Set(relevantCommittees)]; // deduplicate
  
  return `Analyze the following client profile and recommend the TOP 5 lobbying firms from the provided data.

## Client Profile

**Organization Type:** ${organizationType}
**Primary Issue Area:** ${issueArea}
**Additional Issues:** ${additionalIssues?.length ? additionalIssues.join(', ') : 'None specified'}
**Budget Range:** ${budget || 'Not specified'}
**Key Priorities:** ${priorities || 'Not specified'}
**Organization Description:** ${orgDescription}
**Policy Goals:** ${policyGoals || 'Not specified'}
**Timeline & Context:** ${timeline || 'Not specified'}

## Relevant Congressional Committees for This Issue

${relevantCommittees.length ? relevantCommittees.join('\n') : 'General government affairs'}

## Available Firm Data (from LDA Filings)

Note: Each firm has "committeeRelationships" data showing their established engagement with key congressional committees, and "verifiedLobbyists" with their prior government positions (coveredPosition field). Use this to assess which firms have the strongest Capitol Hill relationships for the client's specific issues.

${firmData}

## Required Output Format

You MUST respond with valid JSON only. No markdown, no explanation outside the JSON structure.

{
  "executiveSummary": "Write in a warm, conversational tone — as if briefing a colleague over coffee. Lead with the key insight: which firm stands out and why. Reference **firm names** and **specific strengths** (e.g., 'Mehlman Consulting brings unmatched tech policy depth through Bruce Mehlman's Commerce Department experience'). Where relevant, mention lobbyists whose prior committee or agency roles directly connect to the client's issue. Include a note about the firm's Capitol Hill relationships — use phrases like 'established relationships with [Committee] members' or 'direct connections to key [policy area] policymakers'. Avoid generic phrases. Keep it to 3-4 sentences that feel like expert advice, not a report.",
  "matches": [
    {
      "rank": 1,
      "firmName": "Firm Name Here",
      "firmWebsite": "https://www.firmwebsite.com",
      "rationale": "Two substantial paragraphs. Use **bold** markers around 2-3 key phrases per paragraph. First paragraph: focus on WHY this firm understands the client's specific issue — cite relevant policy work, name specific legislation or regulations they've engaged on, mention client types they've represented in this space. Include a sentence about their **established relationships with relevant committee members**. Where a lobbyist has prior experience on a relevant committee or agency, weave that in naturally (e.g., 'Their team includes a former Senate Finance Committee counsel who worked on these exact provisions...'). Avoid leading with filing counts. Second paragraph: highlight 1-2 specific lobbyists by name and their relevant government experience (written out fully), explain how the firm's approach and fee structure align with the client's needs.",
      "keyPersonnel": [
        {
          "name": "Actual Lobbyist Full Name",
          "background": "Former [Specific Government Role] — e.g., 'Former Chief Counsel, Senate Finance Committee (2015-2019)' or 'Former U.S. Representative from Ohio, 18th District (2003-2015)'. NO generic titles like 'Healthcare Policy Team Lead'. Use the actual person's government background from the verifiedLobbyists array. Write out all abbreviations fully with years."
        },
        {
          "name": "Second Lobbyist Name",
          "background": "Their specific government experience"
        }
      ],
      "representativeClients": ["Specific Company/Organization Name (e.g., 'PhRMA', 'American Hospital Association', 'Pfizer Inc.')", "Another Specific Client Name", "Third Specific Client Name"],
      "subjectsLobbied": [
        "Specific bill or regulation relevant to client's issue (e.g., 'Inflation Reduction Act clean energy credits')",
        "Another specific policy matter (e.g., 'FDA accelerated approval pathway for rare diseases')",
        "Third subject (e.g., 'DOE loan guarantee program for advanced nuclear')"
      ],
      "keyStrengths": [
        "Specific strength — cite relevant experience, not filing volume",
        "Another strength with concrete policy or relationship detail",
        "Third strength focused on fit for this client's situation"
      ],
      "considerations": [
        "Honest consideration with helpful context (e.g., 'Premium pricing may require phased engagement')",
        "Second consideration if applicable"
      ],
      "scores": {
        "issueAlignment": 85,
        "experienceDepth": 78,
        "costFit": 72,
        "overallMatch": 80
      }
    },
    {
      "rank": 2,
      "firmName": "...",
      "firmWebsite": "...",
      "rationale": "...",
      "keyPersonnel": [],
      "representativeClients": [],
      "subjectsLobbied": [],
      "keyStrengths": [],
      "considerations": [],
      "scores": { "issueAlignment": 0, "experienceDepth": 0, "costFit": 0, "overallMatch": 0 }
    },
    {
      "rank": 3,
      "firmName": "...",
      "firmWebsite": "...",
      "rationale": "...",
      "keyPersonnel": [],
      "representativeClients": [],
      "subjectsLobbied": [],
      "keyStrengths": [],
      "considerations": [],
      "scores": { "issueAlignment": 0, "experienceDepth": 0, "costFit": 0, "overallMatch": 0 }
    },
    {
      "rank": 4,
      "firmName": "...",
      "firmWebsite": "...",
      "rationale": "...",
      "keyPersonnel": [],
      "representativeClients": [],
      "subjectsLobbied": [],
      "keyStrengths": [],
      "considerations": [],
      "scores": { "issueAlignment": 0, "experienceDepth": 0, "costFit": 0, "overallMatch": 0 }
    },
    {
      "rank": 5,
      "firmName": "...",
      "firmWebsite": "...",
      "rationale": "...",
      "keyPersonnel": [],
      "representativeClients": [],
      "subjectsLobbied": [],
      "keyStrengths": [],
      "considerations": [],
      "scores": { "issueAlignment": 0, "experienceDepth": 0, "costFit": 0, "overallMatch": 0 }
    }
  ],
  "methodology": "One paragraph explaining how matches were determined: analysis of LDA filing history, issue code frequency, lobbyist credentials, client portfolio similarity, Capitol Hill relationships, and budget alignment. Note that lobbyist verification is based on Q3-Q4 2024 and Q1 2025 LD-2 filings."
}

IMPORTANT RULES:

1. WORD CHOICE: NEVER use the word "access" when describing relationships (it can connote impropriety). Instead use: "relationships with", "engagement with", "connections to", "experience working with", or "direct ties to".

2. FUZZY NUMBERS: When referencing filing counts or quantities, use approximate language rather than exact numbers. Say "more than 50 filings" instead of "57 filings", or "300-plus clients" instead of "342 clients", or "dozens of healthcare engagements" instead of "38 healthcare engagements". This sounds more natural and less canned.

3. NO COMMITTEE MEMBER COUNTS: Do NOT mention specific numbers of committee members a firm has relationships with. Instead of "relationships with 12 members of the Finance Committee", simply say "established relationships with Senate Finance Committee members" or "strong ties to Finance Committee leadership".

4. COVERED POSITIONS IN CONTEXT: When a firm has lobbyists with prior committee or agency experience relevant to the client's issue, weave this into the rationale naturally. For example: "Their team's depth on energy issues is bolstered by a former DOE Deputy Assistant Secretary and a former staffer from the Senate Energy Committee."

5. The "rationale" field must be TWO FULL PARAGRAPHS with **bold** markers around 2-3 key phrases per paragraph.

6. "keyPersonnel" must use ONLY lobbyists from the "verifiedLobbyists" array in the firm data. List 2-3 INDIVIDUAL lobbyists by their REAL NAMES (minimum 2). Use their "coveredPosition" field for the background. Order by seniority.

7. "representativeClients" must use ONLY clients from the "recentClients" array in the firm data.

8. "keyStrengths" must ALWAYS have exactly 3 bullet points for EVERY match. Focus on: (1) issue expertise with supporting data, (2) relevant personnel/relationships, (3) fit for this specific client.

9. "subjectsLobbied" should reference specific legislation, regulations, or policy areas relevant to the query.

10. "firmWebsite" should use the website from the firm data.

11. All scores are integers from 1-100.

12. Focus on QUALITY of experience (policy depth, relationships, relevant wins) rather than QUANTITY (filing counts).

13. Write the executiveSummary in a warm, conversational tone — like expert advice from a trusted colleague.

14. Respond with ONLY the JSON object, no other text.`;
}

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`LobbyMatch server running on http://localhost:${PORT}`);
  console.log(`Firm profiles loaded: ${firmProfiles.firms?.length || 0}`);
  console.log(`Issue-committee mappings loaded: ${Object.keys(issueCommitteeMap.mappings || {}).length}`);
});

module.exports = app;

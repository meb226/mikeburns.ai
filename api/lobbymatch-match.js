const Anthropic = require('@anthropic-ai/sdk');

// Load data files
let firmProfiles = { firms: [] };
let issueCommitteeMap = {};

try {
  firmProfiles = require('../lobbymatch/data/firm-profiles.json');
  issueCommitteeMap = require('../lobbymatch/data/issue-committee-map.json');
} catch (e) {
  console.log('Data files not fully loaded:', e.message);
}

// =============================================================================
// ANALYTICS ENGINE - All scoring happens here, not in Claude
// =============================================================================

function parseBudgetToMonthly(budget) {
  if (!budget) return 10000;
  if (budget.includes('2,500-5,000')) return 3750;
  if (budget.includes('5,000-15,000')) return 10000;
  if (budget.includes('15,000-30,000')) return 22500;
  if (budget.includes('30,000+')) return 50000;
  return 10000;
}

function getRelevantCommittees(issueArea, additionalIssues) {
  const allIssues = [issueArea, ...(additionalIssues || [])].filter(Boolean);
  const committees = [];
  allIssues.forEach(issue => {
    const mapping = issueCommitteeMap.mappings?.[issue];
    if (mapping?.committees) {
      mapping.committees.forEach(c => {
        committees.push({ name: c.committee, chamber: c.chamber, fullName: `${c.chamber} ${c.committee}` });
      });
    }
  });
  const seen = new Set();
  return committees.filter(c => { if (seen.has(c.fullName)) return false; seen.add(c.fullName); return true; });
}

function calcIssueAlignmentScore(firm, issueArea, additionalIssues) {
  const firmIssues = (firm.issueAreas || []).map(i => i.code || i);
  let score = 0;
  if (firmIssues.includes(issueArea)) {
    const position = firmIssues.indexOf(issueArea);
    if (position === 0) score += 60;
    else if (position <= 2) score += 50;
    else if (position <= 5) score += 40;
    else score += 30;
  }
  const additionalMatches = (additionalIssues || []).filter(i => firmIssues.includes(i)).length;
  const additionalTotal = (additionalIssues || []).length;
  if (additionalTotal > 0) score += Math.round((additionalMatches / additionalTotal) * 40);
  else score += 20;
  return Math.min(100, score);
}

function calcExperienceDepthScore(firm, relevantCommittees) {
  let score = 0;
  const coveredLobbyists = (firm.verifiedLobbyists || []).filter(l => l.coveredPosition && l.coveredPosition !== 'None listed');
  score += Math.min(coveredLobbyists.length * 10, 40);
  const firmCommittees = (firm.committeeRelationships?.topCommittees || []).map(c => c.committee?.toLowerCase() || '');
  const relevantNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
  const overlap = firmCommittees.filter(fc => relevantNames.some(rc => fc.includes(rc) || rc.includes(fc))).length;
  if (overlap >= 3) score += 40;
  else if (overlap >= 2) score += 30;
  else if (overlap >= 1) score += 20;
  else if (firmCommittees.length > 0) score += 10;
  const clientCount = (firm.recentClients || []).length;
  if (clientCount >= 20) score += 20;
  else if (clientCount >= 10) score += 15;
  else if (clientCount >= 5) score += 10;
  else score += 5;
  return Math.min(100, score);
}

function calcCostFitScore(firm, budget) {
  if (!budget || !firm.billingRange) return 50;
  const budgetNum = parseBudgetToMonthly(budget);
  const firmMin = firm.billingRange.minMonthly || 0;
  const firmMax = firm.billingRange.maxMonthly || Infinity;
  if (budgetNum >= firmMin && budgetNum <= firmMax) return 90;
  if (budgetNum >= firmMin * 0.5 && budgetNum <= firmMax * 1.5) return 70;
  if (budgetNum >= firmMin * 0.25 && budgetNum <= firmMax * 2) return 50;
  return 30;
}

function calcOverallMatchScore(issueScore, experienceScore, costScore) {
  return Math.round((issueScore * 0.45) + (experienceScore * 0.35) + (costScore * 0.20));
}

function analyzeAndRankFirms(firms, { issueArea, additionalIssues, budget }) {
  const relevantCommittees = getRelevantCommittees(issueArea, additionalIssues);
  
  const analyzed = firms.map(firm => {
    const issueAlignmentScore = calcIssueAlignmentScore(firm, issueArea, additionalIssues);
    const experienceDepthScore = calcExperienceDepthScore(firm, relevantCommittees);
    const costFitScore = calcCostFitScore(firm, budget);
    const overallMatchScore = calcOverallMatchScore(issueAlignmentScore, experienceDepthScore, costFitScore);
    
    return {
      name: firm.name,
      website: firm.website,
      scores: { issueAlignment: issueAlignmentScore, experienceDepth: experienceDepthScore, costFit: costFitScore, overallMatch: overallMatchScore },
      issueAreas: (firm.issueAreas || []).slice(0, 6),
      lobbyists: (firm.verifiedLobbyists || []).slice(0, 5).map(l => ({ name: l.name, position: l.coveredPosition })),
      clients: (firm.recentClients || []).slice(0, 8).map(c => typeof c === 'string' ? c : c.name),
      committees: (firm.committeeRelationships?.topCommittees || []).slice(0, 5).map(c => `${c.chamber} ${c.committee}`)
    };
  });
  
  return {
    topFirms: analyzed.sort((a, b) => b.scores.overallMatch - a.scores.overallMatch).slice(0, 5),
    relevantCommittees: relevantCommittees.map(c => c.fullName)
  };
}

// =============================================================================
// SERVERLESS FUNCTION
// =============================================================================

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const { organizationType, issueArea, additionalIssues, budget, priorities, orgDescription, policyGoals, timeline } = req.body;

    if (!organizationType || !issueArea || !orgDescription) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Run analytics engine - scores computed server-side
    const allFirms = firmProfiles.firms || firmProfiles;
    const { topFirms, relevantCommittees } = analyzeAndRankFirms(allFirms, { issueArea, additionalIssues, budget });
    
    console.log(`Analytics: ${Date.now() - startTime}ms - Top 5 from ${allFirms.length} firms`);

    // Build firm data for prompt - include rich detail for better narratives
    const firmData = topFirms.map((f, i) => 
      `FIRM ${i+1}: ${f.name}
Website: ${f.website || 'N/A'}
Key Lobbyists: ${f.lobbyists.map(l => `${l.name}${l.position && l.position !== 'None listed' ? ` (Former: ${l.position})` : ''}`).join('; ')}
Representative Clients: ${f.clients.join(', ')}
Committee Relationships: ${f.committees.join('; ') || 'General government affairs'}
Issue Areas: ${f.issueAreas.map(i => i.code || i).join(', ')}`
    ).join('\n\n');

    const prompt = `Analyze these 5 pre-ranked lobbying firm matches for a ${organizationType} client.

## CLIENT PROFILE
**Organization:** ${orgDescription}
**Primary Issue:** ${issueArea}
**Additional Issues:** ${additionalIssues?.length ? additionalIssues.join(', ') : 'None'}
**Policy Goals:** ${policyGoals || 'Not specified'}
**Budget:** ${budget || 'Not specified'}
**Timeline:** ${timeline || 'Not specified'}

## RELEVANT COMMITTEES
${relevantCommittees.slice(0, 5).join(', ')}

## TOP 5 MATCHES (pre-ranked by matching algorithm)
${firmData}

## OUTPUT INSTRUCTIONS

Write expert analysis explaining WHY each firm fits. The ranking and scores are already determined - focus on compelling narratives.

Respond with this exact JSON structure:
{
  "executiveSummary": "3-4 sentences in warm, collegial tone. Lead with the #1 firm and why it stands out. Name a specific lobbyist and their relevant government experience. Mention committee relationships using 'established relationships with [Committee] members'. Make it feel like advice from a trusted DC insider.",
  
  "matches": [
    {
      "rank": 1,
      "firmName": "Exact firm name from data",
      "firmWebsite": "URL from data or null",
      "rationale": "TWO SUBSTANTIAL PARAGRAPHS with **bold** on 2-3 key phrases per paragraph. First paragraph: Explain why this firm understands the client's issue - cite their relevant clients, policy expertise, and committee relationships. Second paragraph: Highlight 1-2 specific lobbyists BY NAME with their government background, and explain fee/approach alignment.",
      "keyPersonnel": [
        {"name": "Real lobbyist name from data", "background": "Their former government position, written out fully"},
        {"name": "Second lobbyist name", "background": "Their background"}
      ],
      "representativeClients": ["Client from data", "Another client", "Third client"],
      "keyStrengths": ["Specific strength with evidence", "Second strength", "Third strength"],
      "considerations": ["One honest consideration with helpful context"]
    }
  ],
  
  "methodology": "One paragraph: Matches determined by analyzing LDA filing history, issue expertise frequency, lobbyist credentials and former government positions, client portfolio alignment, Capitol Hill committee relationships, and budget fit. Lobbyist data verified against Q3-Q4 2024 and Q1 2025 LD-2 filings."
}

## CRITICAL RULES

1. DO NOT include a "scores" field - scores are added separately by the system.

2. NEVER use "access" - say "relationships with", "connections to", "experience with".

3. Use FUZZY NUMBERS: "more than 50 filings" not "57 filings".

4. "keyPersonnel" MUST use ONLY names from the lobbyists data. Minimum 2 per firm.

5. "representativeClients" MUST use ONLY clients from the data.

6. "keyStrengths" MUST have EXACTLY 3 items per firm.

7. "rationale" MUST be two full paragraphs with **bold** markers.

8. Maintain the exact firm order (they are pre-ranked).

9. Respond with ONLY valid JSON, no markdown fences.`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Use Sonnet for quality narratives - prompt is small enough to be fast
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a seasoned Washington DC lobbying expert. Write compelling, specific firm recommendations based on LDA data. Be warm and collegial in tone. Respond with valid JSON only - no markdown code fences.'
    });

    console.log(`Claude API: ${Date.now() - startTime}ms | In: ${message.usage.input_tokens} Out: ${message.usage.output_tokens}`);

    // Parse response
    const text = message.content[0].text;
    let analysis;
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error:', e);
      analysis = { raw: text };
    }

    // INJECT pre-computed scores (authoritative - replaces any Claude might have added)
    if (analysis.matches) {
      analysis.matches = analysis.matches.map((match, idx) => {
        // Remove any scores Claude might have included
        const { scores: _, ...matchWithoutScores } = match;
        return {
          ...matchWithoutScores,
          scores: topFirms[idx]?.scores,
          firmWebsite: match.firmWebsite || topFirms[idx]?.website,
          rank: idx + 1
        };
      });
    }

    console.log(`Total: ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      analysis,
      metadata: {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        timeMs: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('Match error:', error);
    return res.status(500).json({ error: 'Failed to generate matches', details: error.message });
  }
};

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

// Enhanced Issue Alignment Score (0-100)
function calcIssueAlignmentScore(firm, issueArea, additionalIssues) {
  const firmIssues = (firm.issueAreas || []).map(i => i.code || i);
  let score = 0;
  
  // Primary issue position (0-50 points)
  if (firmIssues.includes(issueArea)) {
    const position = firmIssues.indexOf(issueArea);
    if (position === 0) score += 50;      // Top issue
    else if (position === 1) score += 45;
    else if (position === 2) score += 40;
    else if (position <= 4) score += 32;
    else if (position <= 6) score += 25;
    else score += 18;
  }
  
  // Additional issues match (0-30 points)
  const additionalMatches = (additionalIssues || []).filter(i => firmIssues.includes(i)).length;
  const additionalTotal = (additionalIssues || []).length;
  if (additionalTotal > 0) {
    score += Math.round((additionalMatches / additionalTotal) * 30);
  } else {
    score += 15; // Baseline if no additional issues specified
  }
  
  // Issue breadth bonus - firms with focused practice score higher (0-10 points)
  const totalIssues = firmIssues.length;
  if (totalIssues <= 5) score += 10;       // Boutique/specialized
  else if (totalIssues <= 10) score += 7;
  else if (totalIssues <= 15) score += 4;
  else score += 2;                          // Very broad practice
  
  // Issue frequency bonus - if we have filing counts (0-10 points)
  const primaryIssueData = (firm.issueAreas || []).find(i => (i.code || i) === issueArea);
  if (primaryIssueData && primaryIssueData.count) {
    if (primaryIssueData.count >= 50) score += 10;
    else if (primaryIssueData.count >= 25) score += 7;
    else if (primaryIssueData.count >= 10) score += 5;
    else score += 2;
  }
  
  return Math.min(100, score);
}

// Enhanced Experience Depth Score (0-100)
function calcExperienceDepthScore(firm, relevantCommittees) {
  let score = 0;
  
  // Covered officials / revolving door value (0-35 points)
  const allLobbyists = firm.verifiedLobbyists || [];
  const coveredLobbyists = allLobbyists.filter(l => l.coveredPosition && l.coveredPosition !== 'None listed');
  
  if (coveredLobbyists.length >= 5) score += 35;
  else if (coveredLobbyists.length >= 3) score += 28;
  else if (coveredLobbyists.length >= 2) score += 22;
  else if (coveredLobbyists.length >= 1) score += 15;
  else score += 5; // Some baseline for having lobbyists at all
  
  // Committee relationship overlap (0-30 points)
  const firmCommittees = (firm.committeeRelationships?.topCommittees || []).map(c => c.committee?.toLowerCase() || '');
  const relevantNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
  
  const overlap = firmCommittees.filter(fc => 
    relevantNames.some(rc => fc.includes(rc) || rc.includes(fc))
  ).length;
  
  if (overlap >= 4) score += 30;
  else if (overlap >= 3) score += 25;
  else if (overlap >= 2) score += 20;
  else if (overlap >= 1) score += 12;
  else if (firmCommittees.length > 0) score += 5;
  
  // Client portfolio depth (0-20 points)
  const clientCount = (firm.recentClients || []).length;
  if (clientCount >= 30) score += 20;
  else if (clientCount >= 20) score += 16;
  else if (clientCount >= 10) score += 12;
  else if (clientCount >= 5) score += 8;
  else score += 4;
  
  // Team size indicator (0-15 points)
  const teamSize = allLobbyists.length;
  if (teamSize >= 10) score += 15;
  else if (teamSize >= 6) score += 12;
  else if (teamSize >= 4) score += 9;
  else if (teamSize >= 2) score += 6;
  else score += 3;
  
  return Math.min(100, score);
}

// Enhanced Cost Fit Score (0-100)
function calcCostFitScore(firm, budget) {
  // If no budget specified, give moderate score
  if (!budget || budget === 'Not specified') return 65;
  
  // If no billing data, use client count as proxy
  if (!firm.billingRange) {
    const clientCount = (firm.recentClients || []).length;
    // More clients = likely higher fees
    if (budget.includes('30,000+')) {
      return clientCount >= 15 ? 75 : 60;
    } else if (budget.includes('15,000-30,000')) {
      return clientCount >= 10 && clientCount <= 25 ? 70 : 55;
    } else if (budget.includes('5,000-15,000')) {
      return clientCount <= 20 ? 70 : 50;
    } else {
      return clientCount <= 15 ? 70 : 45;
    }
  }
  
  const budgetNum = parseBudgetToMonthly(budget);
  const firmMin = firm.billingRange.minMonthly || 0;
  const firmMax = firm.billingRange.maxMonthly || Infinity;
  const firmAvg = (firmMin + firmMax) / 2;
  
  // Perfect fit
  if (budgetNum >= firmMin && budgetNum <= firmMax) {
    // Bonus if budget is in sweet spot (middle of range)
    const distFromAvg = Math.abs(budgetNum - firmAvg) / firmAvg;
    if (distFromAvg <= 0.2) return 95;
    return 88;
  }
  
  // Slightly outside range
  if (budgetNum >= firmMin * 0.7 && budgetNum <= firmMax * 1.3) return 75;
  
  // Moderately outside range
  if (budgetNum >= firmMin * 0.5 && budgetNum <= firmMax * 1.5) return 60;
  
  // Significantly outside range
  if (budgetNum >= firmMin * 0.25 && budgetNum <= firmMax * 2) return 45;
  
  return 30;
}

// Overall Match Score with weighted components
function calcOverallMatchScore(issueScore, experienceScore, costScore) {
  // Weights: Issue fit most important, then experience, then cost
  const weighted = (issueScore * 0.45) + (experienceScore * 0.35) + (costScore * 0.20);
  return Math.round(weighted);
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
      scores: { 
        issueAlignment: issueAlignmentScore, 
        experienceDepth: experienceDepthScore, 
        costFit: costFitScore, 
        overallMatch: overallMatchScore 
      },
      issueAreas: (firm.issueAreas || []).slice(0, 6),
      lobbyists: (firm.verifiedLobbyists || []).slice(0, 5).map(l => ({ name: l.name, position: l.coveredPosition })),
      clients: (firm.recentClients || []).slice(0, 8).map(c => typeof c === 'string' ? c : c.name),
      committees: (firm.committeeRelationships?.topCommittees || []).slice(0, 5).map(c => `${c.chamber} ${c.committee}`),
      // Include raw data for methodology transparency
      _meta: {
        coveredOfficials: (firm.verifiedLobbyists || []).filter(l => l.coveredPosition && l.coveredPosition !== 'None listed').length,
        totalLobbyists: (firm.verifiedLobbyists || []).length,
        clientCount: (firm.recentClients || []).length,
        committeeOverlap: (firm.committeeRelationships?.topCommittees || []).filter(fc => 
          relevantCommittees.some(rc => (fc.committee || '').toLowerCase().includes(rc.name?.toLowerCase() || ''))
        ).length
      }
    };
  });
  
  return {
    topFirms: analyzed.sort((a, b) => b.scores.overallMatch - a.scores.overallMatch).slice(0, 5),
    relevantCommittees: relevantCommittees.map(c => c.fullName)
  };
}

// Build transparent methodology text
function buildMethodology(topFirms) {
  const top = topFirms[0];
  const scoreRange = {
    min: Math.min(...topFirms.map(f => f.scores.overallMatch)),
    max: Math.max(...topFirms.map(f => f.scores.overallMatch))
  };
  
  return `Matches are determined by a weighted algorithm analyzing three dimensions: **Issue Alignment (45%)** evaluates how prominently your policy area appears in each firm's LDA filings, with bonuses for specialized practices and high filing frequency in your issue. **Experience Depth (35%)** measures team credentials including former government officials (covered positions), relevant committee relationships, client portfolio breadth, and team size. **Cost Fit (20%)** assesses budget alignment based on billing data where available, or client portfolio size as a proxy. Scores ranged from ${scoreRange.min} to ${scoreRange.max} across the top 5 matches. The #1 match scored highest on ${top.scores.issueAlignment >= top.scores.experienceDepth ? 'issue alignment' : 'experience depth'}. All lobbyist data verified against Q3-Q4 2024 and Q1 2025 LD-2 filings; committee relationships derived from LD-203 contribution reports.`;
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

    // Build firm data for prompt
    const firmData = topFirms.map((f, i) => 
      `FIRM ${i+1}: ${f.name} (Score: ${f.scores.overallMatch}/100)
Website: ${f.website || 'N/A'}
Key Lobbyists: ${f.lobbyists.map(l => `${l.name}${l.position && l.position !== 'None listed' ? ` (Former: ${l.position})` : ''}`).join('; ')}
Representative Clients: ${f.clients.join(', ')}
Committee Relationships: ${f.committees.join('; ') || 'General government affairs'}
Issue Areas: ${f.issueAreas.map(i => i.code || i).join(', ')}
Stats: ${f._meta.coveredOfficials} former officials, ${f._meta.clientCount} clients, ${f._meta.committeeOverlap} relevant committees`
    ).join('\n\n');

    // Pre-build methodology for consistency
    const methodology = buildMethodology(topFirms);

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

## TOP 5 MATCHES (pre-ranked by algorithm - scores shown)
${firmData}

## OUTPUT INSTRUCTIONS

Write expert analysis explaining WHY each firm earned its ranking. The scores are pre-computed - your job is to provide compelling narratives that justify them.

Respond with this exact JSON structure:
{
  "executiveSummary": "3-4 sentences in warm, collegial tone. Lead with the #1 firm, their score, and why they stand out. Name a specific lobbyist and their relevant government experience. Mention committee relationships using 'established relationships with [Committee] members'. Reference what differentiates the top match from the others.",
  
  "matches": [
    {
      "rank": 1,
      "firmName": "Exact firm name from data",
      "firmWebsite": "URL from data or null",
      "rationale": "TWO SUBSTANTIAL PARAGRAPHS with **bold** on 2-3 key phrases per paragraph. First paragraph: Explain why this firm's issue alignment score is strong - cite their relevant clients, policy expertise, and how prominently your issue appears in their practice. Reference their committee relationships. Second paragraph: Highlight 1-2 specific lobbyists BY NAME with their government background (from the data), explain experience depth factors (team size, former officials), and address budget/cost fit.",
      "keyPersonnel": [
        {"name": "Real lobbyist name from data", "background": "Their former government position from the data, written out fully"},
        {"name": "Second lobbyist name", "background": "Their background"}
      ],
      "representativeClients": ["Client from data", "Another client", "Third client"],
      "keyStrengths": ["Strength tied to high sub-score", "Second strength with evidence", "Third strength"],
      "considerations": ["One honest consideration - perhaps a lower sub-score area or capacity question"]
    }
  ],
  
  "methodology": "${methodology.replace(/"/g, '\\"')}"
}

## CRITICAL RULES

1. DO NOT include a "scores" field - scores are pre-computed and added by the system.

2. NEVER use "access" - say "relationships with", "connections to", "experience with".

3. Use FUZZY NUMBERS: "more than 20 clients" not "23 clients".

4. "keyPersonnel" MUST use ONLY names from the lobbyists data. Minimum 2 per firm.

5. "representativeClients" MUST use ONLY clients from the data.

6. "keyStrengths" MUST have EXACTLY 3 items per firm.

7. "rationale" MUST be two full paragraphs with **bold** markers.

8. Reference the SCORES in your narratives - explain why #1 outranked #2, etc.

9. Respond with ONLY valid JSON, no markdown fences.`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a seasoned Washington DC lobbying expert. Write compelling, specific firm recommendations that explain algorithmic match scores. Be warm and collegial in tone. Respond with valid JSON only - no markdown code fences.'
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

    // INJECT pre-computed scores (authoritative)
    if (analysis.matches) {
      analysis.matches = analysis.matches.map((match, idx) => {
        const { scores: _, ...matchWithoutScores } = match;
        return {
          ...matchWithoutScores,
          scores: topFirms[idx]?.scores,
          firmWebsite: match.firmWebsite || topFirms[idx]?.website,
          rank: idx + 1
        };
      });
    }
    
    // Ensure methodology is included (use pre-built if Claude omitted or modified)
    if (!analysis.methodology || analysis.methodology.length < 100) {
      analysis.methodology = methodology;
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

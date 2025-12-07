const Anthropic = require('@anthropic-ai/sdk');

// Load data files - UPDATE THESE PATHS TO MATCH YOUR STRUCTURE
let firmData = { results: [] };
let issueCommitteeMap = {};

try {
  // Load the enriched firms file - uses data.results structure
  firmData = require('../lobbymatch/data/final-enriched-firms.json');
  issueCommitteeMap = require('../lobbymatch/data/issue-committee-map.json');
  console.log(`Loaded ${firmData.results?.length || 0} firms from final-enriched-firms.json`);
} catch (e) {
  console.log('Data files not fully loaded:', e.message);
}

// =============================================================================
// ANALYTICS ENGINE - Uses enrichment data for real differentiation
// =============================================================================

function parseBudgetToMonthly(budget) {
  if (!budget) return null;
  if (budget.includes('2,500-5,000')) return 3750;
  if (budget.includes('5,000-15,000')) return 10000;
  if (budget.includes('15,000-30,000')) return 22500;
  if (budget.includes('30,000+')) return 50000;
  return null;
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

// =============================================================================
// ENHANCED SCORING using enrichment.issues[].count and real data
// =============================================================================

function calcIssueAlignmentScore(firm, issueArea, additionalIssues) {
  // Use enrichment.issues if available (has filing counts)
  const enrichedIssues = firm.enrichment?.issues || [];
  const topIssues = firm.enrichment?.topIssues || [];
  
  let score = 0;
  
  // Find primary issue in enriched data
  const primaryIssueData = enrichedIssues.find(i => i.code === issueArea);
  
  if (primaryIssueData) {
    // Position bonus (0-30)
    const position = enrichedIssues.findIndex(i => i.code === issueArea);
    if (position === 0) score += 30;
    else if (position === 1) score += 25;
    else if (position === 2) score += 20;
    else if (position <= 4) score += 15;
    else score += 10;
    
    // Filing count bonus (0-40) - THIS IS THE BIG DIFFERENTIATOR
    const count = primaryIssueData.count || 0;
    if (count >= 500) score += 40;
    else if (count >= 200) score += 35;
    else if (count >= 100) score += 30;
    else if (count >= 50) score += 25;
    else if (count >= 25) score += 20;
    else if (count >= 10) score += 15;
    else score += 10;
  } else if (topIssues.includes(issueArea)) {
    // Fallback to topIssues array
    const position = topIssues.indexOf(issueArea);
    score += position <= 2 ? 25 : 15;
  }
  
  // Additional issues match (0-20)
  const additionalMatches = (additionalIssues || []).filter(issue => {
    return enrichedIssues.some(i => i.code === issue) || topIssues.includes(issue);
  }).length;
  const additionalTotal = (additionalIssues || []).length;
  if (additionalTotal > 0) {
    score += Math.round((additionalMatches / additionalTotal) * 20);
  } else {
    score += 10;
  }
  
  // Specialization bonus - fewer issues = more specialized (0-10)
  const issueCount = enrichedIssues.length;
  if (issueCount > 0 && issueCount <= 5) score += 10;
  else if (issueCount <= 8) score += 7;
  else if (issueCount <= 12) score += 4;
  else score += 2;
  
  return Math.min(100, score);
}

function calcExperienceDepthScore(firm, relevantCommittees) {
  let score = 0;
  
  // Covered officials from firm data (0-30)
  const coveredCount = firm.coveredOfficialCount || 
    (firm.lobbyists || []).filter(l => l.hasCoveredPosition).length;
  
  if (coveredCount >= 10) score += 30;
  else if (coveredCount >= 6) score += 25;
  else if (coveredCount >= 4) score += 22;
  else if (coveredCount >= 2) score += 18;
  else if (coveredCount >= 1) score += 12;
  else score += 5;
  
  // Committee relationship signal strength (0-35) - MAJOR DIFFERENTIATOR
  const committeeData = firm.committeeRelationships;
  if (committeeData?.topCommittees?.length > 0) {
    const relevantNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
    const matchingCommittees = committeeData.topCommittees.filter(tc => {
      const tcName = (tc.committee || '').toLowerCase();
      return relevantNames.some(rn => tcName.includes(rn) || rn.includes(tcName));
    });
    
    if (matchingCommittees.length >= 3) {
      const totalSignal = matchingCommittees.reduce((sum, c) => sum + (c.signalStrength || 0), 0);
      if (totalSignal >= 300000) score += 35;
      else if (totalSignal >= 150000) score += 30;
      else if (totalSignal >= 75000) score += 25;
      else score += 20;
    } else if (matchingCommittees.length >= 1) {
      score += 15;
    } else if (committeeData.topCommittees.length > 0) {
      score += 8;
    }
  }
  
  // Client portfolio depth (0-20)
  const clientCount = firm.enrichment?.clientCount || 0;
  if (clientCount >= 50) score += 20;
  else if (clientCount >= 30) score += 17;
  else if (clientCount >= 20) score += 14;
  else if (clientCount >= 10) score += 10;
  else score += 5;
  
  // Team size (0-15)
  const teamSize = firm.lobbyistCount || (firm.lobbyists || []).length;
  if (teamSize >= 10) score += 15;
  else if (teamSize >= 6) score += 12;
  else if (teamSize >= 4) score += 9;
  else score += 5;
  
  return Math.min(100, score);
}

function calcCostFitScore(firm, budget) {
  const budgetNum = parseBudgetToMonthly(budget);
  const billing = firm.enrichment?.billing;
  
  if (!budgetNum) {
    return 70; // No budget specified - neutral
  }
  
  if (billing && billing.averagePerFiling) {
    // Convert quarterly average to monthly estimate
    const avgMonthly = billing.averagePerFiling / 3;
    const minMonthly = (billing.min || billing.averagePerFiling * 0.5) / 3;
    const maxMonthly = (billing.max || billing.averagePerFiling * 1.5) / 3;
    
    if (budgetNum >= minMonthly * 0.8 && budgetNum <= maxMonthly * 1.2) return 95;
    if (budgetNum >= minMonthly * 0.5 && budgetNum <= maxMonthly * 1.5) return 80;
    if (budgetNum >= minMonthly * 0.3 && budgetNum <= maxMonthly * 2) return 65;
    return 45;
  }
  
  // Fallback: use client count as proxy
  const clientCount = firm.enrichment?.clientCount || 0;
  if (budget.includes('30,000+')) {
    return clientCount >= 30 ? 85 : clientCount >= 15 ? 70 : 55;
  } else if (budget.includes('15,000-30,000')) {
    return clientCount >= 15 && clientCount <= 50 ? 80 : 60;
  } else if (budget.includes('5,000-15,000')) {
    return clientCount <= 30 ? 80 : 60;
  } else {
    return clientCount <= 20 ? 80 : 55;
  }
}

function calcOverallMatchScore(issueScore, experienceScore, costScore) {
  return Math.round((issueScore * 0.45) + (experienceScore * 0.35) + (costScore * 0.20));
}

// =============================================================================
// FIRM ANALYSIS AND RANKING
// =============================================================================

function analyzeAndRankFirms(firms, { issueArea, additionalIssues, budget }) {
  const relevantCommittees = getRelevantCommittees(issueArea, additionalIssues);
  
  const analyzed = firms.map(firm => {
    const issueAlignmentScore = calcIssueAlignmentScore(firm, issueArea, additionalIssues);
    const experienceDepthScore = calcExperienceDepthScore(firm, relevantCommittees);
    const costFitScore = calcCostFitScore(firm, budget);
    const overallMatchScore = calcOverallMatchScore(issueAlignmentScore, experienceDepthScore, costFitScore);
    
    // Get primary issue filing count
    const primaryIssueData = (firm.enrichment?.issues || []).find(i => i.code === issueArea);
    const issueFilingCount = primaryIssueData?.count || 0;
    
    // Get lobbyists with covered positions
    const lobbyistsWithPositions = (firm.lobbyists || [])
      .filter(l => l.hasCoveredPosition && l.coveredPositions?.length > 0)
      .slice(0, 4)
      .map(l => ({
        name: l.name,
        position: l.coveredPositions[0]?.raw || 'Former government official'
      }));
    
    // Get clients from enrichment
    const clients = (firm.enrichment?.clients || [])
      .slice(0, 8)
      .map(c => typeof c === 'string' ? c : c.name);
    
    // Get committees
    const firmCommittees = (firm.committeeRelationships?.topCommittees || [])
      .slice(0, 5)
      .map(c => c.committee);
    
    return {
      name: firm.name,
      website: firm.website,
      scores: { 
        issueAlignment: issueAlignmentScore, 
        experienceDepth: experienceDepthScore, 
        costFit: costFitScore, 
        overallMatch: overallMatchScore 
      },
      issueFilingCount,
      lobbyists: lobbyistsWithPositions,
      clients,
      committees: firmCommittees,
      clientCount: firm.enrichment?.clientCount || clients.length,
      coveredOfficialCount: firm.coveredOfficialCount || lobbyistsWithPositions.length,
      billingAvg: firm.enrichment?.billing?.averagePerFiling || null
    };
  });
  
  // Sort and return TOP 3
  return {
    topFirms: analyzed.sort((a, b) => b.scores.overallMatch - a.scores.overallMatch).slice(0, 3),
    relevantCommittees: relevantCommittees.map(c => c.fullName),
    totalAnalyzed: firms.length
  };
}

// Build methodology
function buildMethodology(topFirms, totalAnalyzed) {
  const scores = topFirms.map(f => f.scores.overallMatch);
  const top = topFirms[0];
  
  return `Matches determined by weighted algorithm across ${totalAnalyzed} firms: **Issue Alignment (45%)** scores filing frequency in your policy area—${top.name} had ${top.issueFilingCount > 0 ? `more than ${Math.floor(top.issueFilingCount / 100) * 100} filings` : 'strong activity'} in this space. **Experience Depth (35%)** evaluates former government officials (${top.coveredOfficialCount} at top match), committee relationship signal strength, and client portfolio breadth. **Cost Fit (20%)** assesses budget alignment using billing data where available. Top 3 scores: ${scores.join(', ')}. Lobbyist credentials verified against Q3-Q4 2024 and Q1 2025 LD-2 filings; committee relationships derived from LD-203 contribution data.`;
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

    // Get firms from data.results
    const allFirms = firmData.results || [];
    
    if (allFirms.length === 0) {
      console.error('No firms loaded!');
      return res.status(500).json({ error: 'No firm data available' });
    }
    
    const { topFirms, relevantCommittees, totalAnalyzed } = analyzeAndRankFirms(allFirms, { issueArea, additionalIssues, budget });
    
    console.log(`Analytics: ${Date.now() - startTime}ms - Top 3 from ${totalAnalyzed} firms`);
    console.log(`Scores: ${topFirms.map(f => `${f.name}: ${f.scores.overallMatch} (I:${f.scores.issueAlignment} E:${f.scores.experienceDepth} C:${f.scores.costFit})`).join(' | ')}`);

    // Build prompt with TOP 3 firms
    const firmDataStr = topFirms.map((f, i) => 
      `FIRM ${i+1}: ${f.name} (Score: ${f.scores.overallMatch}/100 | Issue: ${f.scores.issueAlignment} | Experience: ${f.scores.experienceDepth} | Cost: ${f.scores.costFit})
Website: ${f.website || 'N/A'}
Issue Filing Count: ${f.issueFilingCount > 0 ? `${f.issueFilingCount} filings in ${issueArea}` : 'Active in this area'}
Key Lobbyists: ${f.lobbyists.map(l => `${l.name} (${l.position})`).join('; ') || 'Team available'}
Representative Clients: ${f.clients.join(', ') || 'Various clients'}
Committee Relationships: ${f.committees.join('; ') || 'General government affairs'}
Stats: ${f.coveredOfficialCount} former officials, ${f.clientCount} total clients`
    ).join('\n\n');

    const methodology = buildMethodology(topFirms, totalAnalyzed);

    const prompt = `Analyze these TOP 3 lobbying firm matches for a ${organizationType} client. Scores are pre-computed—explain why each firm earned its ranking.

## CLIENT PROFILE
**Organization:** ${orgDescription}
**Primary Issue:** ${issueArea}
**Additional Issues:** ${additionalIssues?.length ? additionalIssues.join(', ') : 'None'}
**Policy Goals:** ${policyGoals || 'Not specified'}
**Budget:** ${budget || 'Not specified'}

## RELEVANT COMMITTEES
${relevantCommittees.slice(0, 4).join(', ')}

## TOP 3 MATCHES
${firmDataStr}

## OUTPUT FORMAT

{
  "executiveSummary": "3-4 sentences. Lead with #1 firm and their score. Name a specific lobbyist with their government background. Explain what differentiates them from #2 and #3. Warm, collegial tone—like advice from a DC insider.",
  
  "matches": [
    {
      "rank": 1,
      "firmName": "Exact name",
      "firmWebsite": "URL or null",
      "rationale": "TWO PARAGRAPHS with **bold** on 2-3 phrases each. P1: Why their issue alignment score is high—cite filing count, client types, committee relationships. P2: Highlight 1-2 lobbyists BY NAME with government background, address experience depth and cost fit.",
      "keyPersonnel": [
        {"name": "Real name from data", "background": "Their position from data—write out fully"}
      ],
      "representativeClients": ["From data only"],
      "keyStrengths": ["Strength 1", "Strength 2", "Strength 3"],
      "considerations": ["One honest consideration"]
    }
  ],
  
  "methodology": "${methodology.replace(/"/g, '\\"')}"
}

RULES:
- Never say "access"—use "relationships with"
- Fuzzy numbers: "more than 1,000 filings" not "1,171 filings"  
- keyPersonnel: ONLY names from data, minimum 2 per firm
- keyStrengths: EXACTLY 3 per firm
- JSON only, no markdown fences`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a DC lobbying expert. Write compelling recommendations explaining algorithmic match scores. Warm, collegial tone. Valid JSON only.'
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

    // Inject pre-computed scores
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
        timeMs: Date.now() - startTime,
        firmsAnalyzed: totalAnalyzed
      }
    });

  } catch (error) {
    console.error('Match error:', error);
    return res.status(500).json({ error: 'Failed to generate matches', details: error.message });
  }
};

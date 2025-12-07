const Anthropic = require('@anthropic-ai/sdk');

// Load data files
let firmData = { results: [] };
let issueCommitteeMap = {};

try {
  firmData = require('../lobbymatch/data/final-enriched-firms.json');
  issueCommitteeMap = require('../lobbymatch/data/issue-committee-map.json');
  console.log(`Loaded ${firmData.results?.length || 0} firms from final-enriched-firms.json`);
} catch (e) {
  console.log('Data files not fully loaded:', e.message);
}

// =============================================================================
// ANALYTICS ENGINE - Percentile-based relative scoring
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
// RAW METRIC EXTRACTION (before percentile conversion)
// =============================================================================

function extractRawMetrics(firm, issueArea, additionalIssues, relevantCommittees, budget) {
  const enrichedIssues = firm.enrichment?.issues || [];
  const topIssues = firm.enrichment?.topIssues || [];
  
  // Issue metrics
  const primaryIssueData = enrichedIssues.find(i => i.code === issueArea);
  const issueFilingCount = primaryIssueData?.count || 0;
  const issuePosition = primaryIssueData 
    ? enrichedIssues.findIndex(i => i.code === issueArea) 
    : (topIssues.includes(issueArea) ? topIssues.indexOf(issueArea) : 99);
  
  const additionalMatches = (additionalIssues || []).filter(issue => {
    return enrichedIssues.some(i => i.code === issue) || topIssues.includes(issue);
  }).length;
  const additionalTotal = (additionalIssues || []).length || 1;
  const additionalMatchRate = additionalMatches / additionalTotal;
  
  const issueCount = enrichedIssues.length || 20; // Specialization (lower = more specialized)
  
  // Experience metrics
  const coveredCount = firm.coveredOfficialCount || 
    (firm.lobbyists || []).filter(l => l.hasCoveredPosition).length;
  
  const committeeData = firm.committeeRelationships;
  let committeeSignalStrength = 0;
  let committeeOverlapCount = 0;
  
  if (committeeData?.topCommittees?.length > 0) {
    const relevantNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
    const matchingCommittees = committeeData.topCommittees.filter(tc => {
      const tcName = (tc.committee || '').toLowerCase();
      return relevantNames.some(rn => tcName.includes(rn) || rn.includes(tcName));
    });
    committeeOverlapCount = matchingCommittees.length;
    committeeSignalStrength = matchingCommittees.reduce((sum, c) => sum + (c.signalStrength || 0), 0);
  }
  
  const clientCount = firm.enrichment?.clientCount || 0;
  const teamSize = firm.lobbyistCount || (firm.lobbyists || []).length;
  
  // Cost metrics
  const billing = firm.enrichment?.billing;
  const avgBilling = billing?.averagePerFiling || 0;
  const budgetNum = parseBudgetToMonthly(budget);
  
  let costDistance = 50; // Default middle
  if (budgetNum && avgBilling) {
    const avgMonthly = avgBilling / 3;
    costDistance = Math.abs(budgetNum - avgMonthly) / avgMonthly;
  }
  
  return {
    // Issue raw metrics
    issueFilingCount,
    issuePosition,
    additionalMatchRate,
    issueCount,
    
    // Experience raw metrics
    coveredCount,
    committeeSignalStrength,
    committeeOverlapCount,
    clientCount,
    teamSize,
    
    // Cost raw metrics
    avgBilling,
    costDistance,
    
    // Pass-through data
    firm,
    primaryIssueData
  };
}

// =============================================================================
// PERCENTILE CALCULATION
// =============================================================================

function calculatePercentile(value, allValues, higherIsBetter = true) {
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter(v => v < value).length;
  const percentile = (rank / sorted.length) * 100;
  return higherIsBetter ? percentile : (100 - percentile);
}

function convertToPercentileScores(allMetrics) {
  // Extract arrays for each metric
  const filingCounts = allMetrics.map(m => m.issueFilingCount);
  const positions = allMetrics.map(m => m.issuePosition);
  const additionalRates = allMetrics.map(m => m.additionalMatchRate);
  const issueCounts = allMetrics.map(m => m.issueCount);
  
  const coveredCounts = allMetrics.map(m => m.coveredCount);
  const signalStrengths = allMetrics.map(m => m.committeeSignalStrength);
  const overlapCounts = allMetrics.map(m => m.committeeOverlapCount);
  const clientCounts = allMetrics.map(m => m.clientCount);
  const teamSizes = allMetrics.map(m => m.teamSize);
  
  const costDistances = allMetrics.map(m => m.costDistance);
  
  return allMetrics.map(m => {
    // Issue Alignment Score (percentile-based)
    const filingPercentile = calculatePercentile(m.issueFilingCount, filingCounts, true);
    const positionPercentile = calculatePercentile(m.issuePosition, positions, false); // Lower is better
    const additionalPercentile = calculatePercentile(m.additionalMatchRate, additionalRates, true);
    const specializationPercentile = calculatePercentile(m.issueCount, issueCounts, false); // Fewer = more specialized
    
    const issueAlignmentScore = Math.round(
      (filingPercentile * 0.45) +      // Filing count most important
      (positionPercentile * 0.30) +    // Position in firm's practice
      (additionalPercentile * 0.15) +  // Additional issues match
      (specializationPercentile * 0.10) // Specialization bonus
    );
    
    // Experience Depth Score (percentile-based)
    const coveredPercentile = calculatePercentile(m.coveredCount, coveredCounts, true);
    const signalPercentile = calculatePercentile(m.committeeSignalStrength, signalStrengths, true);
    const overlapPercentile = calculatePercentile(m.committeeOverlapCount, overlapCounts, true);
    const clientPercentile = calculatePercentile(m.clientCount, clientCounts, true);
    const teamPercentile = calculatePercentile(m.teamSize, teamSizes, true);
    
    const experienceDepthScore = Math.round(
      (coveredPercentile * 0.30) +      // Former officials
      (signalPercentile * 0.30) +       // Committee relationship strength
      (overlapPercentile * 0.15) +      // Committee relevance overlap
      (clientPercentile * 0.15) +       // Client portfolio depth
      (teamPercentile * 0.10)           // Team size
    );
    
    // Cost Fit Score (percentile-based - lower distance is better)
    const costPercentile = calculatePercentile(m.costDistance, costDistances, false);
    const costFitScore = Math.round(costPercentile);
    
    // Overall weighted score
    const overallMatchScore = Math.round(
      (issueAlignmentScore * 0.45) +
      (experienceDepthScore * 0.35) +
      (costFitScore * 0.20)
    );
    
    return {
      ...m,
      scores: {
        issueAlignment: issueAlignmentScore,
        experienceDepth: experienceDepthScore,
        costFit: costFitScore,
        overallMatch: overallMatchScore
      }
    };
  });
}

// =============================================================================
// FIRM ANALYSIS AND RANKING
// =============================================================================

function analyzeAndRankFirms(firms, { issueArea, additionalIssues, budget }) {
  const relevantCommittees = getRelevantCommittees(issueArea, additionalIssues);
  
  // Step 1: Extract raw metrics for ALL firms
  const allMetrics = firms.map(firm => 
    extractRawMetrics(firm, issueArea, additionalIssues, relevantCommittees, budget)
  );
  
  // Step 2: Convert to percentile scores (relative ranking)
  const scoredMetrics = convertToPercentileScores(allMetrics);
  
  // Step 3: Build output objects and sort
  const analyzed = scoredMetrics.map(m => {
    const firm = m.firm;
    
    // Get lobbyists with covered positions
    const lobbyistsWithPositions = (firm.lobbyists || [])
      .filter(l => l.hasCoveredPosition && l.coveredPositions?.length > 0)
      .slice(0, 4)
      .map(l => ({
        name: l.name,
        position: l.coveredPositions[0]?.raw || 'Former government official'
      }));
    
    // Get clients
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
      scores: m.scores,
      issueFilingCount: m.issueFilingCount,
      lobbyists: lobbyistsWithPositions,
      clients,
      committees: firmCommittees,
      clientCount: firm.enrichment?.clientCount || clients.length,
      coveredOfficialCount: firm.coveredOfficialCount || lobbyistsWithPositions.length,
      billingAvg: firm.enrichment?.billing?.averagePerFiling || null,
      // Include raw metrics for methodology transparency
      _rawMetrics: {
        filingCount: m.issueFilingCount,
        coveredOfficials: m.coveredCount,
        committeeSignal: Math.round(m.committeeSignalStrength),
        committeeOverlap: m.committeeOverlapCount
      }
    };
  });
  
  // Sort and return TOP 3
  const sorted = analyzed.sort((a, b) => b.scores.overallMatch - a.scores.overallMatch);
  
  return {
    topFirms: sorted.slice(0, 3),
    relevantCommittees: relevantCommittees.map(c => c.fullName),
    totalAnalyzed: firms.length,
    scoreDistribution: {
      top: sorted[0]?.scores.overallMatch,
      median: sorted[Math.floor(sorted.length / 2)]?.scores.overallMatch,
      bottom: sorted[sorted.length - 1]?.scores.overallMatch
    }
  };
}

// Build methodology
function buildMethodology(topFirms, totalAnalyzed, scoreDistribution) {
  const scores = topFirms.map(f => f.scores.overallMatch);
  const top = topFirms[0];
  
  return `Matches determined by **percentile ranking** across ${totalAnalyzed} firms—scores reflect how each firm compares to all others in the dataset, not absolute thresholds. **Issue Alignment (45%)** ranks filing frequency (${top._rawMetrics.filingCount} filings for #1), issue position prominence, and practice specialization. **Experience Depth (35%)** ranks former government officials (${top._rawMetrics.coveredOfficials} at #1), committee relationship signal strength, and client portfolio breadth. **Cost Fit (20%)** ranks budget alignment using billing data. Score distribution: Top ${scoreDistribution.top}, Median ${scoreDistribution.median}, Bottom ${scoreDistribution.bottom}. Top 3 scores: ${scores.join(', ')}. Lobbyist credentials verified against Q3-Q4 2024 and Q1 2025 LD-2 filings.`;
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

    const allFirms = firmData.results || [];
    
    if (allFirms.length === 0) {
      console.error('No firms loaded!');
      return res.status(500).json({ error: 'No firm data available' });
    }
    
    const { topFirms, relevantCommittees, totalAnalyzed, scoreDistribution } = analyzeAndRankFirms(allFirms, { issueArea, additionalIssues, budget });
    
    console.log(`Analytics: ${Date.now() - startTime}ms - Top 3 from ${totalAnalyzed} firms`);
    console.log(`Scores: ${topFirms.map(f => `${f.name}: ${f.scores.overallMatch} (I:${f.scores.issueAlignment} E:${f.scores.experienceDepth} C:${f.scores.costFit})`).join(' | ')}`);
    console.log(`Distribution: Top ${scoreDistribution.top}, Median ${scoreDistribution.median}, Bottom ${scoreDistribution.bottom}`);

    // Build prompt
    const firmDataStr = topFirms.map((f, i) => 
      `FIRM ${i+1}: ${f.name} (Score: ${f.scores.overallMatch}/100 | Issue: ${f.scores.issueAlignment} | Experience: ${f.scores.experienceDepth} | Cost: ${f.scores.costFit})
Website: ${f.website || 'N/A'}
Issue Filing Count: ${f.issueFilingCount > 0 ? `${f.issueFilingCount} filings in ${issueArea}` : 'Active in this area'}
Key Lobbyists: ${f.lobbyists.map(l => `${l.name} (${l.position})`).join('; ') || 'Team available'}
Representative Clients: ${f.clients.join(', ') || 'Various clients'}
Committee Relationships: ${f.committees.join('; ') || 'General government affairs'}
Stats: ${f.coveredOfficialCount} former officials, ${f.clientCount} total clients`
    ).join('\n\n');

    const methodology = buildMethodology(topFirms, totalAnalyzed, scoreDistribution);

    const prompt = `Analyze these TOP 3 lobbying firm matches for a ${organizationType} client. Scores are percentile-based—explain why each firm ranks where they do RELATIVE to the ${totalAnalyzed} other firms.

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

## SCORE CONTEXT
These are percentile scores: ${scoreDistribution.top} is top of ${totalAnalyzed} firms, median is ${scoreDistribution.median}.

## OUTPUT FORMAT

{
  "executiveSummary": "3-4 sentences. Lead with #1 firm and their percentile score. Name a specific lobbyist with their government background. Explain what differentiates #1 from #2 and #3 using specific metrics. Warm, collegial tone.",
  
  "matches": [
    {
      "rank": 1,
      "firmName": "Exact name",
      "firmWebsite": "URL or null",
      "rationale": "TWO PARAGRAPHS with **bold** on 2-3 phrases each. P1: Why their issue alignment percentile is high—cite filing count, client types, how they compare to other firms. P2: Highlight 1-2 lobbyists BY NAME with government background, address experience depth and cost fit percentiles.",
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
- Scores are PERCENTILES (0-100 relative rank), not absolute ratings
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
      system: 'You are a DC lobbying expert. Write compelling recommendations explaining percentile-based match scores. Warm, collegial tone. Valid JSON only.'
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
        firmsAnalyzed: totalAnalyzed,
        scoreDistribution
      }
    });

  } catch (error) {
    console.error('Match error:', error);
    return res.status(500).json({ error: 'Failed to generate matches', details: error.message });
  }
};

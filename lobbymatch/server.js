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

// =============================================================================
// ANALYTICS ENGINE - All scoring/filtering happens here, not in Claude
// =============================================================================

// Parse budget string to monthly number
function parseBudgetToMonthly(budget) {
  if (!budget) return 10000;
  if (budget.includes('2,500-5,000')) return 3750;
  if (budget.includes('5,000-15,000')) return 10000;
  if (budget.includes('15,000-30,000')) return 22500;
  if (budget.includes('30,000+')) return 50000;
  return 10000;
}

// Get relevant committees for user's issues
function getRelevantCommittees(issueArea, additionalIssues) {
  const allIssues = [issueArea, ...(additionalIssues || [])].filter(Boolean);
  const committees = [];
  
  allIssues.forEach(issue => {
    const mapping = issueCommitteeMap.mappings?.[issue];
    if (mapping?.committees) {
      mapping.committees.forEach(c => {
        committees.push({
          name: c.committee,
          chamber: c.chamber,
          fullName: `${c.chamber} ${c.committee}`,
          issueCode: issue
        });
      });
    }
  });
  
  // Deduplicate by fullName
  const seen = new Set();
  return committees.filter(c => {
    if (seen.has(c.fullName)) return false;
    seen.add(c.fullName);
    return true;
  });
}

// Calculate Issue Alignment Score (0-100)
function calcIssueAlignmentScore(firm, issueArea, additionalIssues) {
  const allIssues = [issueArea, ...(additionalIssues || [])].filter(Boolean);
  const firmIssues = (firm.issueAreas || []).map(i => i.code || i);
  
  let score = 0;
  const maxPossible = allIssues.length > 0 ? 100 : 0;
  
  // Primary issue match (worth 60 points)
  if (firmIssues.includes(issueArea)) {
    // Check position in firm's issue list (higher = more specialized)
    const position = firmIssues.indexOf(issueArea);
    if (position === 0) score += 60; // Top specialty
    else if (position <= 2) score += 50; // Top 3
    else if (position <= 5) score += 40; // Top 6
    else score += 30; // Present but not core
  }
  
  // Additional issues (worth up to 40 points)
  const additionalMatches = (additionalIssues || []).filter(i => firmIssues.includes(i)).length;
  const additionalTotal = (additionalIssues || []).length;
  if (additionalTotal > 0) {
    score += Math.round((additionalMatches / additionalTotal) * 40);
  } else {
    // No additional issues specified, give benefit of doubt
    score += 20;
  }
  
  return Math.min(100, score);
}

// Calculate Experience Depth Score (0-100)
function calcExperienceDepthScore(firm, relevantCommittees) {
  let score = 0;
  
  // Covered officials (revolving door value) - up to 40 points
  const coveredLobbyists = (firm.verifiedLobbyists || [])
    .filter(l => l.coveredPosition && l.coveredPosition !== 'None listed');
  const coveredCount = coveredLobbyists.length;
  score += Math.min(coveredCount * 10, 40);
  
  // Committee relationships - up to 40 points
  const firmCommittees = (firm.committeeRelationships?.topCommittees || [])
    .map(c => c.committee?.toLowerCase() || '');
  const relevantCommitteeNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
  
  const committeeOverlap = firmCommittees.filter(fc => 
    relevantCommitteeNames.some(rc => fc.includes(rc) || rc.includes(fc))
  ).length;
  
  if (committeeOverlap >= 3) score += 40;
  else if (committeeOverlap >= 2) score += 30;
  else if (committeeOverlap >= 1) score += 20;
  else if (firmCommittees.length > 0) score += 10; // Has relationships, just not to relevant committees
  
  // Client portfolio depth - up to 20 points
  const clientCount = (firm.recentClients || []).length;
  if (clientCount >= 20) score += 20;
  else if (clientCount >= 10) score += 15;
  else if (clientCount >= 5) score += 10;
  else score += 5;
  
  return Math.min(100, score);
}

// Calculate Cost Fit Score (0-100)
function calcCostFitScore(firm, budget) {
  if (!budget || !firm.billingRange) return 50; // Neutral if no data
  
  const budgetNum = parseBudgetToMonthly(budget);
  const firmMin = firm.billingRange.minMonthly || 0;
  const firmMax = firm.billingRange.maxMonthly || Infinity;
  
  // Perfect fit: budget within range
  if (budgetNum >= firmMin && budgetNum <= firmMax) {
    return 90;
  }
  
  // Close fit: budget within 50% of range
  if (budgetNum >= firmMin * 0.5 && budgetNum <= firmMax * 1.5) {
    return 70;
  }
  
  // Stretch fit: budget within 2x of range
  if (budgetNum >= firmMin * 0.25 && budgetNum <= firmMax * 2) {
    return 50;
  }
  
  // Poor fit
  return 30;
}

// Calculate Overall Match Score (weighted composite)
function calcOverallMatchScore(issueScore, experienceScore, costScore) {
  // Weights: Issue 45%, Experience 35%, Cost 20%
  return Math.round(
    (issueScore * 0.45) + 
    (experienceScore * 0.35) + 
    (costScore * 0.20)
  );
}

// Filter lobbyists relevant to the client's issues
function filterRelevantPersonnel(firm, relevantCommittees) {
  const lobbyists = firm.verifiedLobbyists || [];
  const relevantCommitteeNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
  
  return lobbyists
    .map(l => {
      const position = (l.coveredPosition || '').toLowerCase();
      const hasCoveredPosition = position && position !== 'none listed';
      
      // Check if position relates to relevant committees
      const isRelevant = relevantCommitteeNames.some(rc => position.includes(rc)) ||
        position.includes('senate') || position.includes('house') ||
        position.includes('committee') || position.includes('secretary') ||
        position.includes('director') || position.includes('counsel');
      
      return {
        name: l.name,
        coveredPosition: l.coveredPosition,
        hasCoveredPosition,
        isRelevant: hasCoveredPosition && isRelevant,
        relevanceScore: hasCoveredPosition ? (isRelevant ? 2 : 1) : 0
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 4); // Top 4 most relevant
}

// Find committee overlap between firm and client's issues
function findCommitteeOverlap(firm, relevantCommittees) {
  const firmCommittees = firm.committeeRelationships?.topCommittees || [];
  const relevantNames = relevantCommittees.map(c => c.name?.toLowerCase() || '');
  
  return firmCommittees
    .filter(fc => {
      const fcName = (fc.committee || '').toLowerCase();
      return relevantNames.some(rc => fcName.includes(rc) || rc.includes(fcName));
    })
    .slice(0, 4)
    .map(fc => ({
      committee: fc.committee,
      chamber: fc.chamber
    }));
}

// Main analytics function - returns top 5 firms with all pre-computed data
function analyzeAndRankFirms(firms, { issueArea, additionalIssues, budget, organizationType }) {
  const relevantCommittees = getRelevantCommittees(issueArea, additionalIssues);
  
  const analyzed = firms.map(firm => {
    // Calculate all scores
    const issueAlignmentScore = calcIssueAlignmentScore(firm, issueArea, additionalIssues);
    const experienceDepthScore = calcExperienceDepthScore(firm, relevantCommittees);
    const costFitScore = calcCostFitScore(firm, budget);
    const overallMatchScore = calcOverallMatchScore(issueAlignmentScore, experienceDepthScore, costFitScore);
    
    // Pre-filter relevant data
    const relevantPersonnel = filterRelevantPersonnel(firm, relevantCommittees);
    const committeeOverlap = findCommitteeOverlap(firm, relevantCommittees);
    
    return {
      // Core firm data (slimmed)
      name: firm.name,
      registrantId: firm.registrantId,
      website: firm.website,
      
      // Pre-computed scores (deterministic)
      scores: {
        issueAlignment: issueAlignmentScore,
        experienceDepth: experienceDepthScore,
        costFit: costFitScore,
        overallMatch: overallMatchScore
      },
      
      // Pre-filtered relevant data for Claude to write about
      issueAreas: (firm.issueAreas || []).slice(0, 6),
      relevantPersonnel,
      relevantCommittees: committeeOverlap,
      recentClients: (firm.recentClients || []).slice(0, 8).map(c =>
        typeof c === 'string' ? { name: c } : { name: c.name, description: (c.description || '').slice(0, 80) }
      ),
      billingRange: firm.billingRange ? {
        minMonthly: firm.billingRange.minMonthly,
        maxMonthly: firm.billingRange.maxMonthly,
        avgQuarterly: firm.billingRange.avgQuarterly
      } : null
    };
  });
  
  // Sort by overall match score and return top 5
  return {
    topFirms: analyzed
      .sort((a, b) => b.scores.overallMatch - a.scores.overallMatch)
      .slice(0, 5),
    relevantCommittees: relevantCommittees.map(c => c.fullName)
  };
}

// =============================================================================
// API ROUTES
// =============================================================================

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

    // Run analytics engine - get top 5 firms with pre-computed scores
    const allFirms = firmProfiles.firms || firmProfiles;
    const { topFirms, relevantCommittees } = analyzeAndRankFirms(allFirms, {
      issueArea,
      additionalIssues,
      budget,
      organizationType
    });
    
    console.log(`Analytics complete: Top 5 from ${allFirms.length} firms`);
    console.log(`Relevant committees: ${relevantCommittees.join(', ')}`);

    // Build the prompt - Claude writes narrative only, scores are fixed
    const matchingPrompt = buildMatchingPrompt({
      organizationType,
      issueArea,
      additionalIssues,
      budget,
      priorities,
      orgDescription,
      policyGoals,
      timeline,
      topFirms,
      relevantCommittees
    });

    // Call Claude API - Sonnet for high-quality narrative
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: matchingPrompt }
      ],
      system: `You are a seasoned Washington, DC political insider with deep expertise in federal lobbying. You understand how congressional and executive branch advocacy works, and you can translate between an ordinary citizen's needs and the specialized knowledge of a federal lobbyist.

Your role is to write compelling, insightful narratives about lobbying firm matches. The analytical ranking and scoring has already been done - your job is to bring the data to life with expert context and nuanced explanation.

Write in a warm, authoritative voice - like a trusted colleague who knows the Hill inside and out. Be specific with names, committees, and policy areas. Avoid generic language.

Important: This analysis is based on public LDA filings and is for informational purposes only. It does not constitute legal, business, or professional advice.`
    });

    // Parse response
    const analysisText = message.content[0].text;
    
    let analysisData;
    try {
      const cleanedText = analysisText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      analysisData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      analysisData = { raw: analysisText };
    }
    
    // Merge Claude's narratives with our pre-computed scores
    if (analysisData.matches) {
      analysisData.matches = analysisData.matches.map((match, idx) => ({
        ...match,
        scores: topFirms[idx]?.scores || match.scores, // Use pre-computed scores
        rank: idx + 1
      }));
    }
    
    res.json({
      success: true,
      analysis: analysisData,
      metadata: {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        firmsAnalyzed: allFirms.length,
        firmsReturned: 5
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

// =============================================================================
// PROMPT BUILDER - Streamlined for narrative generation only
// =============================================================================

function buildMatchingPrompt({ organizationType, issueArea, additionalIssues, budget, priorities, orgDescription, policyGoals, timeline, topFirms, relevantCommittees }) {
  
  const firmData = JSON.stringify(topFirms, null, 2);
  
  return `Write expert narratives for the TOP 5 lobbying firm matches below. Scores and ranking are pre-computed - focus on explaining WHY each firm fits.

## Client Profile

**Organization Type:** ${organizationType}
**Primary Issue Area:** ${issueArea}
**Additional Issues:** ${additionalIssues?.length ? additionalIssues.join(', ') : 'None specified'}
**Budget Range:** ${budget || 'Not specified'}
**Key Priorities:** ${priorities || 'Not specified'}
**Organization Description:** ${orgDescription}
**Policy Goals:** ${policyGoals || 'Not specified'}
**Timeline & Context:** ${timeline || 'Not specified'}

## Relevant Congressional Committees

${relevantCommittees.length ? relevantCommittees.join('\n') : 'General government affairs'}

## Pre-Ranked Firms (Top 5 by Match Score)

${firmData}

## Required Output Format

Respond with valid JSON only. The scores are ALREADY COMPUTED - do not change them. Write narratives that explain the pre-computed rankings.

{
  "executiveSummary": "3-4 sentences in a warm, conversational tone. Lead with the top firm and why it stands out. Reference specific lobbyist names and their government experience. Mention relevant committee relationships using phrases like 'established relationships with [Committee] members'. Make it feel like advice from a trusted colleague, not a report.",
  "matches": [
    {
      "rank": 1,
      "firmName": "[Use firm name from data]",
      "firmWebsite": "[Use website from data]",
      "rationale": "Two substantial paragraphs with **bold** markers on 2-3 key phrases per paragraph. First paragraph: WHY this firm understands the client's issue - cite policy work, legislation, client types. Mention committee relationships naturally. Second paragraph: highlight 1-2 specific lobbyists by name with their government background, explain fee alignment.",
      "keyPersonnel": [
        {
          "name": "[Real name from relevantPersonnel]",
          "background": "[Use coveredPosition - write out fully, e.g., 'Former Chief Counsel, Senate Finance Committee (2015-2019)']"
        }
      ],
      "representativeClients": ["[From recentClients array]", "[Specific names]", "[3-4 total]"],
      "subjectsLobbied": ["[Specific legislation relevant to client]", "[Policy areas]", "[3 total]"],
      "keyStrengths": ["[Specific strength with data]", "[Second strength]", "[Third strength - exactly 3]"],
      "considerations": ["[Honest consideration with context]"]
    }
  ],
  "methodology": "One paragraph: matches determined by analyzing LDA filing history, issue code frequency, lobbyist credentials, client portfolio similarity, Capitol Hill relationships, and budget alignment. Lobbyist verification based on Q3-Q4 2024 and Q1 2025 LD-2 filings. Scores are algorithmically computed for consistency."
}

CRITICAL RULES:

1. NEVER use the word "access" - use "relationships with", "engagement with", "connections to", "experience working with".

2. Use FUZZY NUMBERS: "more than 50 filings" not "57 filings", "dozens of engagements" not "38 engagements".

3. NO COMMITTEE MEMBER COUNTS: Say "established relationships with Senate Finance Committee members" not "relationships with 12 members".

4. "keyPersonnel" must use ONLY names from the "relevantPersonnel" array. Minimum 2 people per firm.

5. "representativeClients" must use ONLY clients from "recentClients" array.

6. "keyStrengths" must have EXACTLY 3 items per firm.

7. DO NOT include or modify the "scores" object - it will be added from pre-computed values.

8. Maintain the EXACT ORDER of firms as provided (they are pre-ranked).

9. Respond with ONLY the JSON object.`;
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

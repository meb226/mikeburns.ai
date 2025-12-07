require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let firmProfiles = { firms: [] };
let issueCommitteeMap = {};

try {
  firmProfiles = require('./data/firm-profiles.json');
  issueCommitteeMap = require('./data/issue-committee-map.json');
} catch (e) {
  console.log('Data files not fully loaded:', e.message);
}

// =============================================================================
// ANALYTICS ENGINE
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
      issueAreas: (firm.issueAreas || []).slice(0, 5),
      lobbyists: (firm.verifiedLobbyists || []).slice(0, 3).map(l => ({ name: l.name, position: l.coveredPosition })),
      clients: (firm.recentClients || []).slice(0, 5).map(c => typeof c === 'string' ? c : c.name),
    };
  });
  
  return {
    topFirms: analyzed.sort((a, b) => b.scores.overallMatch - a.scores.overallMatch).slice(0, 5),
    relevantCommittees: relevantCommittees.map(c => c.fullName)
  };
}

// =============================================================================
// API ROUTES
// =============================================================================

app.get('/api/issues', (req, res) => {
  res.json(require('./data/issue-codes.json'));
});

app.get('/api/scenarios', (req, res) => {
  res.json(require('./data/example-scenarios.json'));
});

// Main endpoint - NON-STREAMING for simplicity and speed
app.post('/api/match', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { organizationType, issueArea, additionalIssues, budget, priorities, orgDescription, policyGoals, timeline } = req.body;

    if (!organizationType || !issueArea || !orgDescription) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Analytics
    const allFirms = firmProfiles.firms || firmProfiles;
    const { topFirms, relevantCommittees } = analyzeAndRankFirms(allFirms, { issueArea, additionalIssues, budget });
    
    console.log(`Analytics: ${Date.now() - startTime}ms - Top 5 from ${allFirms.length} firms`);

    // Compact prompt - only essential data
    const firmData = topFirms.map((f, i) => 
      `${i+1}. ${f.name} (Score: ${f.scores.overallMatch}) | Lobbyists: ${f.lobbyists.map(l => `${l.name}${l.position && l.position !== 'None listed' ? ` (${l.position})` : ''}`).join(', ')} | Clients: ${f.clients.join(', ')}`
    ).join('\n');

    const prompt = `Write brief analysis for these 5 lobbying firm matches for a ${organizationType} focused on ${issueArea}.

Client: ${orgDescription}
${policyGoals ? `Goals: ${policyGoals}` : ''}

TOP 5 MATCHES:
${firmData}

Respond with JSON only:
{
  "executiveSummary": "2-3 sentences recommending the top firm and why it fits.",
  "matches": [
    {
      "rank": 1,
      "firmName": "Name",
      "firmWebsite": "url or null",
      "rationale": "2-3 sentences on why this firm fits the client's needs.",
      "keyPersonnel": [{"name": "Name", "background": "Former role if any"}],
      "representativeClients": ["Client1", "Client2"],
      "keyStrengths": ["Strength 1", "Strength 2", "Strength 3"],
      "considerations": ["One consideration"]
    }
  ],
  "methodology": "Brief explanation of matching approach."
}

Rules: Never say "access" (use "relationships with"). Be specific. JSON only.`;

    // Call Claude - HAIKU for speed
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a DC lobbying expert. Write concise, specific recommendations. Respond with valid JSON only.'
    });

    console.log(`Claude API: ${Date.now() - startTime}ms`);

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

    // Merge pre-computed scores
    if (analysis.matches) {
      analysis.matches = analysis.matches.map((match, idx) => ({
        ...match,
        scores: topFirms[idx]?.scores || match.scores,
        firmWebsite: topFirms[idx]?.website || match.firmWebsite,
        rank: idx + 1
      }));
    }

    console.log(`Total: ${Date.now() - startTime}ms`);

    res.json({
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
    res.status(500).json({ error: 'Failed to generate matches', details: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LobbyMatch running on http://localhost:${PORT}`);
  console.log(`Firms loaded: ${firmProfiles.firms?.length || 0}`);
});

module.exports = app;

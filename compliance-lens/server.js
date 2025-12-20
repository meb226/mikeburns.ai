require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure file upload
const upload = multer({ dest: 'uploads/' });

// Serve static files
app.use(express.static('.'));
app.use(express.json());

// File upload and analysis endpoint
app.post('/analyze', upload.single('policy'), async (req, res) => {
  try {
    let policyText = '';
    let framework = '';
    
    // Check if this is a template submission (JSON) or file upload (FormData)
    if (req.body.isTemplate) {
      // Template submission
      policyText = req.body.policyText;
      framework = req.body.framework;
    } else {
      // File upload
      const file = req.file;
      framework = req.body.framework;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Extract text based on file type
      if (file.mimetype === 'application/pdf') {
        const dataBuffer = await fs.readFile(file.path);
        const pdfData = await pdfParse(dataBuffer);
        policyText = pdfData.text;
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ path: file.path });
        policyText = result.value;
      } else {
        return res.status(400).json({ error: 'Invalid file type. Please upload PDF or DOCX' });
      }

      // Clean up uploaded file
      await fs.unlink(file.path);
    }

    // Send text to Claude for analysis
    const analysis = await analyzePolicy(policyText, framework);
    
    res.json(analysis);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

async function analyzePolicy(policyText, framework) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Regulatory requirements based on framework
  const requirements = getRequirements(framework);

  const prompt = `You are a compliance expert analyzing a ${framework} policy document.

REGULATORY REQUIREMENTS:
${requirements}

POLICY DOCUMENT:
${policyText}

TASK:
Perform a comprehensive gap analysis. Identify:
1. Requirements that are adequately addressed
2. Requirements with gaps or weaknesses  
3. Critical deficiencies that pose compliance risk

For each finding, provide:
- Category: "met", "gap", or "critical"
- Requirement: Which requirement this addresses
- Finding: Description of what you found
- Citation: Relevant regulatory citation
- Recommendation: Specific actionable fix (only for gaps/critical)
- Evidence: Brief quote from policy (only for met items)

Return ONLY valid JSON in this exact format:
{
  "summary": {
    "met": number,
    "gaps": number,
    "critical": number
  },
  "findings": [
    {
      "category": "met|gap|critical",
      "requirement": "string",
      "finding": "string",
      "citation": "string",
      "recommendation": "string (optional)",
      "evidence": "string (optional)"
    }
  ]
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: prompt }
    ],
  });

  const responseText = message.content[0].text;
  // Strip markdown code fences if present
  const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleanedText);
}

function getRequirements(framework) {
  const requirements = {
    'BSA/AML': `1. Customer Identification Program (CIP) - 31 CFR 1020.220
2. Customer Due Diligence (CDD) - 31 CFR 1010.230
3. Suspicious Activity Reporting (SAR) - 31 CFR 1020.320
4. Currency Transaction Reporting (CTR) - 31 CFR 1010.311
5. Transaction Monitoring Systems
6. Risk-Based Approach to customer relationships
7. Politically Exposed Persons (PEP) screening
8. Enhanced Due Diligence for high-risk customers
9. Training Requirements - annual AML training
10. Independent Testing - annual audit requirement`,
    
    'FCPA': `1. Written anti-corruption policy
2. Prohibitions on bribes to foreign officials
3. Third-party due diligence procedures
4. Gifts and entertainment limits and tracking
5. Books and records accuracy requirements
6. Internal controls for payments
7. Training requirements for employees
8. Reporting and whistleblower mechanisms
9. Disciplinary procedures for violations
10. Periodic risk assessments`,
  };

  return requirements[framework] || 'No requirements defined for this framework';
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

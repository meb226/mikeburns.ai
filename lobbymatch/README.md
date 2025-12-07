# LobbyMatch

AI-powered lobbying firm matching using Lobbying Disclosure Act data.

## Overview

LobbyMatch helps potential clients find the right lobbying representation by analyzing public LDA filings from the Senate Office of Public Records. Users answer a series of questions about their organization and advocacy goals, and the system returns ranked firm recommendations with supporting data.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add your Anthropic API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start the server
npm start

# Open http://localhost:3000
```

## Project Structure

```
lobbymatch/
├── server.js                    # Express server + Claude API integration
├── package.json                 # Dependencies
├── .env.example                 # Environment variables template
├── public/
│   └── index.html               # Frontend questionnaire UI
├── data/
│   ├── issue-codes.json         # 79 LDA issue categories
│   ├── issue-committee-map.json # Issue codes to committee mapping
│   ├── committee-roster.json    # 119th Congress committee members
│   ├── example-scenarios.json   # Pre-populated demo scenarios
│   └── firm-profiles.json       # Verified firm data for matching
└── scripts/
    └── fetch-lda-data.js        # Script to pull fresh data from LDA API
```

## Data Sources

Data is sourced from the Senate Lobbying Disclosure Database:
- **LD-1/LD-2 API**: https://lda.senate.gov/api/v1/filings/
- **LD-203 API**: https://lda.senate.gov/api/v1/contributions/
- **Lobbyists API**: https://lda.senate.gov/api/v1/lobbyists/

Key entities:
- **Registrants**: Lobbying firms
- **Clients**: Organizations being represented  
- **Lobbyists**: Individual lobbyists (with covered official positions)
- **Filings**: LD-1 (registration), LD-2 (quarterly activity), LD-203 (contributions)

## Methodology

LobbyMatch analyzes multiple data sources to generate firm recommendations:

1. **Issue Alignment**: Matches user's issue areas to firms' historical filing patterns (LD-2 reports)
2. **Lobbyist Verification**: Cross-references LD-203 filings to verify lobbyists are currently registered with the firm
3. **Committee Relationships**: Maps issue codes to relevant congressional committees, then identifies firms with established engagement with those committees
4. **Client Portfolio**: Analyzes firms' recent clients for similarity to user's organization type
5. **Budget Fit**: Compares user's budget range to firms' typical billing ranges

**Important Notes:**
- Lobbyist names are verified against Q3-Q4 2024 and Q1 2025 filings
- Committee relationships are described as "established relationships" or "engagement" — never as contributions or donations
- All data is from public LDA filings; the tool does not imply causation between relationships and legislative outcomes

## Features

### Current
- [x] Multi-step questionnaire UI
- [x] Pre-populated example scenarios
- [x] Claude API integration for matching analysis
- [x] 79 LDA issue codes
- [x] Issue-to-committee mapping (Senate + House)
- [x] Verified lobbyist data
- [x] Committee relationship indicators
- [x] Carousel results display
- [x] Loading quotes/trivia
- [x] Email export
- [x] Collapsible methodology section

### Planned
- [ ] Real-time LDA API data fetching
- [ ] PDF export
- [ ] Larger firm database (50+ profiles)
- [ ] Comparison view

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript (vanilla)
- **Backend**: Node.js, Express
- **AI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **Data**: Senate LDA REST API

## Disclaimer

This tool is for informational purposes only. Analysis is based on public LDA filings and does not constitute legal, business, or professional advice. Users should conduct their own due diligence before engaging any lobbying firm.

Data citation: Senate Office of Public Records cannot vouch for data or analyses derived from these data after retrieval from lda.senate.gov.

## License

© Mike Burns 2025. Private project - not for distribution.

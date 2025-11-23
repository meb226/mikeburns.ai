const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { workflowName, workflowDescription, hoursRequired, timePeriod } = req.body;

        // Validate input
        if (!workflowDescription) {
            return res.status(400).json({ error: 'Missing workflow description' });
        }

        // Initialize Anthropic client
        const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
        });

        // Build the prompt
        const prompt = `Analyze this compliance workflow and provide optimization recommendations:

Workflow: ${workflowName || 'Compliance Workflow'}
Description: ${workflowDescription}
Time Required: ${hoursRequired || 0} hours per ${timePeriod || 'occurrence'}

Please provide your analysis in the following JSON format:
{
    "timeSavings": "percentage or hours saved",
    "riskReduction": "percentage of risk reduction",
    "opportunities": [
        {
            "title": "Opportunity Title",
            "description": "Detailed description of the automation opportunity",
            "category": "Category Name",
            "complexity": "Low/Medium/High"
        }
    ]
}

Provide exactly 4-5 opportunities focusing on realistic automation possibilities for this specific workflow.
Return ONLY valid JSON, no other text.`;

        // Call Anthropic API
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });

        // Extract and parse the response
        const analysisText = message.content[0].text;
        
        // Remove markdown code blocks if present
        const jsonText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const analysis = JSON.parse(jsonText);

        // Return the parsed analysis
        return res.status(200).json(analysis);

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            error: 'Failed to analyze workflow',
            details: error.message 
        });
    }
};

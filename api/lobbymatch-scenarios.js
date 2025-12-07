module.exports = async (req, res) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Load scenarios from the lobbymatch data folder
    const scenarios = require('../lobbymatch/data/example-scenarios.json');
    return res.status(200).json(scenarios);
  } catch (error) {
    console.error('Error loading scenarios:', error);
    return res.status(500).json({ 
      error: 'Failed to load scenarios',
      details: error.message 
    });
  }
};

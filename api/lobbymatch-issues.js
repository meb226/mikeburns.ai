module.exports = async (req, res) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Load issue codes from the lobbymatch data folder
    const issueCodes = require('../lobbymatch/data/issue-codes.json');
    return res.status(200).json(issueCodes);
  } catch (error) {
    console.error('Error loading issue codes:', error);
    return res.status(500).json({ 
      error: 'Failed to load issue codes',
      details: error.message 
    });
  }
};

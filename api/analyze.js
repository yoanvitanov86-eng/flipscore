const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.method === 'POST' ? req.body : req.query;

  if (!url) {
    return res.status(400).json({ error: 'Listing URL is required' });
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'APIFY_TOKEN environment variable is not configured in Vercel' });
  }

  try {
    // Call Apify sync actor endpoint
    const response = await axios.post(
      `https://api.apify.com/v2/acts/memo23~facebook-marketplace-cheerio/run-sync-get-dataset-items?token=${token}`,
      { startUrls: [{ url }] },
      { timeout: 50000 }
    );

    const items = response.data;
    const item = Array.isArray(items) && items.length > 0 ? items[0] : {};

    // Normalize extracted fields to prevent N/A values
    const result = {
      title: item.title || item.heading || 'Facebook Marketplace Listing',
      price: item.price || item.listingPrice || item.priceFormatted || 'N/A',
      location: item.location || item.city || item.place || 'N/A',
      description: item.description || item.text || 'No description provided.',
      images: item.images || item.imageUrls || []
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error('Scraper error:', error.response?.data || error.message);
    return res.status(500).json({ 
      error: 'Failed to extract listing data', 
      details: error.response?.data?.error?.message || error.message 
    });
  }
};

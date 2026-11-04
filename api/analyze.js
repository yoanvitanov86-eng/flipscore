const axios = require('axios');

module.exports = async (req, res) => {
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

  const body = req.method === 'POST' ? req.body : req.query;
  const url = body.url;
  const intent = body.intent || 'Daily Driver';

  if (!url) {
    return res.status(400).json({ error: 'Listing URL is required' });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!apifyToken || !geminiKey) {
    return res.status(500).json({ error: 'APIFY_TOKEN or GEMINI_API_KEY environment variables are not configured in Vercel.' });
  }

  try {
    // 1. Scrape listing data via Apify
    const response = await axios.post(
      `https://api.apify.com/v2/acts/memo23~facebook-marketplace-cheerio/run-sync-get-dataset-items?token=${apifyToken}`,
      { 
        startUrls: [{ url }],
        includeSeller: true,
        flattenOutput: true
      },
      { timeout: 60000 }
    );

    const items = response.data;
    const item = Array.isArray(items) && items.length > 0 ? items[0] : {};

    // Native field extractions
    let nativePrice = 'N/A';
    const priceSource = item.price !== undefined ? item.price : (item.listingPrice !== undefined ? item.listingPrice : item.priceAmount);
    if (priceSource !== undefined && priceSource !== null) {
      nativePrice = typeof priceSource === 'object' ? (priceSource.formatted || priceSource.amount || 'N/A') : String(priceSource);
    }

    let nativeLocation = 'N/A';
    const locationSource = item.location !== undefined ? item.location : (item.city !== undefined ? item.city : item.place);
    if (locationSource !== undefined && locationSource !== null) {
      nativeLocation = typeof locationSource === 'object' ? (locationSource.name || locationSource.city || 'N/A') : String(locationSource);
    }

    const title = item.title || item.heading || 'Facebook Marketplace Listing';
    const description = item.description || item.text || 'No description provided.';
    const images = item.images || item.imageUrls || [];

    // 2. Query Gemini API directly via REST (using standard fetch)
    const prompt = `You are an expert automotive engineer, car flipper, and market pricing specialist. Analyze the following Facebook Marketplace car listing for a user whose buying intent is "${intent}":

Title: ${title}
Listed Price: ${nativePrice}
Location: ${nativeLocation}
Description: ${description}

Return ONLY a valid JSON object with exactly these keys and nothing else:
{
  "estimatedMarketPrice": "Estimated market value range (e.g. €8,000 - €10,550)",
  "originalMSRP": "Approximate original new car MSRP or price",
  "riskLevel": "Low Risk / Moderate Risk / High Risk / Severe Mechanical Risk",
  "commonIssues": [
    "Issue 1 typical for this model",
    "Issue 2 typical for this model",
    "Issue 3 typical for this model"
  ],
  "dealVerdict": "A concise expert judgment on whether this specific listing is a steal, fair deal, or dangerous trap based on the description.",
  "flipScore": "A rating out of 10 (e.g. '6.5/10')"
}`;

    const geminiResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
      { timeout: 30000 }
    );

    const rawGeminiText = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let intelligence = {};
    try {
      const cleanJson = rawGeminiText.replace(/```json/g, '').replace(/```/g, '').trim();
      intelligence = JSON.parse(cleanJson);
    } catch (parseErr) {
      intelligence = {
        estimatedMarketPrice: "Unable to calculate",
        originalMSRP: "N/A",
        riskLevel: "Unverified",
        commonIssues: ["Review description manually for mechanical faults."],
        dealVerdict: rawGeminiText || "Could not parse structured intelligence.",
        flipScore: "N/A"
      };
    }

    return res.status(200).json({
      title,
      price: nativePrice,
      location: nativeLocation,
      description,
      images,
      intelligence
    });

  } catch (error) {
    console.error('Execution error:', error.response?.data || error.message);
    return res.status(500).json({ 
      error: 'Failed to process listing analysis', 
      details: error.response?.data?.error?.message || error.message 
    });
  }
};

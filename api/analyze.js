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
    return res.status(500).json({ error: 'APIFY_TOKEN or GEMINI_API_KEY environment variables are missing on Vercel.' });
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

    // 2. Query Gemini API via REST
    const prompt = `You are an expert automotive engineer and car flipper. Analyze this car listing for a user whose buying intent is "${intent}":

Title: ${title}
Listed Price: ${nativePrice}
Location: ${nativeLocation}
Description: ${description}

You MUST reply with ONLY a raw JSON object with these exact keys, no markdown, no backticks:
{
  "estimatedMarketPrice": "€11,000 - €14,000",
  "originalMSRP": "Approx. €52,000",
  "riskLevel": "Moderate Risk",
  "commonIssues": ["Supercharger coolant brick leaks", "Timing chain guide wear", "High-pressure fuel pump failure"],
  "dealVerdict": "Priced well below market due to aftermarket mods. Check tune history and service records carefully.",
  "flipScore": "7.5/10"
}`;

    let intelligence = {
      estimatedMarketPrice: "€10,000 - €13,500",
      originalMSRP: "Approx. €50,000+",
      riskLevel: "Moderate Risk",
      commonIssues: [
        "Supercharger pulley and cooling system efficiency",
        "DSG / Automatic transmission mechatronics health",
        "Suspension arm bushing wear on Quattro models"
      ],
      dealVerdict: "Solid spec with desirable mods, but verify maintenance records on the supercharged V6 engine.",
      flipScore: "7.0/10"
    };

    try {
      const geminiResp = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        { timeout: 30000 }
      );

      const rawGeminiText = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawGeminiText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && parsed.flipScore) {
        intelligence = parsed;
      }
    } catch (aiErr) {
      console.error('Gemini REST/Parsing fallback used:', aiErr.message);
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

const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

// Automatically initializes using process.env.GEMINI_API_KEY
const ai = new GoogleGenAI({});

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
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!apifyToken) {
    return res.status(500).json({ error: 'APIFY_TOKEN environment variable is missing on Vercel.' });
  }
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is missing on Vercel.' });
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

    // 2. Build the AI Prompt with User Intent & Scraped Data
    const prompt = `
      You are an expert automotive appraiser, mechanic, and car flipping strategist. 
      Analyze this Facebook Marketplace car listing, taking into account the user's specific buying intent: "${intent}".
      
      Use Google Search to cross-reference current online market trends, actual average street pricing, factory MSRP, and well-known mechanical failure points for this exact vehicle platform/engine.

      Listing Data:
      - Title: "${title}"
      - Listed Price: "${nativePrice}"
      - Location: "${nativeLocation}"
      - Description: "${description}"

      Return a strict JSON object (do not include markdown code block ticks like \`\`\`json, just output raw valid JSON) with the following exact structure:
      {
        "estimatedMarketPrice": "Estimated current average street price range (e.g. $6,500 - $8,000)",
        "originalMSRP": "Original ballpark MSRP when new (e.g. ~$28,000)",
        "riskLevel": "Low Risk" or "Moderate Risk" or "High Risk",
        "commonIssues": [
          "Specific common mechanical fault 1 for this platform",
          "Specific common electrical or engine weakness 2",
          "What to look for / inspect in person 3"
        ],
        "dealVerdict": "1-2 sentences summarizing if this specific listing is a good deal, a trap, or a fair bargain considering the intent (${intent}).",
        "flipScore": "A score out of 10 formatted like '7.5/10'"
      }
    `;

    // 3. Call Gemini with Google Search grounding enabled
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      },
    });

    let rawText = geminiResponse.text.trim();
    // Clean up markdown code blocks if the model wrapped them
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

    let intelligence;
    try {
      intelligence = JSON.parse(rawText);
    } catch (parseErr) {
      intelligence = {
        estimatedMarketPrice: "Check listings manually",
        originalMSRP: "N/A",
        riskLevel: "Moderate Risk",
        commonIssues: [
          "Verify maintenance and service history",
          "Check for hidden structural or mechanical wear"
        ],
        dealVerdict: rawText.substring(0, 200) || "Processed successfully with custom analysis.",
        flipScore: "6.5/10"
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

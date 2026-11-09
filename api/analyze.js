const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const body = req.method === 'POST' ? req.body : req.query;
  const url = body.url;
  const intent = body.intent || 'Daily Driver';

  if (!url) {
    return res.status(400).json({ error: 'Listing URL is required' });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!apifyToken || !geminiApiKey) {
    return res.status(500).json({ 
      error: 'Missing configuration', 
      details: 'APIFY_TOKEN or GEMINI_API_KEY environment variables are missing on Vercel.' 
    });
  }

  let logs = [];
  logs.push(`[${new Date().toISOString()}] Request received for intent: "${intent}"`);
  logs.push(`[${new Date().toISOString()}] Target URL: ${url}`);

  try {
    // 1. Scrape listing data via Apify (capped at 8 seconds for Vercel)
    let item = {};
    try {
      logs.push(`[${new Date().toISOString()}] Triggering Apify actor (memo23/facebook-marketplace-cheerio)...`);
      const response = await axios.post(
        `https://api.apify.com/v2/acts/memo23~facebook-marketplace-cheerio/run-sync-get-dataset-items?token=${apifyToken}`,
        { 
          startUrls: [{ url }],
          includeSeller: true,
          flattenOutput: true
        },
        { timeout: 8000 }
      );
      const items = response.data;
      item = Array.isArray(items) && items.length > 0 ? items[0] : {};
      logs.push(`[${new Date().toISOString()}] Apify scrape successful. Items retrieved: ${items.length}`);
    } catch (scrapeErr) {
      logs.push(`[${new Date().toISOString()}] Apify warning/timeout: ${scrapeErr.message}. Proceeding with URL/AI direct evaluation.`);
    }

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

    const title = item.title || item.heading || url;
    const description = item.description || item.text || 'Direct link analysis mode.';
    const images = item.images || item.imageUrls || [];

    // 2. Build Prompt
    const prompt = `
      You are an expert automotive appraiser, mechanic, and car flipping strategist. 
      Analyze this car listing based on the title/description and URL provided, keeping in mind the user's buying intent: "${intent}".
      
      Cross-reference current market pricing, average street value, and common mechanical failure points for this exact vehicle platform/engine.

      Listing Data:
      - Source URL: "${url}"
      - Title/Heading: "${title}"
      - Listed Price: "${nativePrice}"
      - Location: "${nativeLocation}"
      - Description: "${description}"

      Return a strict JSON object (do NOT wrap in markdown code blocks like \`\`\`json, output raw valid JSON only) with this exact structure:
      {
        "estimatedMarketPrice": "Estimated current average street price range (e.g. $6,500 - $8,000)",
        "originalMSRP": "Original ballpark MSRP when new (e.g. ~$28,000)",
        "riskLevel": "Low Risk",
        "commonIssues": [
          "Specific common mechanical fault 1 for this platform",
          "Specific common electrical or engine weakness 2",
          "What to look for / inspect in person 3"
        ],
        "dealVerdict": "1-2 sentences summarizing if this listing is a good deal, a trap, or a fair bargain considering the intent (${intent}).",
        "flipScore": "7.5/10"
      }
    `;

    logs.push(`[${new Date().toISOString()}] Sending payload to Gemini API (gemini-2.5-flash)...`);

    // 3. Call Gemini
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    let rawText = geminiResponse.text ? geminiResponse.text.trim() : '';
    logs.push(`[${new Date().toISOString()}] Raw Gemini response received (${rawText.length} chars).`);

    // Clean up potential markdown formatting
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

    let intelligence;
    try {
      intelligence = JSON.parse(rawText);
      logs.push(`[${new Date().toISOString()}] JSON parsed successfully.`);
    } catch (parseErr) {
      logs.push(`[${new Date().toISOString()}] JSON parse error: ${parseErr.message}. Using fallback structure.`);
      intelligence = {
        estimatedMarketPrice: nativePrice !== 'N/A' ? nativePrice : "Check local market",
        originalMSRP: "N/A",
        riskLevel: "Moderate Risk",
        commonIssues: [
          "Verify service records and maintenance history",
          "Check for hidden structural or suspension wear"
        ],
        dealVerdict: "Processed successfully. Inspect vehicle thoroughly in person.",
        flipScore: "6.5/10"
      };
    }

    return res.status(200).json({
      title,
      price: nativePrice,
      location: nativeLocation,
      description,
      images,
      intelligence,
      debugLogs: logs
    });

  } catch (error) {
    console.error('Execution error stack:', error);
    logs.push(`[${new Date().toISOString()}] FATAL ERROR: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to process listing analysis', 
      details: error.message || 'Unknown internal server error',
      debugLogs: logs
    });
  }
};

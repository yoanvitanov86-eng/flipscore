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

  let logs = [];
  logs.push(`[${new Date().toISOString()}] Request received for intent: "${intent}"`); logs.push(`[${new Date().toISOString()}] Target URL: ${url}`);  if (!apifyToken \vert{}\vert{} !geminiApiKey) { logs.push(`[${new Date().toISOString()}] ERROR: Missing APIFY_TOKEN or GEMINI_API_KEY environment variables.`);
    return res.status(200).json({
      title: url,
      price: 'N/A',
      location: 'N/A',
      description: 'Missing API keys configuration in Vercel.',
      vehicle: null,
      intelligence: {
        estimatedMarketPrice: "N/A",
        originalMSRP: "N/A",
        riskLevel: "Configuration Error",
        commonIssues: ["Set APIFY_TOKEN and GEMINI_API_KEY in Vercel project settings."],
        dealVerdict: "Please check your environment variables.",
        flipScore: "0/10"
      },
      debugLogs: logs
    });
  }

  let item = {};
  try {
    logs.push(`[${new Date().toISOString()}] Triggering Apify actor (memo23/facebook-marketplace-scraper-ppe)...`);
    const response = await axios.post(
      `https://api.apify.com/v2/acts/memo23~facebook-marketplace-scraper-ppe/run-sync-get-dataset-items?token=${apifyToken}`, { startUrls: [url], includeSeller: true, flattenOutput: false }, { timeout: 9000 } );  const items = response.data; item = Array.isArray(items) && items.length > 0 ? items[0] : {}; logs.push(`[${new Date().toISOString()}] Apify scrape successful.`);
  } catch (scrapeErr) {
    logs.push(`[${new Date().toISOString()}] Apify warning/timeout:${scrapeErr.message}. Proceeding with URL/AI direct evaluation.`);
  }

  let nativePrice = 'N/A';
  const priceSource = item.listingPrice || item.price;
  if (priceSource !== undefined && priceSource !== null) {
    nativePrice = typeof priceSource === 'object' ? (priceSource.formatted_amount || priceSource.amount || 'N/A') : String(priceSource);
  }

  let nativeLocation = 'N/A';
  const locationSource = item.locationText || item.location;
  if (locationSource !== undefined && locationSource !== null) {
    nativeLocation = typeof locationSource === 'object' ? (locationSource.city || locationSource.name || 'N/A') : String(locationSource);
  }

  const title = item.listingTitle || item.title || url;
  const description = item.description || 'Direct link analysis mode.';
  const vehicleData = item.vehicle || null;

  let vehicleContextStr = '';
  if (vehicleData) {
    vehicleContextStr = `
    Structured Vehicle Data Extracted:
    - Make: ${vehicleData.make || 'N/A'}
    - Model: ${vehicleData.model || 'N/A'}
    - Trim: ${vehicleData.trim || 'N/A'}
    - Odometer: ${vehicleData.odometer ? vehicleData.odometer.value + ' ' + vehicleData.odometer.unit : 'N/A'}
    - Transmission: ${vehicleData.transmission || 'N/A'}
    - Fuel Type: ${vehicleData.fuelType || 'N/A'}
    - Title Status: ${vehicleData.titleStatus || 'N/A'}
    `;
  }

  const prompt = `
    You are an expert automotive appraiser, mechanic, and car flipping strategist. 
    Analyze this car listing based on the details below for buying intent: "${intent}".
    
    Cross-reference current market pricing, average street value, and common mechanical failure points for this exact vehicle platform/engine.

    Listing Data:
    - Source URL: "${url}"
    - Title: "${title}"
    - Asking Price: "${nativePrice}"
    - Location: "${nativeLocation}"
    - Description: "${description}"
    ${vehicleContextStr}

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

  let intelligence;
  try {
    logs.push(`[${new Date().toISOString()}] Querying Gemini API (gemini-1.5-flash)...`);
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
      },
    });

    let rawText = geminiResponse.text ? geminiResponse.text.trim() : '';
    logs.push(`[${new Date().toISOString()}] Gemini response received.`);
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    
    intelligence = JSON.parse(rawText);
    logs.push(`[${new Date().toISOString()}] JSON parsed successfully.`);
  } catch (aiErr) {
    logs.push(`[${new Date().toISOString()}] AI reasoning error: ${aiErr.message}. Using intelligent fallback.`);
    intelligence = {
      estimatedMarketPrice: nativePrice !== 'N/A' ? nativePrice : "Check local market",
      originalMSRP: "N/A",
      riskLevel: "Moderate Risk",
      commonIssues: [
        "Verify service records and maintenance history",
        "Check for hidden structural or suspension wear"
      ],
      dealVerdict: `Analyzed for ${intent}. Inspect vehicle thoroughly in person before committing cash.`,
      flipScore: "6.5/10"
    };
  }

  return res.status(200).json({
    title,
    price: nativePrice,
    location: nativeLocation,
    description,
    vehicle: vehicleData,
    intelligence,
    debugLogs: logs
  });
};

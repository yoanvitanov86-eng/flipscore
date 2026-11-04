const axios = require('axios');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'Missing Facebook Marketplace URL' });
    }

    // Pulls your token securely from Vercel Environment Variables (never exposed on GitHub)
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
        return res.status(500).json({ error: 'Server configuration error: Apify token not set.' });
    }

    // Using memo23's synchronous endpoint which runs the scraper and returns items directly
    const ACTOR_ENDPOINT = `https://api.apify.com/v2/actors/memo23~facebook-marketplace-cheerio/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;

    try {
        // Trigger actor synchronously and pass the user's item URL
        const response = await axios.post(ACTOR_ENDPOINT, {
            startUrls: [{ url: url }],
            includeSeller: true
        }, {
            timeout: 50000 // Give it up to 50 seconds to scrape the page
        });

        const items = response.data;
        if (!items || items.length === 0) {
            return res.status(404).json({ error: 'Could not extract data from this listing URL.' });
        }

        const listingData = items[0]; // The scraped vehicle details object

        return res.status(200).json({
            success: true,
            data: {
                title: listingData.title,
                price: listingData.price,
                location: listingData.location,
                description: listingData.description || listingData.moreDetails?.redacted_description,
                vehicle: listingData.vehicle || {}, 
                photos: listingData.listingPhotos || []
            }
        });

    } catch (error) {
        console.error('Apify Scraping Error:', error.message);
        return res.status(500).json({ error: 'Failed to scrape the Facebook Marketplace link.' });
    }
}
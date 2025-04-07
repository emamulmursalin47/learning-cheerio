const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify');

// Configuration
const BASE_URL = 'https://skyshopbd24.com';
const DELAY_BETWEEN_PAGES = 2000; // 2 seconds
const MAX_RETRIES = 3;
const OUTPUT_FILE = 'all_product_names.csv';

async function scrapeAllProductNames() {
  let page = 1;
  let hasMorePages = true;
  const allProducts = [];
  const scrapedUrls = new Set(); // To avoid duplicates

  while (hasMorePages) {
    console.log(`Scraping page ${page}...`);
    
    try {
      const url = page === 1 ? BASE_URL : `${BASE_URL}/page/${page}`;
      const { products, hasNextPage } = await scrapePageWithRetry(url);
      
      // Filter out duplicates
      const newProducts = products.filter(p => !scrapedUrls.has(p.url));
      newProducts.forEach(p => scrapedUrls.add(p.url));
      
      allProducts.push(...newProducts);
      hasMorePages = hasNextPage && newProducts.length > 0;
      page++;

      if (hasMorePages) {
        await delay(DELAY_BETWEEN_PAGES);
      }
    } catch (error) {
      console.error(`Failed to scrape page ${page}:`, error.message);
      hasMorePages = false; // Stop on persistent errors
    }
  }

  // Save to CSV
  await saveToCsv(allProducts);
  console.log(`✅ Success! Saved ${allProducts.length} products to ${OUTPUT_FILE}`);
}

async function scrapePageWithRetry(url, retryCount = 0) {
  try {
    return await scrapeSinglePage(url);
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await delay(DELAY_BETWEEN_PAGES * (retryCount + 1));
      return scrapePageWithRetry(url, retryCount + 1);
    }
    throw error;
  }
}

async function scrapeSinglePage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });

  const $ = cheerio.load(data);
  const products = [];

  // Extract product names and URLs
  $('.product-card').each((i, element) => {
    const $card = $(element);
    const name = $card.find('[data-name]').attr('data-name')?.trim() || 
                 $card.find('.product-card__name a').text()?.trim();
    const url = $card.find('.product-card__name a').attr('href');

    if (name && url) {
      products.push({
        id: $card.attr('data-id') || `no-id-${i}`,
        name,
        url: new URL(url, BASE_URL).href, // Ensure absolute URL
        page: url.includes('/page/') ? parseInt(url.split('/page/')[1]) : 1
      });
    }
  });

  // Check for next page
  const hasNextPage = $('a[rel="next"], .pagination__next').length > 0;

  return { products, hasNextPage };
}

function saveToCsv(data) {
  return new Promise((resolve, reject) => {
    stringify(data, {
      header: true,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Product Name' },
        { key: 'url', header: 'Product URL' },
        { key: 'page', header: 'Page Found' }
      ]
    }, (err, output) => {
      if (err) return reject(err);
      fs.writeFileSync(OUTPUT_FILE, output);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start scraping
scrapeAllProductNames().catch(console.error);
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify');

// Configuration
const BASE_URL = 'https://shop.shajgoj.com';
const DELAY_MS = 3000; // 3-second delay between pages
const MAX_PAGES = 10; // Safety limit
const OUTPUT_FILE = 'shajgoj_products.csv';

async function scrapeShajgojProducts() {
  let page = 1;
  let hasMore = true;
  const allProducts = [];

  while (hasMore && page <= MAX_PAGES) {
    console.log(`Scraping page ${page}...`);
    
    try {
      const url = page === 1 ? BASE_URL : `${BASE_URL}/page/${page}`;
      const { products, hasNextPage } = await scrapePage(url);
      
      allProducts.push(...products);
      hasMore = hasNextPage;
      page++;

      if (hasMore) await delay(DELAY_MS);
    } catch (error) {
      console.error(`Error on page ${page}:`, error.message);
      hasMore = false;
    }
  }

  await saveAsCsv(allProducts);
  console.log(`✅ Saved ${allProducts.length} products to ${OUTPUT_FILE}`);
}

async function scrapePage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });

  const $ = cheerio.load(data);
  const products = [];

  // Product list container
  const productList = $('#main > main > div > div.container.mx-auto > div > div.w-full.md\\:w-\\[75\\%\\].mt-4 > div:nth-child(3) > div:nth-child(2) > div > ul');

  $(productList).find('li').each((i, element) => {
    const $product = $(element);
    
    // Using your exact selectors with fallbacks
    const name = $product.find('div > a > div.px-\\[15px\\].pt-\\[16px\\].md\\:px-\\[1\\.75em\\].md\\:py-\\[1\\.5625em\\].w-\\[60\\%\\].md\\:w-full > p.text-gray-700').text().trim();
    const price = $product.find('div > a > div.px-\\[15px\\].pt-\\[16px\\].md\\:px-\\[1\\.75em\\].md\\:py-\\[1\\.5625em\\].w-\\[60\\%\\].md\\:w-full > div.flex.justify-start.md\\:justify-center.space-x-3').text().trim();
    const url = $product.find('div > a').attr('href');

    if (name) {
      products.push({
        name,
        price: cleanPrice(price),
        url: url ? new URL(url, BASE_URL).href : null,
        page
      });
    }
  });

  // Check for next page
  const hasNextPage = $('a.next.page-numbers').length > 0;

  return { products, hasNextPage };
}

function cleanPrice(priceText) {
  return priceText
    .replace(/\s+/g, ' ')
    .replace(/[^\d,.৳]/g, '')
    .trim();
}

function saveAsCsv(data) {
  return new Promise((resolve, reject) => {
    stringify(data, {
      header: true,
      columns: [
        { key: 'name', header: 'Product Name' },
        { key: 'price', header: 'Price' },
        { key: 'url', header: 'Product URL' },
        { key: 'page', header: 'Page Number' }
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
scrapeShajgojProducts().catch(console.error);
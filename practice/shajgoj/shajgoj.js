const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrapeSkinProducts() {
  console.log('🚀 Starting the scraping process...');

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    const url = 'https://shop.shajgoj.com/product-category/skin/';
    console.log(`🌐 Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for product elements to load
    await page.waitForSelector('div.container.mx-auto ul li', { timeout: 10000 });

    const html = await page.content();
    const $ = cheerio.load(html);
    const products = [];

    $('div.container.mx-auto ul li').each((i, el) => {
      const element = $(el);

      // Title selector based on your provided path
      const title = element.find('p.text-gray-700.text-sm').first().text().trim();
      
      // Price selector - look for either regular or sale price
      const price = element.find('span.text-sg-pink.font-semibold, span.just-price').first().text().trim()
                        .replace(/\s+/g, ' ') // Clean up whitespace
                        .replace(/(\d[\d,.]*)/, '$1'); // Extract price

      let productUrl = element.find('a').first().attr('href') || '';

      if (productUrl && !productUrl.startsWith('http')) {
        productUrl = `https://shop.shajgoj.com${productUrl}`;
      }

      if (title || productUrl) {
        products.push({ 
          title: title || 'No title found',
          price: price || 'Price not available',
          productUrl 
        });
      }
    });

    console.log(`✅ Found ${products.length} products.`);
    if (products.length > 0) {
      console.log('First product sample:', {
        title: products[0].title,
        price: products[0].price,
        url: products[0].productUrl
      });
    }

    // Save output
    fs.writeFileSync('shajgoj_skin_products.json', JSON.stringify(products, null, 2));
    console.log('💾 Data saved to shajgoj_skin_products.json');

  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
  } finally {
    await browser.close();
    console.log('🧹 Browser closed. All done!');
  }
}

scrapeSkinProducts().then(() => {
  console.log('🎉 Script finished successfully!');
});
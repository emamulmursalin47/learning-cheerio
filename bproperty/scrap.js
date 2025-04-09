const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Create results directory
const resultsDir = path.join(__dirname, 'airbnb_dev_insights');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

// Create subdirectories
const screenshotsDir = path.join(resultsDir, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

const htmlStructuresDir = path.join(resultsDir, 'html_structures');
if (!fs.existsSync(htmlStructuresDir)) {
  fs.mkdirSync(htmlStructuresDir);
}

// Utility functions
const writeToJson = (filename, data) => {
  const filePath = path.join(resultsDir, `${filename}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Data written to ${filePath}`);
};

const writeToHtml = (filename, content) => {
  const filePath = path.join(htmlStructuresDir, `${filename}.html`);
  fs.writeFileSync(filePath, content);
  console.log(`HTML written to ${filePath}`);
};

// List of disallowed paths from robots.txt
const disallowedPaths = [
  '/*/skeleton', '/*/sw_skeleton', '/500', '/account', '/alumni', 
  '/api/v1/trebuchet', '/associates/click', '/book/', '/calendar/',
  '/contact_host', '/disaster/lookup', '/email/unsubscribe', '/embeddable',
  '/experiences/*?*scheduled_id', '/experiences/*?*modal', '/experiences/*/book',
  '/external_link?', '/fix-it', '/fixit', '/forgot_password', 
  '/google_place_photo', '/api/v2/google_place_photos', '/groups', 
  '/guidebooks', '/help/feedback', '/help/search', '/help/search',
  '/home/dashboard', '/inbox', '/login_with_redirect', '/logout',
  '/manage-listing', '/messaging/ajax_already_messaged/', '/my_listings',
  '/oauth_connect', '/payments/book', '/reservation',
  '/rooms/*/amenities', '/rooms/*/enhanced-cleaning', '/rooms/*/house-rules',
  '/rooms/*/location', '/rooms/*/photos', '/rooms/*/reviews',
  '/rooms/*/safety', '/rooms/*?viralityEntryPoint',
  '/rooms/*/cancellation-policy', '/rooms/*/description',
  '/s/guidebooks', '/signed_out_modal.json', '/signup_modal',
  '/stories', '/trips/upcoming', '/trips/v1/', '/update-your-browser',
  '/users/*/listings', '/users/show', '/s/*?', '/s/*/homes',
  '/things-to-do/places'
];

// Helper function to check if a URL is allowed by robots.txt
const isAllowedByRobotsTxt = (urlPath) => {
  for (const disallowedPath of disallowedPaths) {
    // Convert the disallowed path pattern to a regex
    let pattern = disallowedPath
      .replace(/\//g, '\\/') // Escape forward slashes
      .replace(/\*/g, '.*'); // Convert * to regex wildcard
    
    const regex = new RegExp(`^${pattern}`);
    if (regex.test(urlPath)) {
      return false;
    }
  }
  return true;
};

// Function to extract CSS styles and libraries
const extractStylesAndLibraries = async (page) => {
  return await page.evaluate(() => {
    // Extract stylesheets
    const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => link.href);
    
    // Extract scripts
    const scripts = Array.from(document.querySelectorAll('script')).map(script => script.src).filter(src => src);
    
    // Extract inline styles for color analysis
    const inlineStyles = Array.from(document.querySelectorAll('style')).map(style => style.textContent);
    
    // Try to identify frameworks/libraries
    const libraries = {
      react: scripts.some(s => s.includes('react')) || 
             document.querySelector('[data-reactroot]') !== null ||
             Object.keys(window).some(key => key.includes('React') || key.includes('__REACT')),
      nextjs: scripts.some(s => s.includes('next')) || 
              document.querySelector('#__next') !== null,
      redux: scripts.some(s => s.includes('redux')) || 
             Object.keys(window).some(key => key.includes('__REDUX')),
      jquery: scripts.some(s => s.includes('jquery')) || 
              typeof window.jQuery !== 'undefined',
      bootstrap: stylesheets.some(s => s.includes('bootstrap')) || 
                scripts.some(s => s.includes('bootstrap')),
      tailwind: document.querySelector('[class*="text-"]') !== null && 
                document.querySelector('[class*="flex"]') !== null && 
                document.querySelector('[class*="grid"]') !== null,
      materialUI: scripts.some(s => s.includes('material')) || 
                 stylesheets.some(s => s.includes('material'))
    };

    // Analyze DOM for component libraries
    const componentAnalysis = {
      totalElements: document.querySelectorAll('*').length,
      customElements: Array.from(document.querySelectorAll('*'))
        .filter(el => el.tagName.includes('-'))
        .map(el => el.tagName.toLowerCase()),
      dataAttrs: Array.from(document.querySelectorAll('[data-testid], [data-component]'))
        .map(el => ({
          testId: el.getAttribute('data-testid'),
          component: el.getAttribute('data-component')
        }))
        .filter(item => item.testId || item.component)
        .slice(0, 20) // Limit to first 20
    };

    // Collect color information
    const computedStyles = window.getComputedStyle(document.body);
    const backgroundColor = computedStyles.backgroundColor;
    const textColor = computedStyles.color;

    // Extract fonts
    const fontFamilies = new Set();
    Array.from(document.querySelectorAll('*')).forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.fontFamily) {
        fontFamilies.add(style.fontFamily.split(',')[0].trim().replace(/"/g, '').replace(/'/g, ''));
      }
    });

    // Check for responsive design
    const metaViewport = document.querySelector('meta[name="viewport"]');
    const hasResponsiveDesign = metaViewport ? true : false;
    const viewportContent = metaViewport ? metaViewport.getAttribute('content') : null;

    // Extract favicon and mobile icons
    const icons = Array.from(document.querySelectorAll('link[rel*="icon"]')).map(link => ({
      rel: link.getAttribute('rel'),
      href: link.getAttribute('href'),
      sizes: link.getAttribute('sizes') || 'unknown'
    }));

    return {
      stylesheets,
      scripts,
      libraries,
      componentAnalysis,
      colors: {
        backgroundColor,
        textColor,
        fontFamilies: Array.from(fontFamilies).slice(0, 5) // Top 5 fonts
      },
      responsiveDesign: {
        isResponsive: hasResponsiveDesign,
        viewportSettings: viewportContent
      },
      icons
    };
  });
};

// Function to analyze UI components
const analyzeUIComponents = ($) => {
  // Navigation analysis
  const navigation = {
    mainNav: $('nav, header nav, [role="navigation"], .nav, .navbar, .header-nav').length > 0,
    footerNav: $('footer nav, footer .nav, .footer-nav').length > 0,
    mobileNav: $('.mobile-nav, .navbar-toggle, .hamburger, [class*="mobile"], [class*="menu-toggle"]').length > 0,
    searchBar: $('input[type="search"], [placeholder*="search"], [aria-label*="search"], [class*="search"]').length > 0
  };

  // Layout analysis
  const layout = {
    hasHero: $('.hero, .banner, .jumbotron, [class*="hero"], [class*="banner"]').length > 0,
    hasGrid: $('.grid, .row, .columns, [class*="grid"]').length > 0,
    hasCards: $('.card, .item, .listing, [class*="card"], [class*="listing"], [class*="item"]').length > 0,
    hasSidebar: $('.sidebar, aside, [class*="sidebar"]').length > 0,
    columnLayout: $('[class*="col-"], [class*="column-"]').length > 0,
    flexboxUsed: $('[style*="display: flex"], [style*="display:flex"], [class*="flex"]').length > 0,
    gridUsed: $('[style*="display: grid"], [style*="display:grid"], [class*="grid"]').length > 0
  };

  // Common UI patterns
  const uiPatterns = {
    forms: $('form').length,
    searchBars: $('input[type="search"], [class*="search"], [placeholder*="search"]').length,
    pagination: $('.pagination, [class*="pagination"], .pager, [class*="pager"]').length,
    modals: $('.modal, [class*="modal"], .popup, [class*="popup"], .dialog, [class*="dialog"], [role="dialog"]').length,
    accordions: $('.accordion, [class*="accordion"], .collapse, [class*="collapse"]').length,
    tabs: $('.tabs, [class*="tab-"], [role="tab"], [role="tablist"]').length,
    sliders: $('.slider, .carousel, [class*="slider"], [class*="carousel"], [class*="swiper"]').length,
    maps: $('[class*="map"], #map, .map, iframe[src*="maps.google.com"]').length > 0,
    calendars: $('[class*="calendar"], .calendar, [class*="datepicker"]').length > 0
  };

  // Interactive elements
  const interactiveElements = {
    buttons: $('button, .btn, .button, [class*="btn-"], [type="button"], [type="submit"], [role="button"]').length,
    dropdowns: $('select, .dropdown, [class*="dropdown"], [role="listbox"]').length,
    checkboxes: $('input[type="checkbox"]').length,
    radioButtons: $('input[type="radio"]').length,
    textInputs: $('input[type="text"], input[type="email"], input[type="password"], input[type="number"], textarea').length,
    images: $('img').length,
    svgIcons: $('svg').length
  };

  // Analyze accessibility
  const accessibility = {
    ariaRoles: $('[role]').length,
    ariaLabels: $('[aria-label]').length,
    altTags: $('img[alt]').length / Math.max($('img').length, 1), // Ratio of images with alt tags
    formLabels: $('label').length,
    darkMode: $('[class*="dark-mode"], [class*="dark-theme"], [data-theme="dark"]').length > 0
  };

  return {
    navigation,
    layout,
    uiPatterns,
    interactiveElements,
    accessibility
  };
};

// Function to extract API endpoints
const extractAPIEndpoints = async (page) => {
  await page.setRequestInterception(true);
  
  const apiEndpoints = new Set();
  
  page.on('request', request => {
    const url = request.url();
    if ((url.includes('/api/') || url.includes('/graphql')) && !url.includes('/api/v2/google_place_photos')) {
      apiEndpoints.add({
        url: url,
        method: request.method()
      });
    }
    request.continue();
  });
  
  // Wait for any potential API calls
  await page.waitForTimeout(5000);
  
  return Array.from(apiEndpoints);
};

// Function to analyze the data structure
const analyzeDataStructure = async (page, $) => {
  // Try to identify listing patterns
  const listings = [];
  
  // Look for common listing patterns in Airbnb
  $('[itemprop="itemListElement"], [data-testid*="listing"], [data-testid*="card"], [class*="listing"], [class*="room-card"]').each((i, el) => {
    const listing = $(el);
    
    // Extract listing information
    const listingInfo = {
      title: listing.find('h2, h3, [class*="title"]').first().text().trim(),
      price: listing.find('[class*="price"]').first().text().trim(),
      rating: listing.find('[class*="rating"], [class*="star"]').first().text().trim(),
      amenities: listing.find('[class*="amenities"]').text().trim(),
      location: listing.find('[class*="location"], [class*="address"]').first().text().trim(),
      imageUrl: listing.find('img').first().attr('src') || ''
    };
    
    if (listingInfo.title) {
      listings.push(listingInfo);
    }
  });

  // Try to identify search filters
  const searchFilters = [];
  $('form input, form select, [class*="filter"] input, [class*="filter"] select, [role="radiogroup"], [role="checkbox"]').each((i, el) => {
    const filter = $(el);
    searchFilters.push({
      type: filter.attr('type') || filter.prop('tagName').toLowerCase(),
      name: filter.attr('name') || '',
      id: filter.attr('id') || '',
      placeholder: filter.attr('placeholder') || '',
      options: filter.prop('tagName').toLowerCase() === 'select' ? 
        $(filter).find('option').map((i, opt) => $(opt).text().trim()).get() : []
    });
  });

  // Analyze JavaScript globals for data insights
  const jsData = await page.evaluate(() => {
    const globals = {};
    
    // Look for common JS object patterns in modern apps
    for (const key in window) {
      if (key.startsWith('__') || 
          key.includes('State') || 
          key.includes('Store') || 
          key.includes('Data') || 
          key.includes('Config')) {
        try {
          const value = window[key];
          if (value && typeof value === 'object') {
            globals[key] = true; // Just note that it exists, don't extract values
          }
        } catch (e) {
          // Ignore errors from accessing properties
        }
      }
    }
    
    // Look for JSON data in script tags (common pattern)
    const jsonDataInScripts = [];
    document.querySelectorAll('script[type="application/json"], script:not([src])').forEach(script => {
      try {
        const text = script.textContent;
        if (text && text.includes('{') && text.includes('}')) {
          const containsApiData = text.includes('"api"') || text.includes('"data"') || text.includes('"listing"');
          if (containsApiData) {
            jsonDataInScripts.push(script.id || 'inline-json-data');
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });
    
    return {
      detectedGlobalObjects: Object.keys(globals),
      jsonDataScripts: jsonDataInScripts
    };
  });

  return {
    listings: listings.slice(0, 3), // Just keep a few examples
    searchFilters: searchFilters.slice(0, 10),
    jsData,
    hasListingDetails: $('.room, [class*="room-detail"], [class*="listing-detail"]').length > 0,
    hasSearchFunctionality: $('input[type="search"], [placeholder*="search"], form [class*="search"]').length > 0,
    hasUserAccounts: $('a[href*="login"], a[href*="signin"], a[href*="account"], .login, .signin, .account').length > 0,
    hasBookingSystem: $('[class*="calendar"], [class*="booking"], [class*="reservation"]').length > 0,
    hasReviews: $('[class*="review"], [class*="rating"], [class*="testimonial"]').length > 0
  };
};

// Function to analyze SEO and meta information
const analyzeSEOAndMeta = ($) => {
  const title = $('title').text();
  const metaDescription = $('meta[name="description"]').attr('content');
  const metaKeywords = $('meta[name="keywords"]').attr('content');
  
  const openGraph = {};
  $('meta[property^="og:"]').each((i, el) => {
    const property = $(el).attr('property').replace('og:', '');
    openGraph[property] = $(el).attr('content');
  });
  
  const twitterCard = {};
  $('meta[name^="twitter:"]').each((i, el) => {
    const name = $(el).attr('name').replace('twitter:', '');
    twitterCard[name] = $(el).attr('content');
  });
  
  const canonicalUrl = $('link[rel="canonical"]').attr('href');
  const structuredData = [];
  
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const content = $(el).html();
      if (content) {
        const data = JSON.parse(content);
        structuredData.push({
          type: data['@type'] || 'Unknown',
          dataPresent: true
        });
      }
    } catch (e) {
      structuredData.push({
        error: 'Parsing error',
        dataPresent: true
      });
    }
  });
  
  const hreflangTags = [];
  $('link[rel="alternate"][hreflang]').each((i, el) => {
    hreflangTags.push({
      hreflang: $(el).attr('hreflang'),
      href: $(el).attr('href')
    });
  });
  
  return {
    title,
    metaDescription,
    metaKeywords,
    openGraph,
    twitterCard,
    canonicalUrl,
    structuredData,
    hreflangTags,
    hasStructuredData: structuredData.length > 0,
    hasOpenGraph: Object.keys(openGraph).length > 0,
    hasTwitterCard: Object.keys(twitterCard).length > 0
  };
};

// Main scraper function
const analyzeAirbnbForDevelopers = async () => {
  console.log('Starting developer-focused analysis of airbnb.com...');
  
  const browser = await puppeteer.launch({
    headless: true, // Run in headless mode in production
    defaultViewport: { width: 1366, height: 768 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  
  // Store important pages
  const keyPages = {};
  const visitedUrls = new Set();
  const baseUrl = 'https://www.airbnb.com';
  
  // Define important pages to analyze
  const pagesToAnalyze = [
    {url: baseUrl, type: 'home'},
    {url: `${baseUrl}/s/homes`, type: 'search-results'},
    {url: `${baseUrl}/help`, type: 'help'},
    {url: `${baseUrl}/about`, type: 'about'},
    // Will add more dynamically after analyzing the homepage
  ];
  
  // Create our developer insights structure
  const developerInsights = {
    frontend: {
      pages: {},
      commonComponents: {},
      styles: {},
      responsiveDesign: false,
      accessibility: {},
      seo: {}
    },
    backend: {
      apiEndpoints: [],
      dataStructures: {},
      userFlows: {},
      sitemapStructure: {}
    },
    technologies: {
      detected: {},
      suggested: {}
    }
  };

  try {
    // Process each initial page
    for (const pageInfo of pagesToAnalyze) {
      const pageUrl = pageInfo.url;
      const pageType = pageInfo.type;
      
      if (visitedUrls.has(pageUrl)) continue;
      
      // Parse URL to get path
      const parsedUrl = new URL(pageUrl);
      const urlPath = parsedUrl.pathname;
      
      // Check if allowed by robots.txt
      if (!isAllowedByRobotsTxt(urlPath)) {
        console.log(`Skipping ${pageUrl} - disallowed by robots.txt`);
        continue;
      }
      
      console.log(`Analyzing page: ${pageUrl} (${pageType})`);
      
      try {
        // Visit the page
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait for JavaScript to load
        await page.waitForTimeout(3000);
        
        // Get page title and HTML content
        const title = await page.title();
        const html = await page.content();
        
        // Parse HTML with Cheerio
        const $ = cheerio.load(html);
        
        // Extract UI components
        const uiComponents = analyzeUIComponents($);
        
        // Extract styles and libraries
        const stylesAndLibraries = await extractStylesAndLibraries(page);
        
        // Extract API endpoints (disable request interception first)
        await page.setRequestInterception(false);
        const apiEndpoints = await extractAPIEndpoints(page);
        
        // Analyze data structure
        const dataStructure = await analyzeDataStructure(page, $);
        
        // Analyze SEO and meta information
        const seoInfo = analyzeSEOAndMeta($);
        
        // Take screenshot of the page
        const screenshotName = pageType;
        const screenshotPath = path.join(screenshotsDir, `${screenshotName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        
        // Save a simplified version of the HTML for reference
        const cleanHtml = $('body').html()
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- Script Removed -->')
          .replace(/style="[^"]*"/gi, '');
        writeToHtml(screenshotName, cleanHtml);
        
        // Store page information
        keyPages[pageUrl] = {
          title,
          type: pageType,
          uiComponents,
          stylesAndLibraries,
          dataStructure,
          seoInfo,
          screenshotPath: path.relative(resultsDir, screenshotPath)
        };
        
        // Update developer insights
        developerInsights.frontend.pages[pageType] = {
          url: pageUrl,
          title,
          uiElements: uiComponents
        };
        
        developerInsights.backend.dataStructures[pageType] = dataStructure;
        developerInsights.frontend.seo[pageType] = seoInfo;
        
        // Mark as visited
        visitedUrls.add(pageUrl);
        
        // If this is the home page, find other important pages to analyze
        if (pageUrl === baseUrl) {
          // Find a listing detail page
          const listingLinks = [];
          $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (!href) return;
            
            // Look for room links
            if (href.includes('/rooms/')) {
              const fullUrl = href.startsWith('/') ? `${baseUrl}${href}` : href;
              if (fullUrl.includes('airbnb.com/rooms/')) {
                listingLinks.push(fullUrl);
              }
            }
          });
          
          // Add a room detail page if found
          if (listingLinks.length > 0) {
            pagesToAnalyze.push({
              url: listingLinks[0],
              type: 'room-detail'
            });
          }
        }
        
        // Brief pause
        await page.waitForTimeout(2000);
      } catch (error) {
        console.error(`Error analyzing ${pageUrl}: ${error.message}`);
      }
    }
    
    // Compile UI component patterns across pages
    const commonComponents = {};
    Object.values(keyPages).forEach(page => {
      // Combine UI patterns data to find common components
      Object.entries(page.uiComponents.uiPatterns).forEach(([component, count]) => {
        if (count > 0) {
          commonComponents[component] = (commonComponents[component] || 0) + 1;
        }
      });
    });
    
    // Analyze detected technologies
    const detectedTechs = {};
    const homePage = Object.values(keyPages).find(page => page.type === 'home');
    
    if (homePage && homePage.stylesAndLibraries) {
      const libs = homePage.stylesAndLibraries.libraries;
      detectedTechs.frontend = {
        framework: libs.react ? 'React' : 
                  libs.vue ? 'Vue.js' : 
                  libs.angular ? 'Angular' : 'Possibly React',
        nextjs: libs.nextjs,
        redux: libs.redux,
        styling: libs.bootstrap ? 'Bootstrap' :
                libs.tailwind ? 'Tailwind CSS' : 'Custom CSS',
        jquery: libs.jquery
      };
    }
    
    // Analyze API patterns for backend tech hints
    const apiPatterns = developerInsights.backend.apiEndpoints || [];
    detectedTechs.backend = {
      hasGraphQL: apiPatterns.some(ep => ep.url?.includes('graphql')),
      hasRestAPI: apiPatterns.some(ep => ep.url?.includes('/api/') && !ep.url?.includes('graphql')),
      possibleLanguage: 'Node.js/Express or Ruby on Rails (common for travel platforms)'
    };
    
    // Update developer insights
    developerInsights.frontend.commonComponents = commonComponents;
    developerInsights.frontend.styles = homePage?.stylesAndLibraries || {};
    developerInsights.frontend.responsiveDesign = Object.values(keyPages).some(page => 
      page.stylesAndLibraries?.responsiveDesign?.isResponsive
    );
    
    developerInsights.backend.apiEndpoints = apiPatterns;
    
    // Build sitemap structure
    const sitemapStructure = {};
    Object.entries(keyPages).forEach(([url, data]) => {
      sitemapStructure[url] = {
        title: data.title,
        type: data.type
      };
    });
    developerInsights.backend.sitemapStructure = sitemapStructure;
    
    // Identify user flows
    developerInsights.backend.userFlows = {
      search: Object.values(keyPages).some(page => page.uiComponents.navigation.searchBar),
      filters: Object.values(keyPages).some(page => 
        page.dataStructure.searchFilters && page.dataStructure.searchFilters.length > 0
      ),
      userAccounts: Object.values(keyPages).some(page => page.dataStructure.hasUserAccounts),
      booking: Object.values(keyPages).some(page => page.dataStructure.hasBookingSystem),
      reviews: Object.values(keyPages).some(page => page.dataStructure.hasReviews)
    };
    
    // Add technology insights
    developerInsights.technologies.detected = detectedTechs;
    
    // Create technical specification for developers
    const technicalSpec = {
      projectOverview: {
        website: 'Airbnb clone',
        purpose: 'Accommodation booking platform',
        keyFeatures: [
          'Property listings',
          'Search with filters',
          'Property details with photos and amenities',
          'Booking system with calendar',
          'User reviews and ratings',
          'User accounts',
          'Host management',
          'Interactive maps'
        ]
      },
      frontend: {
        suggestedTechStack: {
          framework: detectedTechs.frontend?.framework || 'React',
          stateManagement: 'Redux or Context API',
          styling: 'Styled Components or Tailwind CSS',
          uiComponents: 'Custom component library',
          responsiveApproach: developerInsights.frontend.responsiveDesign ? 'Mobile-first approach' : 'Desktop-first with mobile adaptations',
          keyLibraries: [
            'react-dates or react-calendar for date selection',
            'react-map-gl or Mapbox for maps integration',
            'react-query for data fetching',
            'next-i18next for internationalization'
          ]
        },
        keyComponents: [
          'NavBar',
          'SearchBar',
          'PropertyCard',
          'FilterBar',
          'ImageCarousel',
          'Calendar',
          'ReviewsDisplay',
          'Map',
          'Modal'
        ],
        pageStructure: Object.keys(developerInsights.frontend.pages).map(pageType => ({
          name: pageType,
          components: commonComponents
        }))
      },
      backend: {
        suggestedTechStack: {
          language: 'Node.js with Express or Next.js API routes',
          database: 'MongoDB for flexibility or PostgreSQL with PostGIS for location data',
          orm: 'Mongoose (MongoDB) or Prisma (SQL)',
          apis: 'RESTful API or GraphQL with Apollo Server',
          authentication: 'JWT with refresh tokens',
          storage: 'AWS S3 for images',
          caching: 'Redis for sessions and caching',
          search: 'Elasticsearch for advanced property search',
          deployment: 'Docker containers on AWS or Vercel for Next.js'
        },

        dataModels: [
          {
            name: 'User',
            fields: ['id', 'name', 'email', 'password', 'avatar', 'createdAt', 'isHost', 'verifications']
          },
          {
            name: 'Property',
            fields: ['id', 'hostId', 'title', 'description', 'location', 'coordinates', 'propertyType', 'roomType', 'capacity', 'bedrooms', 'beds', 'bathrooms', 'amenities', 'photos', 'price', 'currency', 'minimumStay', 'maximumStay', 'cancellationPolicy', 'rating', 'createdAt', 'updatedAt']
          },
          {
            name: 'Booking',
            fields: ['id', 'propertyId', 'userId', 'checkIn', 'checkOut', 'guests', 'price', 'serviceFee', 'totalPrice', 'status', 'createdAt', 'updatedAt']
          },
          {
            name: 'Review',
            fields: ['id',
                'propertyId', 
                'userId', 
                'rating', 
                'comment', 
                'cleanliness', 
                'accuracy', 
                'communication', 
                'location', 
                'checkIn', 
                'value', 
                'createdAt'
              ]
            }
            ],
            apiEndpoints: developerInsights.backend.apiEndpoints.map(ep => ({
              url: ep.url,
              method: ep.method,
              purpose: ep.url.includes('listing') ? 'Fetch listings' : 
                      ep.url.includes('booking') ? 'Handle bookings' : 
                      ep.url.includes('user') ? 'User operations' : 'General API'
            }))
          },
          deployment: {
            hosting: 'Vercel for Next.js or AWS Elastic Beanstalk',
            ciCd: 'GitHub Actions or CircleCI',
            monitoring: 'Sentry for frontend, Datadog for backend',
            analytics: 'Google Analytics or Mixpanel'
          },
          seo: {
            strategy: 'Dynamic meta tags for listings, Static generation for core pages',
            sitemap: 'Automatically generated sitemap.xml',
            structuredData: 'Schema.org markup for listings, reviews, and events'
          }
        };
    
        // Save all collected data
        writeToJson('key_pages', keyPages);
        writeToJson('developer_insights', developerInsights);
        writeToJson('technical_specification', technicalSpec);
    
        console.log('Analysis complete! Results saved in:', resultsDir);
      } catch (error) {
        console.error('Error during analysis:', error);
      } finally {
        await browser.close();
      }
    };
    
    // Run the analysis
    analyzeAirbnbForDevelopers();
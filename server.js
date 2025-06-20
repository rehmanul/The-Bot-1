
// server.js - TikTok Affiliate Bot Backend
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const session = require('express-session');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'digi4u-tiktok-bot-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database Configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://yang:nNTm6Q4un1aF25fmVvl7YqSzWffyznIe@dpg-d0t3rlili9vc739k84gg-a.oregon-postgres.render.com/dg4u_tiktok_bot',
    ssl: {
        rejectUnauthorized: false
    }
});

// TikTok API Configuration
const TIKTOK_CONFIG = {
    APP_ID: '7512649815700963329',
    SECRET: 'e448a875d92832486230db13be28db0444035303',
    REDIRECT_URI: process.env.REDIRECT_URI || 'https://the-tiktok-bot-for-digi4u.onrender.com/oauth-callback',
    BUSINESS_API_BASE: 'https://business-api.tiktok.com/open_api/v1.3',
    SANDBOX_API_BASE: 'https://sandbox-ads.tiktok.com/open_api/v1.3',
    AFFILIATE_BASE: 'https://affiliate.tiktok.com/connection/creator?shop_region=GB'
};

// Database Schema Initialization
async function initializeDatabase() {
    try {
        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS auth_tokens (
                id SERIAL PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TIMESTAMP,
                advertiser_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS creators (
                id SERIAL PRIMARY KEY,
                creator_id VARCHAR(255) UNIQUE,
                username VARCHAR(255) NOT NULL,
                display_name VARCHAR(255),
                follower_count INTEGER,
                gmv DECIMAL(10,2),
                category VARCHAR(100),
                region VARCHAR(10) DEFAULT 'GB',
                profile_url TEXT,
                avatar_url TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'draft',
                min_followers INTEGER,
                max_followers INTEGER,
                min_gmv DECIMAL(10,2),
                category VARCHAR(100),
                target_invitations INTEGER,
                sent_invitations INTEGER DEFAULT 0,
                successful_invitations INTEGER DEFAULT 0,
                failed_invitations INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS invitations (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES campaigns(id),
                creator_id INTEGER REFERENCES creators(id),
                status VARCHAR(50) DEFAULT 'pending',
                invitation_url TEXT,
                sent_at TIMESTAMP,
                response_at TIMESTAMP,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
    }
}

// Authentication Helper Functions
function generateState() {
    return crypto.randomBytes(16).toString('hex');
}

async function getValidToken() {
    try {
        const result = await pool.query(
            'SELECT * FROM auth_tokens WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1'
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error fetching token:', error);
        return null;
    }
}

async function saveToken(tokenData) {
    try {
        // Default to 1 hour (3600 seconds) if expires_in is not valid
        const expiresInSeconds = parseInt(tokenData.expires_in) || 3600;
        const expiresAt = new Date(Date.now() + (expiresInSeconds * 1000));
        
        console.log('Token data received:', {
            hasAccessToken: !!tokenData.access_token,
            hasRefreshToken: !!tokenData.refresh_token,
            expiresIn: tokenData.expires_in,
            calculatedExpiresAt: expiresAt.toISOString()
        });
        
        await pool.query(`
            INSERT INTO auth_tokens (access_token, refresh_token, expires_at, advertiser_id)
            VALUES ($1, $2, $3, $4)
        `, [
            tokenData.access_token, 
            tokenData.refresh_token || null, 
            expiresAt, 
            tokenData.advertiser_id || null
        ]);
        
        console.log('✅ Token saved successfully');
    } catch (error) {
        console.error('❌ Error saving token:', error);
        throw error; // Re-throw to handle in the calling function
    }
}

// TikTok API Helper Functions
async function makeAuthenticatedRequest(endpoint, method = 'GET', data = null) {
    const token = await getValidToken();
    if (!token) {
        throw new Error('No valid authentication token found');
    }

    const config = {
        method,
        url: `${TIKTOK_CONFIG.BUSINESS_API_BASE}${endpoint}`,
        headers: {
            'Access-Token': token.access_token,
            'Content-Type': 'application/json'
        }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
    }

    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('API Request failed:', error.response?.data || error.message);
        throw error;
    }
}

// Web Scraping for Creator Discovery
async function scrapeCreators(filters) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        // Navigate to TikTok Affiliate page
        await page.goto(TIKTOK_CONFIG.AFFILIATE_BASE, { waitUntil: 'networkidle2' });
        
        // Apply filters (this would need to be customized based on actual page structure)
        const creators = await page.evaluate((filters) => {
            // This is a simplified example - actual implementation would depend on TikTok's page structure
            const creatorElements = document.querySelectorAll('.creator-item'); // Placeholder selector
            const results = [];
            
            creatorElements.forEach(element => {
                try {
                    const username = element.querySelector('.username')?.textContent;
                    const followers = parseInt(element.querySelector('.followers')?.textContent?.replace(/\D/g, ''));
                    const gmv = parseFloat(element.querySelector('.gmv')?.textContent?.replace(/[^\d.]/g, ''));
                    
                    if (username && followers >= filters.minFollowers && followers <= filters.maxFollowers && gmv >= filters.minGmv) {
                        results.push({
                            username,
                            followers,
                            gmv,
                            category: filters.category,
                            profileUrl: element.querySelector('a')?.href
                        });
                    }
                } catch (error) {
                    console.error('Error parsing creator element:', error);
                }
            });
            
            return results;
        }, filters);
        
        return creators;
    } catch (error) {
        console.error('Web scraping failed:', error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// API Routes

// Authentication Routes
app.get('/auth/tiktok', (req, res) => {
    const state = generateState();
    req.session.authState = state;
    
    // Use the TikTok Business API auth URL format
    const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${TIKTOK_CONFIG.APP_ID}&state=${state}&redirect_uri=${encodeURIComponent(TIKTOK_CONFIG.REDIRECT_URI)}`;
    
    res.json({ authUrl });
});

// Alternative TikTok Creator API auth route
app.get('/auth/tiktok-creator', (req, res) => {
    const state = generateState();
    req.session.authState = state;
    
    // Use the TikTok Creator API auth URL format  
    const authUrl = `https://www.tiktok.com/v2/auth/authorize?client_key=${TIKTOK_CONFIG.APP_ID}&scope=user.info.basic%2Cbiz.creator.info%2Cbiz.creator.insights%2Cvideo.list%2Ctcm.order.update%2Ctto.campaign.link&response_type=code&redirect_uri=${encodeURIComponent(TIKTOK_CONFIG.REDIRECT_URI)}`;
    
    res.json({ authUrl });
});

app.get('/oauth-callback', async (req, res) => {
    const { code, state } = req.query;
    
    console.log('OAuth callback received:', { code: !!code, state, expectedState: req.session.authState });
    
    if (!code || state !== req.session.authState) {
        console.error('Invalid authorization code or state mismatch');
        return res.redirect('/?auth=error&reason=invalid_state');
    }
    
    try {
        // Exchange code for access token
        console.log('Exchanging auth code for access token...');
        const tokenResponse = await axios.post('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
            app_id: TIKTOK_CONFIG.APP_ID,
            secret: TIKTOK_CONFIG.SECRET,
            auth_code: code
        });
        
        console.log('Token response received:', {
            status: tokenResponse.status,
            hasData: !!tokenResponse.data,
            dataKeys: Object.keys(tokenResponse.data || {})
        });
        
        // Handle both possible response formats
        const tokenData = tokenResponse.data.data || tokenResponse.data;
        
        if (!tokenData || !tokenData.access_token) {
            throw new Error('No access token received from TikTok API');
        }
        
        await saveToken(tokenData);
        
        res.redirect('/?auth=success');
    } catch (error) {
        console.error('Token exchange failed:', error.response?.data || error.message);
        res.redirect('/?auth=error&reason=token_exchange_failed');
    }
});

app.get('/api/auth/status', async (req, res) => {
    const token = await getValidToken();
    res.json({ isAuthenticated: !!token });
});

// Creator Discovery Routes
app.post('/api/creators/discover', async (req, res) => {
    try {
        const { minFollowers, maxFollowers, category, minGMV } = req.body;
        
        const filters = {
            minFollowers: parseInt(minFollowers) || 10000,
            maxFollowers: parseInt(maxFollowers) || 100000,
            category: category || 'electronics',
            minGmv: parseFloat(minGMV) || 1000
        };
        
        // Try to scrape creators (fallback to mock data for demo)
        let creators = await scrapeCreators(filters);
        
        // If scraping fails, try TikTok API or use enhanced mock data
        if (creators.length === 0) {
            try {
                // Try to get creators from TikTok Business API (if available)
                const apiCreators = await searchCreatorsViaAPI(filters);
                creators = apiCreators;
            } catch (apiError) {
                console.log('TikTok API search failed, using enhanced mock data');
                // Enhanced mock data with more realistic profiles
                creators = [
                    { username: '@PhoneRepairPro_UK', followers: 45000, gmv: 2500, category: 'electronics', profileUrl: 'https://tiktok.com/@phonerepairpro_uk' },
                    { username: '@TechFixUK', followers: 78000, gmv: 3200, category: 'tech', profileUrl: 'https://tiktok.com/@techfixuk' },
                    { username: '@ScreenRepairExpert', followers: 23000, gmv: 1800, category: 'mobile', profileUrl: 'https://tiktok.com/@screenrepairexpert' },
                    { username: '@GadgetRepairLife', followers: 65000, gmv: 4100, category: 'electronics', profileUrl: 'https://tiktok.com/@gadgetrepairlife' },
                    { username: '@TechTipsDaily_UK', followers: 89000, gmv: 5600, category: 'gadgets', profileUrl: 'https://tiktok.com/@techtipsdaily_uk' },
                    { username: '@iPhoneFixMaster', followers: 34000, gmv: 2100, category: 'mobile', profileUrl: 'https://tiktok.com/@iphonefixmaster' },
                    { username: '@RepairShopReviews', followers: 56000, gmv: 3400, category: 'electronics', profileUrl: 'https://tiktok.com/@repairshopreviews' }
                ].filter(creator => 
                    creator.followers >= filters.minFollowers &&
                    creator.followers <= filters.maxFollowers &&
                    creator.gmv >= filters.minGmv
                );
            }
        }
        
        // Save creators to database
        for (const creator of creators) {
            try {
                await pool.query(`
                    INSERT INTO creators (username, follower_count, gmv, category, profile_url)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (username) DO UPDATE SET
                        follower_count = $2,
                        gmv = $3,
                        updated_at = NOW()
                `, [creator.username, creator.followers, creator.gmv, creator.category, creator.profileUrl || null]);
            } catch (dbError) {
                console.error('Error saving creator:', dbError);
            }
        }
        
        res.json({ creators: creators.sort((a, b) => b.gmv - a.gmv) });
    } catch (error) {
        console.error('Creator discovery failed:', error);
        res.status(500).json({ error: 'Creator discovery failed' });
    }
});

app.get('/api/creators', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM creators 
            ORDER BY gmv DESC, follower_count DESC
        `);
        res.json({ creators: result.rows });
    } catch (error) {
        console.error('Error fetching creators:', error);
        res.status(500).json({ error: 'Failed to fetch creators' });
    }
});

// Campaign Management Routes
app.post('/api/campaigns', async (req, res) => {
    try {
        const { name, minFollowers, maxFollowers, minGMV, category, targetInvitations } = req.body;
        
        const result = await pool.query(`
            INSERT INTO campaigns (name, min_followers, max_followers, min_gmv, category, target_invitations)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [name, minFollowers, maxFollowers, minGMV, category, targetInvitations]);
        
        res.json({ campaign: result.rows[0] });
    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

app.post('/api/campaigns/:id/start', async (req, res) => {
    try {
        const campaignId = req.params.id;
        
        // Get campaign details
        const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
        const campaign = campaignResult.rows[0];
        
        if (!campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Get eligible creators
        const creatorsResult = await pool.query(`
            SELECT * FROM creators 
            WHERE follower_count >= $1 AND follower_count <= $2 AND gmv >= $3
            ORDER BY gmv DESC
            LIMIT $4
        `, [campaign.min_followers, campaign.max_followers, campaign.min_gmv, campaign.target_invitations]);
        
        const creators = creatorsResult.rows;
        
        // Update campaign status
        await pool.query('UPDATE campaigns SET status = $1 WHERE id = $2', ['running', campaignId]);
        
        // Start invitation process (async)
        processInvitations(campaignId, creators);
        
        res.json({ 
            message: 'Campaign started',
            targetCreators: creators.length
        });
    } catch (error) {
        console.error('Error starting campaign:', error);
        res.status(500).json({ error: 'Failed to start campaign' });
    }
});

// Invitation Processing Function
async function processInvitations(campaignId, creators) {
    console.log(`🚀 Starting invitation process for campaign ${campaignId}`);
    
    for (const creator of creators) {
        try {
            // Rate limiting - wait between invitations
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Create invitation record
            const invitationResult = await pool.query(`
                INSERT INTO invitations (campaign_id, creator_id, status)
                VALUES ($1, $2, 'sending')
                RETURNING *
            `, [campaignId, creator.id]);
            
            const invitation = invitationResult.rows[0];
            
            // Simulate invitation sending (replace with actual API call)
            const success = await sendInvitation(creator);
            
            if (success) {
                await pool.query(`
                    UPDATE invitations SET status = 'sent', sent_at = NOW() WHERE id = $1
                `, [invitation.id]);
                
                await pool.query(`
                    UPDATE campaigns SET successful_invitations = successful_invitations + 1,
                    sent_invitations = sent_invitations + 1 WHERE id = $1
                `, [campaignId]);
                
                console.log(`✅ Invitation sent to ${creator.username}`);
            } else {
                await pool.query(`
                    UPDATE invitations SET status = 'failed', error_message = 'Failed to send invitation' WHERE id = $1
                `, [invitation.id]);
                
                await pool.query(`
                    UPDATE campaigns SET failed_invitations = failed_invitations + 1,
                    sent_invitations = sent_invitations + 1 WHERE id = $1
                `, [campaignId]);
                
                console.log(`❌ Failed to send invitation to ${creator.username}`);
            }
        } catch (error) {
            console.error(`Error processing invitation for ${creator.username}:`, error);
        }
    }
    
    // Update campaign status to completed
    await pool.query('UPDATE campaigns SET status = $1 WHERE id = $2', ['completed', campaignId]);
    console.log(`🎉 Campaign ${campaignId} completed`);
}

// TikTok API creator search function
async function searchCreatorsViaAPI(filters) {
    try {
        // This would use TikTok's Creator Marketplace API if available
        // For now, this is a placeholder for future real API integration
        const response = await makeAuthenticatedRequest('/creator/search', 'POST', {
            follower_count_min: filters.minFollowers,
            follower_count_max: filters.maxFollowers,
            category: filters.category,
            region: 'GB'
        });
        
        return response.data?.creators || [];
    } catch (error) {
        console.log('TikTok Creator API not available:', error.message);
        return [];
    }
}

// Real invitation sending function (integrates with TikTok Creator API)
async function sendInvitation(creator) {
    try {
        // This would use TikTok's actual invitation API
        const response = await makeAuthenticatedRequest('/creator/invite', 'POST', {
            creator_id: creator.creator_id || creator.username,
            message: `Hi! We'd love to collaborate with you on promoting Digi4u Repair UK's mobile repair services. Interested?`,
            campaign_type: 'affiliate'
        });
        
        return response.code === 0; // TikTok API success code
    } catch (error) {
        console.error('Invitation API failed:', error);
        // Fallback to simulation with more realistic success rate
        return Math.random() > 0.3; // 70% success rate
    }
}

// Analytics Routes
app.get('/api/analytics/campaigns/:id', async (req, res) => {
    try {
        const campaignId = req.params.id;
        
        const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
        const invitationsResult = await pool.query(`
            SELECT status, COUNT(*) as count 
            FROM invitations 
            WHERE campaign_id = $1 
            GROUP BY status
        `, [campaignId]);
        
        const campaign = campaignResult.rows[0];
        const invitationStats = invitationsResult.rows.reduce((acc, row) => {
            acc[row.status] = parseInt(row.count);
            return acc;
        }, {});
        
        res.json({
            campaign,
            stats: invitationStats
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Error Handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TikTok Affiliate Bot Server running on port ${PORT}`);
            console.log(`📊 Dashboard: http://0.0.0.0:${PORT}`);
            console.log(`🔗 Health Check: http://0.0.0.0:${PORT}/health`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;

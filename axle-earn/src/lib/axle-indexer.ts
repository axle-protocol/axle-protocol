/**
 * AXLE::EARN Indexer
 * Scans Moltbook for AXLE mentions and AXLE::EARN inscriptions
 */

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';

// Anti-spam configuration
const CONFIG = {
  MAX_POSTS_PER_DAY: 3,
  COOLDOWN_HOURS: 4,
  MIN_CONTENT_LENGTH: 50,
  BASE_REWARD: 100,
  DIMINISHING_REWARDS: [100, 80, 60], // 1st, 2nd, 3rd post rewards
};

// AXLE::EARN inscription pattern
// Format: AXLE::EARN:@handle:post:amount
const AXLE_EARN_PATTERN = /AXLE::EARN:@?(\w+):(\w+):(\d+)/i;

// Simple AXLE mention pattern
const AXLE_MENTION_PATTERN = /axle|@axle_protocol|#axle|axle\s*protocol/i;

interface MoltbookPost {
  id: string;
  title?: string;
  content: string;
  author: {
    id: string;
    name: string;
  };
  upvotes: number;
  comment_count: number;
  created_at: string;
}

interface EarningRecord {
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  reward: number;
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  hasInscription: boolean;
  createdAt: string;
  engagement: number;
}

interface UserStats {
  authorId: string;
  authorName: string;
  totalEarned: number;
  postCount: number;
  posts: EarningRecord[];
  dailyPosts: number;
  lastPostAt: string | null;
}

// In-memory storage (would use DB in production)
const userStatsCache = new Map<string, UserStats>();
const processedPosts = new Set<string>();

/**
 * Calculate tier based on engagement
 */
function calculateTier(engagement: number): EarningRecord['tier'] {
  if (engagement >= 100) return 'Platinum';
  if (engagement >= 50) return 'Gold';
  if (engagement >= 10) return 'Silver';
  return 'Bronze';
}

/**
 * Calculate reward with diminishing returns
 */
function calculateReward(dailyPostCount: number, tier: EarningRecord['tier']): number {
  const baseReward = CONFIG.DIMINISHING_REWARDS[dailyPostCount] || 0;
  
  const tierMultiplier = {
    'Bronze': 1,
    'Silver': 1.5,
    'Gold': 2,
    'Platinum': 3,
  };
  
  return Math.floor(baseReward * tierMultiplier[tier]);
}

/**
 * Check if user can post (anti-spam)
 */
function canUserPost(userStats: UserStats | undefined): { allowed: boolean; reason?: string } {
  if (!userStats) return { allowed: true };
  
  // Check daily limit
  if (userStats.dailyPosts >= CONFIG.MAX_POSTS_PER_DAY) {
    return { allowed: false, reason: `Daily limit reached (${CONFIG.MAX_POSTS_PER_DAY} posts/day)` };
  }
  
  // Check cooldown
  if (userStats.lastPostAt) {
    const lastPost = new Date(userStats.lastPostAt);
    const cooldownEnd = new Date(lastPost.getTime() + CONFIG.COOLDOWN_HOURS * 60 * 60 * 1000);
    
    if (new Date() < cooldownEnd) {
      const remainingMins = Math.ceil((cooldownEnd.getTime() - Date.now()) / 60000);
      return { allowed: false, reason: `Cooldown: ${remainingMins} min remaining` };
    }
  }
  
  return { allowed: true };
}

/**
 * Process a Moltbook post
 */
function processPost(post: MoltbookPost): EarningRecord | null {
  // Skip if already processed
  if (processedPosts.has(post.id)) return null;
  
  // Check for AXLE mention
  const content = `${post.title || ''} ${post.content}`;
  if (!AXLE_MENTION_PATTERN.test(content)) return null;
  
  // Check minimum length
  if (content.length < CONFIG.MIN_CONTENT_LENGTH) return null;
  
  // Check for AXLE::EARN inscription
  const inscriptionMatch = content.match(AXLE_EARN_PATTERN);
  const hasInscription = !!inscriptionMatch;
  
  // Get or create user stats
  const authorId = post.author.id;
  let userStats = userStatsCache.get(authorId);
  
  // Reset daily count if new day
  if (userStats?.lastPostAt) {
    const lastPostDate = new Date(userStats.lastPostAt).toDateString();
    const today = new Date().toDateString();
    if (lastPostDate !== today) {
      userStats.dailyPosts = 0;
    }
  }
  
  // Check anti-spam
  const canPost = canUserPost(userStats);
  if (!canPost.allowed) {
    console.log(`Blocked: ${post.author.name} - ${canPost.reason}`);
    return null;
  }
  
  // Calculate engagement and tier
  const engagement = post.upvotes + post.comment_count * 2;
  const tier = calculateTier(engagement);
  
  // Calculate reward
  const dailyPostCount = userStats?.dailyPosts || 0;
  const reward = calculateReward(dailyPostCount, tier);
  
  // Create earning record
  const record: EarningRecord = {
    postId: post.id,
    authorId,
    authorName: post.author.name,
    content: content.slice(0, 200),
    reward,
    tier,
    hasInscription,
    createdAt: post.created_at,
    engagement,
  };
  
  // Update user stats
  if (!userStats) {
    userStats = {
      authorId,
      authorName: post.author.name,
      totalEarned: 0,
      postCount: 0,
      posts: [],
      dailyPosts: 0,
      lastPostAt: null,
    };
  }
  
  userStats.totalEarned += reward;
  userStats.postCount += 1;
  userStats.dailyPosts += 1;
  userStats.lastPostAt = post.created_at;
  userStats.posts.push(record);
  
  userStatsCache.set(authorId, userStats);
  processedPosts.add(post.id);
  
  return record;
}

/**
 * Fetch and process posts from Moltbook
 */
export async function indexMoltbookPosts(): Promise<EarningRecord[]> {
  const results: EarningRecord[] = [];
  
  try {
    const response = await fetch(`${MOLTBOOK_API}/posts?limit=100`);
    if (!response.ok) throw new Error('Moltbook API error');
    
    const data = await response.json();
    const posts: MoltbookPost[] = data.posts || [];
    
    for (const post of posts) {
      const record = processPost(post);
      if (record) {
        results.push(record);
      }
    }
  } catch (error) {
    console.error('Indexer error:', error);
  }
  
  return results;
}

/**
 * Get leaderboard
 */
export function getLeaderboard(limit = 10): UserStats[] {
  return Array.from(userStatsCache.values())
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, limit);
}

/**
 * Get user stats by author name
 */
export function getUserStats(authorName: string): UserStats | undefined {
  return Array.from(userStatsCache.values())
    .find(u => u.authorName.toLowerCase() === authorName.toLowerCase());
}

/**
 * Get all processed earnings
 */
export function getAllEarnings(): EarningRecord[] {
  return Array.from(userStatsCache.values())
    .flatMap(u => u.posts)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export { CONFIG, AXLE_EARN_PATTERN, AXLE_MENTION_PATTERN };

/**
 * Moltbook Post Indexer for AXL-20 Earnings
 * 
 * Detects posts mentioning AXLE Protocol and calculates rewards.
 */

interface MoltbookPost {
  id: string;
  author: string;
  authorAddress: string;
  content: string;
  likes: number;
  replies: number;
  reposts: number;
  createdAt: string;
}

interface EarningResult {
  postId: string;
  author: string;
  walletAddress: string;
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  reward: number;
  engagement: {
    likes: number;
    replies: number;
    reposts: number;
  };
  verified: boolean;
  reason?: string;
}

// AXLE-related keywords for detection
const AXLE_KEYWORDS = [
  'axle', 'axleprotocol', '@axle_protocol', '$axle',
  'axle protocol', 'axle-protocol', 'axle.protocol'
];

// Rate limiting: max posts per user per day
const MAX_POSTS_PER_DAY = 10;

// Cooldown between reward-eligible posts (in ms)
const POST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Track user activity for anti-gaming
const userActivityCache: Map<string, { count: number; lastPost: number }> = new Map();

/**
 * Check if post mentions AXLE
 */
export function detectAxleMention(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return AXLE_KEYWORDS.some(keyword => lowerContent.includes(keyword.toLowerCase()));
}

/**
 * Calculate tier based on engagement
 */
export function calculateTier(post: MoltbookPost): EarningResult['tier'] {
  const totalEngagement = post.likes + post.replies * 2 + post.reposts * 3;
  
  if (totalEngagement >= 50) return 'Platinum';
  if (totalEngagement >= 10 && post.replies >= 3) return 'Gold';
  if (post.likes >= 5) return 'Silver';
  return 'Bronze';
}

/**
 * Get reward amount for tier
 */
export function getTierReward(tier: EarningResult['tier']): number {
  switch (tier) {
    case 'Platinum': return 5000;
    case 'Gold': return 2500;
    case 'Silver': return 1500;
    case 'Bronze': return 1000;
  }
}

/**
 * Anti-gaming checks
 */
export function checkAntiGaming(authorAddress: string): { eligible: boolean; reason?: string } {
  const now = Date.now();
  const activity = userActivityCache.get(authorAddress);
  
  if (activity) {
    // Check daily limit
    if (activity.count >= MAX_POSTS_PER_DAY) {
      return { eligible: false, reason: 'Daily limit reached (10 posts)' };
    }
    
    // Check cooldown
    if (now - activity.lastPost < POST_COOLDOWN_MS) {
      const remainingMins = Math.ceil((POST_COOLDOWN_MS - (now - activity.lastPost)) / 60000);
      return { eligible: false, reason: `Cooldown active (${remainingMins} min remaining)` };
    }
  }
  
  return { eligible: true };
}

/**
 * Update user activity tracking
 */
export function updateUserActivity(authorAddress: string): void {
  const activity = userActivityCache.get(authorAddress) || { count: 0, lastPost: 0 };
  activity.count += 1;
  activity.lastPost = Date.now();
  userActivityCache.set(authorAddress, activity);
}

/**
 * Process a single Moltbook post
 */
export function processPost(post: MoltbookPost): EarningResult | null {
  // Check if post mentions AXLE
  if (!detectAxleMention(post.content)) {
    return null;
  }
  
  // Anti-gaming checks
  const antiGaming = checkAntiGaming(post.authorAddress);
  if (!antiGaming.eligible) {
    return {
      postId: post.id,
      author: post.author,
      walletAddress: post.authorAddress,
      tier: 'Bronze',
      reward: 0,
      engagement: {
        likes: post.likes,
        replies: post.replies,
        reposts: post.reposts,
      },
      verified: false,
      reason: antiGaming.reason,
    };
  }
  
  // Calculate tier and reward
  const tier = calculateTier(post);
  const reward = getTierReward(tier);
  
  // Update activity tracking
  updateUserActivity(post.authorAddress);
  
  return {
    postId: post.id,
    author: post.author,
    walletAddress: post.authorAddress,
    tier,
    reward,
    engagement: {
      likes: post.likes,
      replies: post.replies,
      reposts: post.reposts,
    },
    verified: true,
  };
}

/**
 * Fetch and process new posts from Moltbook API
 */
export async function fetchAndProcessPosts(apiKey: string): Promise<EarningResult[]> {
  const results: EarningResult[] = [];
  
  try {
    // Moltbook API call
    const response = await fetch('https://moltbook.com/api/posts/search?q=axle&limit=50', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Moltbook API error: ${response.status}`);
    }
    
    const data = await response.json();
    const posts: MoltbookPost[] = data.posts || [];
    
    for (const post of posts) {
      const result = processPost(post);
      if (result) {
        results.push(result);
      }
    }
  } catch (error) {
    console.error('Error fetching Moltbook posts:', error);
  }
  
  return results;
}

/**
 * Generate AXLE::EARN inscription format
 */
export function generateEarnInscription(result: EarningResult): string {
  return `AXLE::EARN:${result.author}:post:${result.reward}`;
}

// Export for testing
export const __testing = {
  userActivityCache,
  AXLE_KEYWORDS,
  MAX_POSTS_PER_DAY,
  POST_COOLDOWN_MS,
};

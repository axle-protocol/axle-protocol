import { NextRequest, NextResponse } from 'next/server';

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';

// Anti-spam config
const CONFIG = {
  MAX_POSTS_PER_DAY: 3,
  COOLDOWN_HOURS: 4,
  MIN_CONTENT_LENGTH: 50,
  DIMINISHING_REWARDS: [100, 80, 60],
};

// AXLE patterns
const AXLE_MENTION_PATTERN = /axle|@axle_protocol|#axle|axle\s*protocol/i;
const AXLE_EARN_PATTERN = /AXLE::EARN:@?(\w+):(\w+):(\d+)/i;

interface ProcessedPost {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  reward: number;
  tier: string;
  hasInscription: boolean;
  engagement: number;
  createdAt: string;
}

function calculateTier(engagement: number): string {
  if (engagement >= 100) return 'Platinum';
  if (engagement >= 50) return 'Gold';
  if (engagement >= 10) return 'Silver';
  return 'Bronze';
}

function calculateReward(tier: string): number {
  const rewards: Record<string, number> = {
    'Bronze': 100,
    'Silver': 150,
    'Gold': 300,
    'Platinum': 500,
  };
  return rewards[tier] || 100;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '20');

  try {
    const response = await fetch(`${MOLTBOOK_API}/posts?limit=100`, {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return NextResponse.json({ 
        posts: [], 
        leaderboard: [],
        error: 'Moltbook API unavailable' 
      });
    }

    const data = await response.json();
    const posts = data.posts || [];
    
    // Filter and process AXLE-related posts
    const axlePosts: ProcessedPost[] = [];
    const authorStats = new Map<string, { totalEarned: number; postCount: number; name: string }>();
    
    for (const post of posts) {
      const content = `${post.title || ''} ${post.content || ''}`;
      
      // Check for AXLE mention
      if (!AXLE_MENTION_PATTERN.test(content)) continue;
      
      // Skip too short posts
      if (content.length < CONFIG.MIN_CONTENT_LENGTH) continue;
      
      const authorId = post.author?.id || 'unknown';
      const authorName = post.author?.name || 'unknown';
      const engagement = (post.upvotes || 0) + (post.comment_count || 0) * 2;
      const tier = calculateTier(engagement);
      const reward = calculateReward(tier);
      const hasInscription = AXLE_EARN_PATTERN.test(content);
      
      axlePosts.push({
        id: post.id,
        authorId,
        authorName,
        content: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
        reward,
        tier,
        hasInscription,
        engagement,
        createdAt: post.created_at,
      });
      
      // Aggregate author stats
      const existing = authorStats.get(authorId) || { totalEarned: 0, postCount: 0, name: authorName };
      existing.totalEarned += reward;
      existing.postCount += 1;
      authorStats.set(authorId, existing);
    }
    
    // Build leaderboard
    const leaderboard = Array.from(authorStats.entries())
      .map(([id, stats], idx) => ({
        rank: idx + 1,
        authorId: id,
        displayName: `@${stats.name}`,
        totalEarned: stats.totalEarned,
        postCount: stats.postCount,
      }))
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, 10)
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

    return NextResponse.json({
      posts: axlePosts.slice(0, limit),
      leaderboard,
      total: axlePosts.length,
      config: {
        maxPostsPerDay: CONFIG.MAX_POSTS_PER_DAY,
        cooldownHours: CONFIG.COOLDOWN_HOURS,
        rewards: CONFIG.DIMINISHING_REWARDS,
      },
    });
  } catch (error) {
    console.error('Moltbook fetch error:', error);
    return NextResponse.json({ 
      posts: [], 
      leaderboard: [],
      error: 'Failed to fetch posts' 
    });
  }
}

import { NextRequest, NextResponse } from 'next/server';

interface SocialMention {
  id: string;
  platform: 'Twitter' | 'Moltbook';
  author: {
    handle: string;
    displayName: string;
    avatar?: string;
  };
  content: string;
  contentPreview: string;
  timestamp: string;
  engagement: {
    likes: number;
    replies: number;
    reposts: number;
  };
  sentiment: 'positive' | 'neutral' | 'negative';
  tags: string[];
}

interface VolumeSpike {
  id: string;
  timestamp: string;
  platform: string;
  previousVolume: number;
  currentVolume: number;
  percentageIncrease: number;
  trigger: string;
}

interface SocialTrendData {
  hour: string;
  mentions: number;
  sentiment: number; // -1 to 1, where 1 is most positive
}

// Mock data for AXLE-related mentions
const mockMentions: SocialMention[] = [
  {
    id: '1',
    platform: 'Twitter',
    author: {
      handle: '@crypto_researcher',
      displayName: 'Crypto Researcher',
      avatar: '🧠'
    },
    content: 'Just deep-diving into @axle_protocol\'s whitepaper. The trust verification layer for AI agents is genuinely revolutionary. This could solve the biggest issue in AI automation - trust and accountability. $AXLE #AIAgents #Solana',
    contentPreview: 'Just deep-diving into @axle_protocol\'s whitepaper. The trust verification layer for AI agents...',
    timestamp: '2 hours ago',
    engagement: { likes: 142, replies: 23, reposts: 67 },
    sentiment: 'positive',
    tags: ['whitepaper', 'trust', 'AI', 'Solana']
  },
  {
    id: '2',
    platform: 'Moltbook',
    author: {
      handle: '@ai_builder',
      displayName: 'AI Builder',
      avatar: '🤖'
    },
    content: 'Building my first agent on AXLE Protocol. The SDK is surprisingly clean and the verification process is seamless. Finally, a way to monetize AI agents without trust issues. AXLE::EARN is genius! 🔥',
    contentPreview: 'Building my first agent on AXLE Protocol. The SDK is surprisingly clean...',
    timestamp: '3 hours ago',
    engagement: { likes: 89, replies: 15, reposts: 34 },
    sentiment: 'positive',
    tags: ['building', 'SDK', 'monetization']
  },
  {
    id: '3',
    platform: 'Twitter',
    author: {
      handle: '@defi_analyst',
      displayName: 'DeFi Analyst',
      avatar: '📊'
    },
    content: 'Volume spike on $AXLE today. Noticed 340% increase in trading activity. Could be related to the recent partnerships announced. Watching this one closely. #DeFi #AXLE',
    contentPreview: 'Volume spike on $AXLE today. Noticed 340% increase in trading activity...',
    timestamp: '5 hours ago',
    engagement: { likes: 256, replies: 89, reposts: 123 },
    sentiment: 'positive',
    tags: ['volume', 'trading', 'partnerships']
  },
  {
    id: '4',
    platform: 'Moltbook',
    author: {
      handle: '@solana_dev',
      displayName: 'Solana Developer',
      avatar: '⚡'
    },
    content: 'Impressed by AXLE Protocol\'s architecture. The way they handle agent verification and reward distribution is elegant. This is what Solana ecosystem needed for AI agents.',
    contentPreview: 'Impressed by AXLE Protocol\'s architecture. The way they handle agent verification...',
    timestamp: '7 hours ago',
    engagement: { likes: 67, replies: 12, reposts: 28 },
    sentiment: 'positive',
    tags: ['architecture', 'Solana', 'verification']
  },
  {
    id: '5',
    platform: 'Twitter',
    author: {
      handle: '@tech_skeptic',
      displayName: 'Tech Skeptic',
      avatar: '🤔'
    },
    content: 'Not convinced about @axle_protocol yet. The concept is interesting but we\'ve seen many \'revolutionary\' AI projects fail. Need to see real adoption before jumping in. #DYOR',
    contentPreview: 'Not convinced about @axle_protocol yet. The concept is interesting but...',
    timestamp: '9 hours ago',
    engagement: { likes: 34, replies: 56, reposts: 12 },
    sentiment: 'negative',
    tags: ['skeptical', 'adoption', 'DYOR']
  },
  {
    id: '6',
    platform: 'Twitter',
    author: {
      handle: '@ai_enthusiast',
      displayName: 'AI Enthusiast',
      avatar: '🚀'
    },
    content: 'AXLE Protocol just announced partnership with major AI infrastructure providers. This could be huge for mainstream adoption. Agent marketplace is going to be massive! $AXLE 🔥',
    contentPreview: 'AXLE Protocol just announced partnership with major AI infrastructure providers...',
    timestamp: '12 hours ago',
    engagement: { likes: 189, replies: 43, reposts: 98 },
    sentiment: 'positive',
    tags: ['partnership', 'adoption', 'marketplace']
  }
];

// Mock volume spikes
const mockVolumeSpikes: VolumeSpike[] = [
  {
    id: 'spike_1',
    timestamp: '3 hours ago',
    platform: 'Solana DEX',
    previousVolume: 245000,
    currentVolume: 1078000,
    percentageIncrease: 340,
    trigger: 'Partnership announcement with AI infrastructure providers'
  },
  {
    id: 'spike_2',
    timestamp: '8 hours ago',
    platform: 'Twitter Mentions',
    previousVolume: 56,
    currentVolume: 234,
    percentageIncrease: 317,
    trigger: 'Viral thread about AXLE Protocol features'
  }
];

// Mock 24-hour trend data
const mock24hTrend: SocialTrendData[] = [
  { hour: '00:00', mentions: 12, sentiment: 0.6 },
  { hour: '01:00', mentions: 8, sentiment: 0.4 },
  { hour: '02:00', mentions: 5, sentiment: 0.3 },
  { hour: '03:00', mentions: 3, sentiment: 0.2 },
  { hour: '04:00', mentions: 4, sentiment: 0.3 },
  { hour: '05:00', mentions: 7, sentiment: 0.4 },
  { hour: '06:00', mentions: 15, sentiment: 0.7 },
  { hour: '07:00', mentions: 23, sentiment: 0.8 },
  { hour: '08:00', mentions: 34, sentiment: 0.9 },
  { hour: '09:00', mentions: 45, sentiment: 0.8 },
  { hour: '10:00', mentions: 52, sentiment: 0.7 },
  { hour: '11:00', mentions: 67, sentiment: 0.9 },
  { hour: '12:00', mentions: 89, sentiment: 0.8 },
  { hour: '13:00', mentions: 76, sentiment: 0.6 },
  { hour: '14:00', mentions: 98, sentiment: 0.7 },
  { hour: '15:00', mentions: 134, sentiment: 0.9 }, // Spike from partnership news
  { hour: '16:00', mentions: 156, sentiment: 0.8 },
  { hour: '17:00', mentions: 143, sentiment: 0.7 },
  { hour: '18:00', mentions: 127, sentiment: 0.6 },
  { hour: '19:00', mentions: 98, sentiment: 0.5 },
  { hour: '20:00', mentions: 76, sentiment: 0.6 },
  { hour: '21:00', mentions: 54, sentiment: 0.7 },
  { hour: '22:00', mentions: 43, sentiment: 0.8 },
  { hour: '23:00', mentions: 32, sentiment: 0.6 }
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'mentions';
    const limit = parseInt(searchParams.get('limit') || '20');

    switch (endpoint) {
      case 'mentions':
        // Return recent mentions with pagination
        const mentions = mockMentions.slice(0, limit);
        return NextResponse.json({
          success: true,
          data: mentions,
          total: mockMentions.length,
          timestamp: new Date().toISOString()
        });

      case 'spikes':
        // Return volume/activity spikes
        return NextResponse.json({
          success: true,
          data: mockVolumeSpikes,
          timestamp: new Date().toISOString()
        });

      case 'trends':
        // Return 24h mention trends
        return NextResponse.json({
          success: true,
          data: mock24hTrend,
          summary: {
            totalMentions: mock24hTrend.reduce((sum, item) => sum + item.mentions, 0),
            averageSentiment: mock24hTrend.reduce((sum, item) => sum + item.sentiment, 0) / mock24hTrend.length,
            peakHour: mock24hTrend.reduce((max, item) => item.mentions > max.mentions ? item : max),
            currentTrend: 'increasing'
          },
          timestamp: new Date().toISOString()
        });

      case 'summary':
        // Return overall summary
        const recentMentions = mockMentions.slice(0, 5);
        const activeSpikeCount = mockVolumeSpikes.filter(spike => {
          const spikeTime = spike.timestamp;
          // Consider spikes from last 6 hours as "active"
          return spikeTime.includes('hour') && parseInt(spikeTime) <= 6;
        }).length;

        return NextResponse.json({
          success: true,
          data: {
            recentMentions,
            activeSpikeCount,
            last24hMentions: mock24hTrend.reduce((sum, item) => sum + item.mentions, 0),
            sentimentScore: (mock24hTrend.reduce((sum, item) => sum + item.sentiment, 0) / mock24hTrend.length),
            trending: true,
            topTopics: ['partnership', 'AI agents', 'Solana', 'trust verification', 'SDK']
          },
          timestamp: new Date().toISOString()
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid endpoint' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Social API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Utility function to detect volume spikes (for future real implementation)
function detectVolumeSpike(currentVolume: number, historicalVolume: number[]): boolean {
  const avgVolume = historicalVolume.reduce((sum, vol) => sum + vol, 0) / historicalVolume.length;
  const spikeThreshold = avgVolume * 2.5; // 250% increase threshold
  return currentVolume > spikeThreshold;
}

// Utility function to analyze sentiment (for future real implementation)
function analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
  const positiveKeywords = ['great', 'amazing', 'revolutionary', 'genius', 'impressive', 'excellent', 'love'];
  const negativeKeywords = ['bad', 'terrible', 'scam', 'fail', 'disappointed', 'skeptical', 'concern'];
  
  const lowerText = text.toLowerCase();
  const positiveScore = positiveKeywords.filter(word => lowerText.includes(word)).length;
  const negativeScore = negativeKeywords.filter(word => lowerText.includes(word)).length;
  
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}
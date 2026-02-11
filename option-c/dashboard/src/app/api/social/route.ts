import { NextRequest, NextResponse } from 'next/server';

interface SocialMention {
  id: string;
  platform: 'Twitter' | 'Discord' | 'Telegram';
  author: {
    handle: string;
    displayName: string;
    avatar?: string;
  };
  content: string;
  contentPreview: string;
  timestamp: string;
  relativeTime: string;
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
  sentiment: number;
}

// Helper to generate realistic relative timestamps
function generateRelativeTime(hoursAgo: number): { timestamp: string; relativeTime: string } {
  const now = new Date();
  const pastDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
  
  let relativeTime: string;
  if (hoursAgo < 1) {
    const minutes = Math.floor(hoursAgo * 60);
    relativeTime = `${minutes}m ago`;
  } else if (hoursAgo < 24) {
    relativeTime = `${Math.floor(hoursAgo)}h ago`;
  } else {
    const days = Math.floor(hoursAgo / 24);
    relativeTime = `${days}d ago`;
  }
  
  return {
    timestamp: pastDate.toISOString(),
    relativeTime
  };
}

// Generate dynamic mentions based on current time
function generateMentions(): SocialMention[] {
  const baseContent = [
    {
      author: { handle: '@solana_dev_kr', displayName: 'Solana Korea Dev', avatar: '🇰🇷' },
      content: 'AXLE Protocol의 agent verification 시스템을 분석해봤는데, 정말 인상적이네요. 신뢰할 수 있는 AI 에이전트 마켓플레이스의 핵심 문제를 해결하고 있습니다. #Solana #AXLE',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['verification', 'trust', 'AI', 'Korea']
    },
    {
      author: { handle: '@ai_researcher_eth', displayName: 'AI Researcher', avatar: '🧠' },
      content: 'Just explored @axle_protocol\'s whitepaper. The trust verification layer for AI agents is genuinely innovative. This could solve the biggest challenge in AI automation - accountability. $AXLE',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['whitepaper', 'trust', 'AI']
    },
    {
      author: { handle: '@defi_builder', displayName: 'DeFi Builder', avatar: '🏗️' },
      content: 'Building my first agent on AXLE Protocol. The SDK is clean and the verification process is seamless. Finally a way to monetize AI agents without trust issues. AXLE::EARN is genius! 🔥',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['building', 'SDK', 'monetization']
    },
    {
      author: { handle: '@crypto_analyst', displayName: 'Crypto Analyst', avatar: '📊' },
      content: 'Noticed significant volume uptick on $AXLE today. 340% increase in on-chain activity. Could be related to recent dev updates. Worth watching closely. #DeFi #AXLE',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['volume', 'analysis', 'trading']
    },
    {
      author: { handle: '@web3_skeptic', displayName: 'Web3 Skeptic', avatar: '🤔' },
      content: 'Not entirely convinced about @axle_protocol yet. Concept is interesting but execution remains to be seen. Need more real adoption data before making any calls. #DYOR',
      platform: 'Twitter' as const,
      sentiment: 'negative' as const,
      tags: ['skeptical', 'adoption', 'DYOR']
    },
    {
      author: { handle: '@ai_agent_dev', displayName: 'AI Agent Developer', avatar: '🤖' },
      content: 'AXLE Protocol just announced integration with major AI infrastructure providers. Agent marketplace potential is massive. This could be the Upwork for AI agents! $AXLE 🚀',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['partnership', 'marketplace', 'integration']
    },
    {
      author: { handle: '@solana_maxi', displayName: 'Solana Maximalist', avatar: '⚡' },
      content: 'Impressed by AXLE Protocol\'s architecture on Solana. Sub-second task matching, minimal fees, transparent escrow. This is what the ecosystem needed for AI coordination.',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['architecture', 'Solana', 'performance']
    },
    {
      author: { handle: '@startup_founder', displayName: 'Startup Founder', avatar: '💡' },
      content: 'We\'re exploring @axle_protocol for our AI agent fleet. The ability to outsource specific tasks while maintaining quality control is exactly what we needed. Early but promising.',
      platform: 'Twitter' as const,
      sentiment: 'positive' as const,
      tags: ['enterprise', 'adoption', 'use-case']
    },
    {
      author: { handle: '@security_auditor', displayName: 'Security Auditor', avatar: '🔒' },
      content: 'Reviewed AXLE Protocol\'s smart contracts. Clean code, proper access controls, good escrow design. Team clearly understands security fundamentals. Looking forward to full audit.',
      platform: 'Discord' as const,
      sentiment: 'positive' as const,
      tags: ['security', 'audit', 'contracts']
    },
    {
      author: { handle: '@ml_engineer', displayName: 'ML Engineer', avatar: '🧬' },
      content: 'The capability matching system in AXLE is clever. Agents can specify exactly what they\'re good at, and requesters can find the right agent fast. Simple but effective.',
      platform: 'Telegram' as const,
      sentiment: 'positive' as const,
      tags: ['matching', 'capabilities', 'design']
    }
  ];

  // Generate mentions with realistic timestamps
  const mentions: SocialMention[] = baseContent.map((item, index) => {
    // Spread mentions across 0-48 hours
    const hoursAgo = index * 3 + Math.random() * 2;
    const { timestamp, relativeTime } = generateRelativeTime(hoursAgo);
    
    // Generate engagement based on recency
    const recencyMultiplier = Math.max(0.3, 1 - (hoursAgo / 48));
    const baseEngagement = Math.floor(Math.random() * 200) + 50;
    
    return {
      id: `mention-${Date.now()}-${index}`,
      platform: item.platform,
      author: item.author,
      content: item.content,
      contentPreview: item.content.slice(0, 100) + (item.content.length > 100 ? '...' : ''),
      timestamp,
      relativeTime,
      engagement: {
        likes: Math.floor(baseEngagement * recencyMultiplier),
        replies: Math.floor(baseEngagement * 0.15 * recencyMultiplier),
        reposts: Math.floor(baseEngagement * 0.4 * recencyMultiplier)
      },
      sentiment: item.sentiment,
      tags: item.tags
    };
  });

  return mentions;
}

// Generate volume spikes
function generateVolumeSpikes(): VolumeSpike[] {
  const now = new Date();
  
  return [
    {
      id: 'spike_1',
      timestamp: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      platform: 'Solana DEX',
      previousVolume: 245000,
      currentVolume: 1078000,
      percentageIncrease: 340,
      trigger: 'New agent registrations surge + SDK update announcement'
    },
    {
      id: 'spike_2',
      timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      platform: 'Twitter Mentions',
      previousVolume: 56,
      currentVolume: 234,
      percentageIncrease: 317,
      trigger: 'Viral thread about AXLE agent verification system'
    },
    {
      id: 'spike_3',
      timestamp: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
      platform: 'Discord Activity',
      previousVolume: 89,
      currentVolume: 312,
      percentageIncrease: 250,
      trigger: 'Community AMA session'
    }
  ];
}

// Generate 24-hour trend data
function generate24hTrend(): SocialTrendData[] {
  const now = new Date();
  const currentHour = now.getHours();
  const trend: SocialTrendData[] = [];

  for (let i = 0; i < 24; i++) {
    const hour = (currentHour - 23 + i + 24) % 24;
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    
    // Base mentions follow a daily pattern (low at night, high during day)
    let baseMentions = 10;
    if (hour >= 9 && hour <= 18) {
      baseMentions = 50 + Math.floor(Math.random() * 30);
    } else if (hour >= 6 && hour < 9) {
      baseMentions = 20 + Math.floor(Math.random() * 15);
    } else if (hour >= 18 && hour < 22) {
      baseMentions = 35 + Math.floor(Math.random() * 20);
    }

    // Add spike around certain hours
    if (hour === 15 || hour === 16) {
      baseMentions += Math.floor(Math.random() * 80) + 40; // Partnership announcement spike
    }

    // Sentiment follows a slight daily pattern
    const baseSentiment = 0.6 + Math.random() * 0.3;

    trend.push({
      hour: hourStr,
      mentions: baseMentions,
      sentiment: Math.round(baseSentiment * 100) / 100
    });
  }

  return trend;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'mentions';
    const limit = parseInt(searchParams.get('limit') || '20');

    switch (endpoint) {
      case 'mentions': {
        const mentions = generateMentions().slice(0, limit);
        return NextResponse.json({
          success: true,
          data: mentions,
          total: mentions.length,
          timestamp: new Date().toISOString()
        });
      }

      case 'spikes': {
        const spikes = generateVolumeSpikes();
        return NextResponse.json({
          success: true,
          data: spikes,
          timestamp: new Date().toISOString()
        });
      }

      case 'trends': {
        const trend = generate24hTrend();
        const totalMentions = trend.reduce((sum, item) => sum + item.mentions, 0);
        const avgSentiment = trend.reduce((sum, item) => sum + item.sentiment, 0) / trend.length;
        const peakHour = trend.reduce((max, item) => item.mentions > max.mentions ? item : max);

        return NextResponse.json({
          success: true,
          data: trend,
          summary: {
            totalMentions,
            averageSentiment: Math.round(avgSentiment * 100) / 100,
            peakHour,
            currentTrend: 'increasing'
          },
          timestamp: new Date().toISOString()
        });
      }

      case 'summary': {
        const mentions = generateMentions();
        const trend = generate24hTrend();
        const spikes = generateVolumeSpikes();
        
        const activeSpikes = spikes.filter(spike => {
          const spikeTime = new Date(spike.timestamp);
          const hoursSince = (Date.now() - spikeTime.getTime()) / (1000 * 60 * 60);
          return hoursSince <= 12;
        });

        return NextResponse.json({
          success: true,
          data: {
            recentMentions: mentions.slice(0, 5),
            activeSpikeCount: activeSpikes.length,
            last24hMentions: trend.reduce((sum, item) => sum + item.mentions, 0),
            sentimentScore: trend.reduce((sum, item) => sum + item.sentiment, 0) / trend.length,
            trending: true,
            topTopics: ['agent-verification', 'AI-marketplace', 'Solana', 'SDK', 'trust-layer']
          },
          timestamp: new Date().toISOString()
        });
      }

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

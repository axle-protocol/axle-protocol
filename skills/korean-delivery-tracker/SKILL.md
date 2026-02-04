---
name: korean-delivery-tracker
description: Track Korean delivery packages (택배 추적) across major Korean carriers including CJ대한통운, 한진택배, 롯데택배, 우체국택배, and 로젠택배. Use when a user wants to check delivery status, track packages, or monitor Korean shipping.
version: 1.0.0
author: OpenClaw
tags: [korea, delivery, tracking, shipping, logistics]
---

# Korean Delivery Tracker (한국 택배 추적기)

Track packages across major Korean shipping carriers with real-time delivery status updates.

## Supported Carriers (지원 택배사)

- **CJ대한통운** - Korea's largest logistics company
- **한진택배** - Hanjin Express
- **롯데택배** - Lotte Global Logistics
- **우체국택배** - Korea Post
- **로젠택배** - Logen Express

## Usage

### Basic Tracking

```bash
./scripts/track.sh <carrier> <tracking_number>
```

### Examples

```bash
# Track CJ대한통운 package
./scripts/track.sh cj 123456789012

# Track 한진택배 package  
./scripts/track.sh hanjin 987654321098

# Track 롯데택배 package
./scripts/track.sh lotte 555666777888

# Track 우체국택배 package
./scripts/track.sh koreapost 111222333444

# Track 로젠택배 package
./scripts/track.sh logen 999888777666
```

### Auto-detect Carrier

```bash
# Let the script detect the carrier automatically
./scripts/track.sh auto <tracking_number>
```

## Carrier Codes

| Carrier | Code | Tracking Number Format |
|---------|------|------------------------|
| CJ대한통운 | `cj` | 12 digits |
| 한진택배 | `hanjin` | 10-12 digits |
| 롯데택배 | `lotte` | 12-13 digits |
| 우체국택배 | `koreapost` | 13 digits |
| 로젠택배 | `logen` | 11-12 digits |

## Output Format

The tracker returns structured information including:

- 📦 **Package Status** - Current delivery status
- 🏠 **Sender/Receiver** - Shipping addresses (when available)
- 🚚 **Delivery Progress** - Step-by-step tracking history
- 📅 **Estimated Delivery** - Expected delivery date/time
- 📞 **Contact Info** - Carrier contact information

## Technical Details

The tracking script uses multiple methods for reliability:

1. **Primary**: Direct API calls to carrier systems
2. **Fallback**: Mobile web scraping for carriers without public APIs
3. **Cache**: Local caching to avoid rate limits

### Dependencies

- `curl` - For HTTP requests
- `jq` - For JSON parsing
- `iconv` - For character encoding conversion

## Privacy & Security

- No tracking data is stored permanently
- Only public delivery information is accessed
- API keys (when required) are read from environment variables
- All requests use proper User-Agent headers

## Configuration

Set environment variables for enhanced features:

```bash
export SWEETTRACKER_API_KEY="your_api_key"  # For Smart택배 API access
export TRACK_CACHE_DIR="/tmp/delivery-cache" # Cache directory
export TRACK_TIMEOUT="30"                    # Request timeout in seconds
```

## Error Codes

- `0` - Success
- `1` - Invalid carrier or tracking number
- `2` - Network error
- `3` - Package not found
- `4` - Service temporarily unavailable
- `5` - Missing dependencies

## Integration Examples

### OpenClaw Assistant Usage

When a user asks about package tracking:

```
User: "내 택배 추적해줘 - CJ대한통운 123456789012"
Assistant: Uses korean-delivery-tracker to check delivery status
```

### Automation

```bash
# Check multiple packages
for tracking in "cj:123456789012" "hanjin:987654321098"; do
    carrier=${tracking%%:*}
    number=${tracking##*:}
    ./scripts/track.sh "$carrier" "$number"
done
```

## Troubleshooting

### Common Issues

1. **"Package not found"** - Verify tracking number format
2. **"Network error"** - Check internet connection
3. **"Rate limited"** - Wait a few minutes before retrying
4. **"Invalid carrier"** - Use supported carrier codes

### Debug Mode

Enable verbose output:

```bash
DEBUG=1 ./scripts/track.sh cj 123456789012
```

## Updates

The tracking script automatically handles:
- Carrier website changes
- API endpoint updates  
- New carrier additions
- Format standardization

---

*택배 추적을 쉽고 빠르게! 🚚📦*
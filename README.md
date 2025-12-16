# FitRate Backend API

AI-powered outfit rating API using GPT-4o vision.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Add your OpenAI API key to .env
# OPENAI_API_KEY=sk-xxxxx

# Run development server
npm run dev
```

## 📁 Project Structure

```
fitrate-backend/
├── src/
│   ├── index.js          # Express app entry point
│   ├── config/
│   │   └── index.js      # Environment config
│   ├── routes/
│   │   ├── analyze.js    # POST /api/analyze
│   │   ├── battle.js     # POST /api/battle
│   │   └── webhook.js    # POST /api/webhook (Stripe)
│   ├── services/
│   │   └── outfitAnalyzer.js  # GPT-4o integration
│   └── middleware/       # Custom middleware
├── .env.example          # Environment template
├── .gitignore
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Health Check
```
GET /health
```

### Analyze Outfit
```
POST /api/analyze
Content-Type: application/json

{
  "image": "base64-encoded-image",
  "roastMode": false,
  "occasion": "date"  // optional: casual, date, work, party, streetwear, formal
}
```

Response:
```json
{
  "success": true,
  "scores": {
    "overall": 82,
    "color": 85,
    "fit": 78,
    "style": 84,
    "occasion": 80,
    "trendScore": 75,
    "verdict": "Clean minimalist energy ✨",
    "tip": "A chunky watch would elevate this",
    "aesthetic": "Quiet Luxury",
    "celebMatch": "Hailey Bieber coffee run",
    "roastMode": false
  }
}
```

### Fit Battle
```
POST /api/battle
Content-Type: application/json

{
  "outfit1": "base64-encoded-image",
  "outfit2": "base64-encoded-image"
}
```

Response:
```json
{
  "success": true,
  "battle": {
    "outfit1": { "overall": 78, ... },
    "outfit2": { "overall": 85, ... },
    "winner": 2,
    "margin": 7,
    "commentary": "Outfit 2 takes the crown by 7 points!"
  }
}
```

### Stripe Webhook
```
POST /api/webhook
```
Handles subscription events from Stripe.

## 🚀 Deploy to Railway

1. Push to GitHub
2. Connect Railway to your repo
3. Add environment variables:
   - `OPENAI_API_KEY`
   - `ALLOWED_ORIGINS` (your frontend URLs)
   - `STRIPE_SECRET_KEY` (optional)
   - `STRIPE_WEBHOOK_SECRET` (optional)

## 💰 API Costs (GPT-4o)

| Component | Cost |
|-----------|------|
| Image input | ~$0.01-0.03 per image |
| Text output | ~$0.003 |
| **Per scan** | **~$0.015-0.035** |

## 🔒 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend URLs |
| `STRIPE_SECRET_KEY` | No | For Pro subscriptions |
| `STRIPE_WEBHOOK_SECRET` | No | For Stripe webhooks |
| `RATE_LIMIT_MAX_REQUESTS` | No | Requests per minute (default: 10) |

## 📝 License

MIT

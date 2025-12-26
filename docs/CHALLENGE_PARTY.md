# Challenge Party API Documentation

The Challenge Party feature creates shared 1v1 challenge rooms where two users can compare their outfit scores.

## Overview

- User A scans their outfit → gets a score → creates a challenge → shares link
- User B opens the link → scans their outfit → both scores are saved
- Either user can revisit the link anytime to see who won

## User Flow

### Creating a Challenge (User A)
1. User A scans outfit in FitRate app
2. Gets score (e.g., 68.4)
3. Taps "Challenge a Friend"
4. Frontend calls: `POST /api/challenges { creatorScore: 68.4 }`
5. Backend returns: `{ challengeId: "ch_xK9mP2nQ" }`
6. Frontend generates link: `fitrate.app/c/ch_xK9mP2nQ`
7. User A shares via iMessage, WhatsApp, etc.

### Accepting a Challenge (User B)
1. User B opens `fitrate.app/c/ch_xK9mP2nQ`
2. Frontend calls: `GET /api/challenges/ch_xK9mP2nQ`
3. Sees: "Score to beat: 68" + "Accept Challenge" button
4. Scans their outfit → gets score 72.1
5. Frontend calls: `POST /api/challenges/ch_xK9mP2nQ/respond { responderScore: 72.1 }`
6. Backend saves score, calculates winner, returns result
7. User B sees: "YOU WON! 72 vs 68"

### Checking Results (Either User)
1. Open `fitrate.app/c/ch_xK9mP2nQ` anytime
2. `GET /api/challenges/ch_xK9mP2nQ` returns full data
3. See the final result with both scores

## API Endpoints

### 1. Create Challenge

**Endpoint:** `POST /api/challenges`

**Request:**
```json
{
  "creatorScore": 68.4
}
```

**Response (201 Created):**
```json
{
  "challengeId": "ch_xK9mP2nQ",
  "status": "waiting",
  "creatorScore": 68.4,
  "createdAt": "2025-01-15T10:30:00Z",
  "expiresAt": "2025-01-22T10:30:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Missing or invalid score
- `500 Internal Server Error`: Server error

### 2. Get Challenge

**Endpoint:** `GET /api/challenges/:challengeId`

**Response (200 OK) - Waiting State:**
```json
{
  "challengeId": "ch_xK9mP2nQ",
  "status": "waiting",
  "creatorScore": 68.4,
  "responderScore": null,
  "winner": null,
  "createdAt": "2025-01-15T10:30:00Z",
  "expiresAt": "2025-01-22T10:30:00Z"
}
```

**Response (200 OK) - Completed State:**
```json
{
  "challengeId": "ch_xK9mP2nQ",
  "status": "completed",
  "creatorScore": 68.4,
  "responderScore": 72.1,
  "winner": "responder",
  "createdAt": "2025-01-15T10:30:00Z",
  "respondedAt": "2025-01-15T14:22:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid challenge ID format
- `404 Not Found`: Challenge not found
- `410 Gone`: Challenge expired
- `500 Internal Server Error`: Server error

### 3. Respond to Challenge

**Endpoint:** `POST /api/challenges/:challengeId/respond`

**Request:**
```json
{
  "responderScore": 72.1
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "status": "completed",
  "creatorScore": 68.4,
  "responderScore": 72.1,
  "winner": "responder",
  "margin": 3.7
}
```

**Winner Values:**
- `"responder"`: Responder has higher score
- `"creator"`: Creator has higher score
- `"tie"`: Both scores are equal

**Error Responses:**
- `400 Bad Request`: Missing/invalid score or challenge already completed
- `404 Not Found`: Challenge not found
- `410 Gone`: Challenge expired
- `500 Internal Server Error`: Server error

## Data Model

### Redis Data Structure

**Key:** `challenge:{challengeId}` (Redis hash)

**Fields:**
- `creatorScore` (decimal): Creator's score (0.0-100.0)
- `responderScore` (decimal): Responder's score, null until responded
- `status` (string): 'waiting', 'completed', or 'expired'
- `winner` (string): null, 'creator', 'responder', or 'tie'
- `createdAt` (ISO timestamp): When challenge was created
- `respondedAt` (ISO timestamp): When response was submitted, null until then
- `expiresAt` (ISO timestamp): created_at + 7 days

**TTL:** 7 days (604,800 seconds) - automatically deleted after expiration

### Challenge ID Format

Format: `ch_` + 10 random alphanumeric characters

Example: `ch_xK9mP2nQ`, `ch_7aB3kL9pM`

## Rate Limits

- **Create Challenge:** 10 challenges per minute per IP
- **Get Challenge:** 60 requests per minute per IP
- **Respond to Challenge:** 20 responses per minute per IP

## Testing Examples

### Example 1: Complete Flow

```bash
# 1. Create challenge (User A scored 68.4)
curl -X POST http://localhost:3001/api/challenges \
  -H "Content-Type: application/json" \
  -d '{"creatorScore": 68.4}'

# Response: {"challengeId": "ch_abc123", "status": "waiting", ...}

# 2. Get challenge (User B opens the link)
curl http://localhost:3001/api/challenges/ch_abc123

# Response: {"status": "waiting", "creatorScore": 68.4, ...}

# 3. Respond to challenge (User B scored 72.1)
curl -X POST http://localhost:3001/api/challenges/ch_abc123/respond \
  -H "Content-Type: application/json" \
  -d '{"responderScore": 72.1}'

# Response: {"winner": "responder", "margin": 3.7, ...}

# 4. Check results (either user)
curl http://localhost:3001/api/challenges/ch_abc123

# Response: {"status": "completed", "winner": "responder", ...}
```

### Example 2: Error Cases

```bash
# Invalid score (too high)
curl -X POST http://localhost:3001/api/challenges \
  -H "Content-Type: application/json" \
  -d '{"creatorScore": 150}'
# Response: 400 Bad Request

# Challenge not found
curl http://localhost:3001/api/challenges/ch_invalid
# Response: 404 Not Found

# Respond twice to same challenge
curl -X POST http://localhost:3001/api/challenges/ch_abc123/respond \
  -H "Content-Type: application/json" \
  -d '{"responderScore": 80}'
# Response: 400 Bad Request (already completed)
```

## In-Memory Fallback

If Redis is not available (REDIS_URL not configured), the service automatically falls back to an in-memory Map for local development. Note that this is not recommended for production as data is lost on server restart.

## Security

- Input validation on all scores (must be 0-100)
- Challenge ID format validation (must start with 'ch_')
- Rate limiting on all endpoints
- Automatic expiration (7 days TTL)
- No authentication required (challenges are public with ID)

## Future Enhancements

Potential future features:
- User authentication (track who created/responded)
- Rematch functionality
- Challenge history
- Sharing stats (win/loss record)
- Custom challenge messages
- Photo thumbnails in challenge data

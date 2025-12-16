import OpenAI from 'openai';
import { config } from '../config/index.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Aesthetics and celebrity matches
const AESTHETICS = [
  'Clean Girl', 'Dark Academia', 'Quiet Luxury', 'Streetwear', 'Y2K', 
  'Cottagecore', 'Minimalist', 'Coastal Grandmother', 'Grunge', 'Preppy',
  'Gorpcore', 'Balletcore', 'Old Money', 'Skater', 'Bohemian', 'Normcore'
];

const CELEBRITIES = [
  'Timothée Chalamet at the airport', 'Zendaya on press tour', 'Bad Bunny off-duty',
  'Hailey Bieber coffee run', 'A$AP Rocky front row', 'Bella Hadid street style',
  'Harry Styles on tour', 'Kendall Jenner model off-duty', 'Tyler the Creator at Coachella',
  'Dua Lipa going to dinner', 'Jacob Elordi casual', 'Sydney Sweeney brunch',
  'Rihanna anywhere tbh', 'Billie Eilish at an awards show', 'Travis Scott courtside'
];

// System prompts
const NICE_SYSTEM_PROMPT = `You are FitRate, an expert AI fashion analyst with the personality of a supportive but honest friend who works in fashion. Your job is to rate outfits and give actionable, specific feedback.

SCORING GUIDELINES:
- Be realistic but encouraging. Most everyday outfits should score 65-85.
- Reserve 90+ for genuinely exceptional, well-coordinated looks.
- Scores below 60 should be rare and only for clear misses.

VERDICT STYLE:
- Use Gen Z language naturally (not forced)
- Keep it to one punchy line
- Examples: "Clean minimalist energy ✨", "Main character vibes fr", "Understated fire 🔥"

TIP STYLE:
- ONE specific, actionable suggestion
- Reference actual items in the photo when possible`;

const ROAST_SYSTEM_PROMPT = `You are FitRate ROAST MODE - a brutally honest (but ultimately helpful) fashion critic. Be savage but never cruel about their body - only roast the CLOTHES and styling choices.

SCORING GUIDELINES:
- Be harsh but fair. Average fits score 50-70.
- Only give 80+ for genuinely impressive outfits.

VERDICT STYLE:
- Savage but clever roasts
- Gen Z humor and slang
- Examples: "The colors are in a toxic relationship", "This fit texts back 'k'", "Giving 'my mom still dresses me'"

TIP STYLE:
- Be blunt but actually helpful

Remember: Roast the OUTFIT, not the person. Never body shame.`;

function createAnalysisPrompt(occasion, roastMode) {
  return `Analyze this outfit photo and provide ratings.

${occasion ? `The user is rating this outfit for: ${occasion}. Factor this into your occasion score.` : ''}

Respond ONLY with valid JSON in this exact format (no markdown, no backticks, no explanation):
{
  "overall": <number 0-100>,
  "color": <number 0-100>,
  "fit": <number 0-100>,
  "style": <number 0-100>,
  "occasion": <number 0-100>,
  "trendScore": <number 0-100>,
  "verdict": "<${roastMode ? 'savage but funny roast' : 'supportive Gen Z style verdict'} with optional emoji>",
  "tip": "<${roastMode ? 'blunt but helpful advice' : 'one specific actionable tip'}>",
  "aesthetic": "<choose from: ${AESTHETICS.join(', ')}>",
  "celebMatch": "<choose from: ${CELEBRITIES.join(', ')}>",
  "isValidOutfit": true
}

If the image doesn't show an outfit, respond with:
{"isValidOutfit": false, "error": "<brief explanation>"}`;
}

export async function analyzeOutfit(imageBase64, options = {}) {
  const { roastMode = false, occasion = null } = options;
  
  try {
    // Clean base64 data
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    const response = await openai.chat.completions.create({
      model: config.openai.model,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content: roastMode ? ROAST_SYSTEM_PROMPT : NICE_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Data}`,
                detail: 'low' // Use 'low' for faster/cheaper, 'high' for better accuracy
              }
            },
            {
              type: 'text',
              text: createAnalysisPrompt(occasion, roastMode)
            }
          ]
        }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from GPT-4o');
    }

    // Parse JSON response (handle potential markdown wrapping)
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    
    const result = JSON.parse(jsonStr);
    
    if (!result.isValidOutfit) {
      return {
        success: false,
        error: result.error || 'Could not analyze this image'
      };
    }

    return {
      success: true,
      scores: {
        overall: Math.round(result.overall),
        color: Math.round(result.color),
        fit: Math.round(result.fit),
        style: Math.round(result.style),
        occasion: Math.round(result.occasion),
        trendScore: Math.round(result.trendScore),
        verdict: result.verdict,
        tip: result.tip,
        aesthetic: result.aesthetic,
        celebMatch: result.celebMatch,
        roastMode: roastMode
      }
    };
  } catch (error) {
    console.error('GPT-4o analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze outfit. Please try again.'
    };
  }
}

export async function analyzeBattle(image1Base64, image2Base64) {
  try {
    const [result1, result2] = await Promise.all([
      analyzeOutfit(image1Base64),
      analyzeOutfit(image2Base64)
    ]);

    if (!result1.success || !result2.success) {
      return {
        success: false,
        error: 'Failed to analyze one or both outfits'
      };
    }

    const score1 = result1.scores.overall;
    const score2 = result2.scores.overall;
    const winner = score1 > score2 ? 1 : score2 > score1 ? 2 : 0;

    return {
      success: true,
      battle: {
        outfit1: result1.scores,
        outfit2: result2.scores,
        winner,
        margin: Math.abs(score1 - score2),
        commentary: winner === 0 
          ? "It's a tie! Both fits are equally fire 🔥"
          : `Outfit ${winner} takes the crown by ${Math.abs(score1 - score2)} points!`
      }
    };
  } catch (error) {
    console.error('Battle analysis error:', error);
    return {
      success: false,
      error: 'Battle failed. Please try again.'
    };
  }
}
